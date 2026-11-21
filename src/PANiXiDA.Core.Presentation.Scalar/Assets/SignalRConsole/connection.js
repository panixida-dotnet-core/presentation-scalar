import { resolveDocumentNode } from './schema.js';

export const transportNames = ['WebSockets', 'ServerSentEvents', 'LongPolling'];

const pathParameterPattern = /\{([^{}\/]+)\}/gu;
const managedQuery = /^(?:id|access_token|negotiateVersion|useStatefulReconnect)$/iu;

function parameter(name, schema, required) {
    return { name, required, description: schema?.description,
        values: Array.isArray(schema?.enum) ? schema.enum.map(String) : undefined,
        defaultValue: String(schema?.default ?? '') };
}

export function getConnectionParameters(document, channel) {
    const path = [...new Set(Array.from(channel.address.matchAll(pathParameterPattern), match => match[1]))]
        .map(name => parameter(name, resolveDocumentNode(document, channel.parameters?.[name]), true));
    const binding = resolveDocumentNode(document, channel.bindings)?.ws;
    const query = resolveDocumentNode(document, binding?.query);
    return {
        path,
        query: Object.entries(query?.properties ?? {}).filter(([name]) => !managedQuery.test(name))
            .map(([name, schema]) => parameter(name, resolveDocumentNode(document, schema), query.required?.includes(name) === true))
    };
}

