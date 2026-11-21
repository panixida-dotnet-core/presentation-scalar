import { resolveDocumentNode } from './schema.js';

export const transportNames = ['WebSockets', 'ServerSentEvents', 'LongPolling'];

function credential(document, reference) {
    const scheme = resolveDocumentNode(document, reference);
    if (!scheme) {
        return { id: 'unresolved', label: 'Unresolved authentication scheme', kind: 'unsupported' };
    }
    const id = reference.$ref ?? JSON.stringify(scheme);
    const label = scheme.title ?? reference.$ref?.split('/').at(-1) ?? scheme.scheme ?? scheme.type;
    let kind = 'unsupported';
    if (scheme.type === 'http') {
        kind = ['bearer', 'basic'].includes(scheme.scheme?.toLowerCase()) ? scheme.scheme.toLowerCase() : kind;
    } else if (['oauth2', 'openIdConnect'].includes(scheme.type)) {
        kind = 'bearer';
    } else if (scheme.type === 'httpApiKey' && ['query', 'header', 'cookie'].includes(scheme.in)) {
        kind = scheme.in === 'cookie' ? 'cookie' : 'apiKey';
    }
    return { id, label, kind, location: scheme.in, name: scheme.name, description: scheme.description,
        scopes: scheme.scopes ?? [], tokenSource: ['oauth2', 'openIdConnect'].includes(scheme.type) };
}

export function getAuthenticationOptions(document, operation, channel) {
    const servers = channel.servers ?? Object.keys(document.servers ?? {}).map(key =>
        ({ $ref: '#/servers/' + key.replaceAll('~', '~0').replaceAll('/', '~1') }));
    const serverSecurity = servers.flatMap(reference => resolveDocumentNode(document, reference)?.security ?? []);
    const operationSecurity = operation.security ?? operation.traits?.flatMap(reference =>
        resolveDocumentNode(document, reference)?.security ?? []) ?? [];
    const combinations = serverSecurity.length > 0 ? serverSecurity.slice(0, 32).map(value => [value]) : [[]];
    const alternatives = operationSecurity.length > 0
        ? combinations.flatMap(values => operationSecurity.slice(0, 32).map(value => [...values, value])) : combinations;
    const declared = serverSecurity.length > 0 || operationSecurity.length > 0;
    const required = declared || operation.bindings?.['x-signalr']?.authorizationRequired === true;
    const options = alternatives.filter(values => values.length > 0).slice(0, 32).map(values => {
        const credentials = [...new Map(values.map(value => {
            const item = credential(document, value);
            return [item.id, item];
        })).values()];
        return { id: credentials.map(value => value.id).join(' + '),
            label: credentials.map(value => value.label).join(' + '), credentials };
    });
    if (!declared) {
        options.push(
            { id: 'bearer', label: 'Bearer', credentials: [{ id: 'bearer', label: 'Bearer token', kind: 'bearer' }] },
            { id: 'cookie', label: 'Browser cookies', credentials: [{ id: 'cookie', label: 'Browser cookies', kind: 'cookie' }] }
        );
    }
    const anonymous = { id: 'none', label: 'No explicit authentication', credentials: [] };
    required ? options.push(anonymous) : options.unshift(anonymous);
    return { options, required, declared };
}

export function createSettings(hub) {
    return { authentication: hub.authentication.options[0].id, credentials: {}, transport: 'Auto',
        skipNegotiation: false, withCredentials: true, headers: [], query: [] };
}

function readPairs(pairs, kind) {
    const result = new Map();
    for (const { name, value } of pairs) {
        const key = name.trim();
        if (!key && !value) {
            continue;
        }
        if (!key || /[\r\n]/u.test(key + value)) {
            throw new Error(`${kind} need a name and must not contain line breaks.`);
        }
        const normalized = kind === 'Headers' ? key.toLowerCase() : key;
        if (result.has(normalized)) {
            throw new Error(`${kind} contain a duplicate name: ${key}.`);
        }
        result.set(normalized, { name: key, value });
    }
    return [...result.values()];
}

const forbiddenHeaders = /^(?:accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/iu;

export function prepareConnection(hub, settings, placeholders = false) {
    const authentication = hub.authentication.options.find(option => option.id === settings.authentication);
    if (!authentication) {
        throw new Error('Select an authentication type.');
    }
    if (settings.transport !== 'Auto' && !hub.transports.includes(settings.transport)) {
        throw new Error('The selected transport is not documented for this hub.');
    }
    if (settings.skipNegotiation && settings.transport !== 'WebSockets') {
        throw new Error('Skip negotiation requires the WebSockets transport.');
    }
    const url = new URL(hub.url);
    const headers = {};
    const secrets = [];
    let token;
    let headerAuthentication = false;
    let cookieAuthentication = false;
    for (const { name, value } of readPairs(settings.headers, 'Headers')) {
        if (!/^[!#$%&'*+.^_`|~\w-]+$/u.test(name) || forbiddenHeaders.test(name)) {
            throw new Error(`The browser cannot set the ${name} header.`);
        }
        if (name.toLowerCase() === 'authorization') {
            throw new Error('Configure Authorization in Authentication.');
        }
        headers[name] = value;
        secrets.push(value);
    }
    for (const { name, value } of readPairs(settings.query, 'Query parameters')) {
        if (/^(?:id|access_token|negotiateVersion|useStatefulReconnect)$/iu.test(name)) {
            throw new Error(`The ${name} query parameter is managed by SignalR.`);
        }
        url.searchParams.append(name, value);
        secrets.push(value);
    }
    for (const item of authentication.credentials) {
        const values = settings.credentials[item.id] ?? {};
        const requiredValue = (key, placeholder) => {
            const raw = values[key] ?? '';
            const value = placeholders ? placeholder : key === 'token' ? raw.trim() : raw;
            if (!value) {
                throw new Error(`Enter credentials for ${item.label}.`);
            }
            secrets.push(value);
            return value;
        };
        if (item.kind === 'bearer') {
            if (token || Object.hasOwn(headers, 'Authorization')) {
                throw new Error('These authentication requirements need conflicting Authorization credentials.');
            }
            token = requiredValue('token', 'YOUR_ACCESS_TOKEN').replace(/^Bearer\s+/iu, '');
        } else if (item.kind === 'basic') {
            if (token || Object.hasOwn(headers, 'Authorization')) {
                throw new Error('These authentication requirements need conflicting Authorization credentials.');
            }
            const username = requiredValue('username', 'YOUR_USERNAME');
            const password = requiredValue('password', 'YOUR_PASSWORD');
            if (username.includes(':')) {
                throw new Error('A Basic authentication username must not contain a colon.');
            }
            headers.Authorization = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(username + ':' + password)));
            secrets.push(headers.Authorization);
            headerAuthentication = true;
        } else if (item.kind === 'apiKey') {
            const value = requiredValue('value', 'YOUR_API_KEY');
            if (!item.name || /[\r\n]/u.test(item.name + value)) {
                throw new Error('The API key scheme has an invalid parameter name or value.');
            }
            if (item.location === 'query') {
                if (/^(?:id|negotiateVersion|useStatefulReconnect)$/iu.test(item.name)) {
                    throw new Error('The API key conflicts with a SignalR-owned query parameter.');
                }
                url.searchParams.set(item.name, value);
            } else {
                if (forbiddenHeaders.test(item.name) || !/^[!#$%&'*+.^_`|~\w-]+$/u.test(item.name)) {
                    throw new Error('The API key uses a header that the browser cannot set.');
                }
                if (Object.keys(headers).some(name => name.toLowerCase() === item.name.toLowerCase())
                    || (token && item.name.toLowerCase() === 'authorization')) {
                    throw new Error('The API key conflicts with another configured header.');
                }
                headers[item.name] = value;
                headerAuthentication = true;
            }
        } else if (item.kind === 'cookie') {
            cookieAuthentication = true;
        } else {
            throw new Error(`${item.label} is not supported by this browser client.`);
        }
    }
    if (token && url.searchParams.has('access_token')) {
        throw new Error('The API key conflicts with the SignalR access token.');
    }
    if (headerAuthentication && settings.transport !== 'LongPolling') {
        throw new Error('Header authentication requires LongPolling in this browser client.');
    }
    if (cookieAuthentication && !settings.withCredentials) {
        throw new Error('Enable HTTP browser credentials to use cookie authentication.');
    }
    return { url: url.href, headers, token, secrets: secrets.filter(Boolean),
        transports: settings.transport === 'Auto' ? hub.transports : [settings.transport],
        skipNegotiation: settings.skipNegotiation, withCredentials: settings.withCredentials, cookieAuthentication };
}

export function redact(text, secrets) {
    let result = String(text);
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
        for (const value of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
            result = result.replaceAll(value, '[redacted]');
        }
    }
    return result;
}

export function negotiationDetails(response) {
    const sanitize = value => {
        if (Array.isArray(value)) {
            return value.map(sanitize);
        }
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) =>
                [key, /token|password|secret/iu.test(key) ? '[redacted]' : sanitize(item)]));
        }
        return value;
    };
    try {
        return { statusCode: response.statusCode, response: sanitize(JSON.parse(response.content)) };
    } catch {
        return { statusCode: response.statusCode };
    }
}