function credential(document, reference) {
    const scheme = resolveDocumentNode(document, reference);
    if (!scheme) {
        return null;
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
    const description = scheme.description ?? (scheme.type === 'http' && kind === 'bearer'
        ? 'Access token without the Bearer prefix.' : undefined);
    return { id, label, kind, location: scheme.in, name: scheme.name, description,
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
    const options = alternatives.slice(0, 32).flatMap(values => {
        const items = values.map(value => credential(document, value));
        if (!items.length || items.includes(null)) {
            return [];
        }
        const credentials = [...new Map(items.map(item => [item.id, item])).values()];
        return [{ id: credentials.map(value => value.id).join(' + '),
            label: credentials.map(value => value.label).join(' + '), credentials }];
    });
    return { options, required, declared };
}

export function createSettings(hub) {
    const options = hub.authentication.options;
    const selected = options.find(option => option.credentials.every(item => item.kind !== 'unsupported')) ?? options[0];
    const defaults = parameters => Object.fromEntries((parameters ?? []).map(item => [item.name, item.defaultValue]));
    return { authentication: selected?.id, credentials: {}, transport: 'Auto',
        skipNegotiation: false, withCredentials: true, headers: [],
        path: defaults(hub.parameters?.path), query: defaults(hub.parameters?.query) };
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

const forbiddenHeaderNames = new Set('accept-charset accept-encoding connection content-length cookie cookie2 date dnt expect host keep-alive origin referer te trailer transfer-encoding upgrade via'.split(' '));
const headerNamePattern = /^[!#$%&'*+.^`|~\w-]+$/u;

function forbiddenHeader(name) {
    const key = name.toLowerCase();
    return forbiddenHeaderNames.has(key) || ['access-control-request-', 'proxy-', 'sec-'].some(prefix => key.startsWith(prefix));
}

function connectionHeaders(pairs) {
    const headers = {};
    for (const { name, value } of readPairs(pairs, 'Headers')) {
        if (!headerNamePattern.test(name) || forbiddenHeader(name)) {
            throw new Error('The browser cannot set the ' + name + ' header.');
        }
        if (name.toLowerCase() === 'authorization') {
            throw new Error('Configure Authorization in Authentication.');
        }
        headers[name] = value;
    }
    return headers;
}

function parameterValue(item, values) {
    const value = values[item.name];
    if (!value && item.required) {
        throw new Error('Enter a value for ' + item.name + '.');
    }
    if (value && item.values?.length && !item.values.includes(value)) {
        throw new Error('Select a documented value for ' + item.name + '.');
    }
    return value;
}

export function connectionPath(hub, settings) {
    let path = hub.url.pathname;
    for (const item of hub.parameters?.path ?? []) {
        const value = parameterValue(item, settings.path);
        if (value === '.' || value === '..' || /[\/\\\p{Cc}]/u.test(value)) {
            throw new Error('Enter a single path segment for ' + item.name + '.');
        }
        const placeholder = new URL('/{' + item.name + '}', hub.url).pathname.slice(1);
        path = path.replaceAll(placeholder, encodeURIComponent(value));
    }
    return path;
}

export function connectionAddress(hub, settings) {
    const url = new URL(hub.url);
    url.pathname = connectionPath(hub, settings);
    for (const item of hub.parameters?.query ?? []) {
        const value = parameterValue(item, settings.query);
        if (value && !managedQuery.test(item.name)) {
            url.searchParams.set(item.name, value);
        }
    }
    return url;
}

function credentialValue(item, values, key, placeholder, state, placeholders) {
    let value = values[key] ?? '';
    if (key === 'token') {
        value = value.trim();
    }
    if (placeholders) {
        value = placeholder;
    }
    if (!value) {
        throw new Error('Enter credentials for ' + item.label + '.');
    }
    state.secrets.push(value);
    return value;
}

function requireAuthorizationSlot(state) {
    if (state.token || Object.keys(state.headers).some(name => name.toLowerCase() === 'authorization')) {
        throw new Error('These authentication requirements need conflicting Authorization credentials.');
    }
}

function applyApiKey(item, value, state) {
    if (!item.name || /[\r\n]/u.test(item.name + value)) {
        throw new Error('The API key scheme has an invalid parameter name or value.');
    }
    if (item.location === 'query') {
        if (/^(?:id|negotiateVersion|useStatefulReconnect)$/iu.test(item.name)) {
            throw new Error('The API key conflicts with a SignalR-owned query parameter.');
        }
        state.url.searchParams.set(item.name, value);
        return;
    }
    if (forbiddenHeader(item.name) || !headerNamePattern.test(item.name)) {
        throw new Error('The API key uses a header that the browser cannot set.');
    }
    if (Object.keys(state.headers).some(name => name.toLowerCase() === item.name.toLowerCase())
        || (state.token && item.name.toLowerCase() === 'authorization')) {
        throw new Error('The API key conflicts with another configured header.');
    }
    state.headers[item.name] = value;
    state.headerAuthentication = true;
}

function applyCredential(item, values, state, placeholders) {
    const read = (key, placeholder) => credentialValue(item, values, key, placeholder, state, placeholders);
    switch (item.kind) {
        case 'bearer':
            requireAuthorizationSlot(state);
            state.token = read('token', 'YOUR_ACCESS_TOKEN').replace(/^Bearer\s+/iu, '');
            state.secrets.push(state.token);
            break;
        case 'basic': {
            requireAuthorizationSlot(state);
            const username = read('username', 'YOUR_USERNAME');
            const password = read('password', 'YOUR_PASSWORD');
            if (username.includes(':')) {
                throw new Error('A Basic authentication username must not contain a colon.');
            }
            const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(username + ':' + password)));
            state.headers.Authorization = 'Basic ' + encoded;
            state.secrets.push(state.headers.Authorization, encoded);
            state.headerAuthentication = true;
            break;
        }
        case 'apiKey':
            applyApiKey(item, read('value', 'YOUR_API_KEY'), state);
            break;
        case 'cookie':
            state.cookieAuthentication = true;
            break;
        default:
            throw new Error(item.label + ' is not supported by this browser client.');
    }
}

function validateTransport(hub, settings) {
    if (settings.transport !== 'Auto' && !hub.transports.includes(settings.transport)) {
        throw new Error('The selected transport is not documented for this hub.');
    }
    if (settings.skipNegotiation && settings.transport !== 'WebSockets') {
        throw new Error('Skip negotiation requires the WebSockets transport.');
    }
}

function validateCredentials(state, settings) {
    if (state.token && state.url.searchParams.has('access_token')) {
        throw new Error('The API key conflicts with the SignalR access token.');
    }
    if (state.headerAuthentication && settings.transport !== 'LongPolling') {
        throw new Error('Header authentication requires LongPolling in this browser client.');
    }
    if (state.cookieAuthentication && !settings.withCredentials) {
        throw new Error('Enable HTTP browser credentials to use cookie authentication.');
    }
}

export function prepareConnection(hub, settings, placeholders = false) {
    const authentication = hub.authentication.options.find(option => option.id === settings.authentication);
    if (!authentication && hub.authentication.options.length) {
        throw new Error('Select an authentication type.');
    }
    validateTransport(hub, settings);
    const state = { url: connectionAddress(hub, settings), headers: connectionHeaders(settings.headers),
        secrets: [...settings.headers.map(pair => pair.value), ...Object.values(settings.query)], token: undefined,
        headerAuthentication: false, cookieAuthentication: false };
    for (const item of authentication?.credentials ?? []) {
        applyCredential(item, settings.credentials[item.id] ?? {}, state, placeholders);
    }
    validateCredentials(state, settings);
    return { url: state.url.href, headers: state.headers, token: state.token, secrets: state.secrets.filter(Boolean),
        transports: settings.transport === 'Auto' ? hub.transports : [settings.transport],
        skipNegotiation: settings.skipNegotiation, withCredentials: settings.withCredentials,
        cookieAuthentication: state.cookieAuthentication };
}

export function redact(text, secrets) {
    let result = String(text);
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
        const formEncoded = new URLSearchParams({ secret }).toString().slice('secret='.length);
        for (const value of new Set([secret, encodeURIComponent(secret), formEncoded, JSON.stringify(secret).slice(1, -1)])) {
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
