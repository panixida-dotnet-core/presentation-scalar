import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

import { createSettings, getAuthenticationOptions, getConnectionParameters, negotiationDetails, prepareConnection, redact } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/connection.js';
import { getArgumentSchemas, getMessageSchemas, replyReturnsValue } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/schema.js';
import { clients, codeTokens, generateSnippet } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/snippets.js';
import { mountCopyFeedback } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/view.js';

test('Copy feedback is refreshed by a repeated copy and cleared when the console closes', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const status = { textContent: '' };
    const dialog = Object.assign(new EventTarget(), { open: true, querySelector: () => status });
    const show = mountCopyFeedback(dialog);

    show();
    assert.equal(status.textContent, 'Copied to the clipboard');
    t.mock.timers.tick(2000);
    show();
    t.mock.timers.tick(2000);
    assert.equal(status.textContent, 'Copied to the clipboard');
    t.mock.timers.tick(1000);
    assert.equal(status.textContent, '');

    show();
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
    show();
    assert.equal(status.textContent, '');
});

function hub(authentication = getAuthenticationOptions({}, {}, {})) {
    return { url: new URL('https://example.com/gateway/hub'), transports: ['WebSockets', 'ServerSentEvents', 'LongPolling'],
        authentication, events: new Map([['changed', { target: 'Changed', argumentCount: 2 }]]) };
}

function bearerHub() {
    return hub(getAuthenticationOptions({}, { security: [{ type: 'http', scheme: 'bearer', title: 'Bearer' }] }, {}));
}

function session() {
    const endpoint = hub();
    return { hub: endpoint, settings: createSettings(endpoint),
        method: { target: 'Echo', inputStreams: [], streamResult: false }, arguments: '[{"text":"example"},2]', uploads: '[]' };
}

test('Message arguments expand both DTOs, nullable references, enums and recursive fields', () => {
    const root = {
        type: 'object', properties: { arguments: { type: 'array', prefixItems: [
            { $ref: '#/$defs/Player' }, { anyOf: [{ $ref: '#/$defs/State' }, { type: 'null' }] }
        ] } },
        $defs: {
            Player: { type: 'object', required: ['id'], properties: {
                id: { type: 'string', format: 'uuid' }, friend: { $ref: '#/$defs/Player' }
            } },
            State: { type: 'object', properties: { status: { type: 'string', enum: ['Queued', 'Matched'] } } }
        }
    };
    const document = { components: { messages: { Changed: { title: 'Changed message', payload: {
        schemaFormat: 'application/schema+json', schema: root
    } } } } };
    const messages = getMessageSchemas(document, { messages: [{ $ref: '#/components/messages/Changed' }] });
    const fields = getArgumentSchemas(messages[0]);

    assert.equal(fields.length, 2);
    assert.equal(fields[0].type, 'Player');
    assert.equal(fields[0].children[0].required, true);
    assert.equal(fields[0].children[0].format, 'uuid');
    assert.equal(fields[0].children[1].recursive, true);
    assert.equal(fields[1].type, 'State');
    assert.equal(fields[1].nullable, true);
    assert.deepEqual(fields[1].children[0].values, ['Queued', 'Matched']);
});

test('A homogeneous single-DTO argument array expands a components reference', () => {
    const document = { components: { schemas: { State: { title: 'MatchSearchState', type: 'object',
        properties: { gameId: { type: ['string', 'null'], format: 'uuid' } } } } } };
    const root = { properties: { arguments: { type: 'array', minItems: 1, maxItems: 1,
        items: { $ref: '#/components/schemas/State' } } } };
    const [field] = getArgumentSchemas({ document, root });

    assert.equal(field.type, 'MatchSearchState');
    assert.equal(field.children[0].nullable, true);
});

test('Native snippets distinguish completion-only methods from JSON results', () => {
    const completion = type => ({ reply: { messages: [{ payload: { oneOf: [
        { properties: { result: { type } } }, { properties: { error: { type: 'string' } } }
    ] } }] } });
    assert.equal(replyReturnsValue({}, completion('null')), false);
    assert.equal(replyReturnsValue({}, completion('object')), true);
    assert.equal(replyReturnsValue({}, {}), null);
    const value = session();
    value.method.returnsValue = false;
    assert.match(generateSnippet('java', value), /connection\.invoke\("Echo"/);
    assert.doesNotMatch(generateSnippet('java', value), /blockingGet/);
    value.method.returnsValue = true;
    assert.match(generateSnippet('java', value), /connection\.invoke\(JsonElement\.class/);
});

test('AsyncAPI server and operation security requirements are combined, while alternatives remain selectable', () => {
    const document = { servers: { primary: { security: [{ $ref: '#/components/securitySchemes/Bearer' }] } },
        components: { securitySchemes: {
            Bearer: { type: 'http', scheme: 'bearer' },
            Key: { type: 'httpApiKey', in: 'query', name: 'api_key' },
            Cookie: { type: 'httpApiKey', in: 'cookie', name: 'session' }
        } } };
    const authentication = getAuthenticationOptions(document, { security: [
        { $ref: '#/components/securitySchemes/Key' }, { $ref: '#/components/securitySchemes/Cookie' }
    ] }, {});

    assert.equal(authentication.required, true);
    assert.equal(authentication.declared, true);
    assert.deepEqual(authentication.options[0].credentials.map(value => value.kind), ['bearer', 'apiKey']);
    assert.deepEqual(authentication.options[1].credentials.map(value => value.kind), ['bearer', 'cookie']);
    const endpoint = hub(authentication);
    const settings = createSettings(endpoint);
    for (const item of authentication.options[0].credentials) {
        settings.credentials[item.id] = { token: 'access-secret', value: 'a+b&c' };
    }
    const prepared = prepareConnection(endpoint, settings);
    assert.equal(prepared.token, 'access-secret');
    assert.equal(new URL(prepared.url).searchParams.get('api_key'), 'a+b&c');
});

test('Authorization flags without security schemes do not invent authentication options', () => {
    const authentication = getAuthenticationOptions({}, { bindings: { 'x-signalr': { authorizationRequired: true } } }, {});
    assert.deepEqual(authentication.options, []);
    assert.equal(authentication.required, true);
    assert.equal(authentication.declared, false);
    assert.deepEqual(bearerHub().authentication.options.map(option => option.label), ['Bearer']);
});

test('Clearing the Bearer selection prepares a connection and snippet without the saved token', () => {
    const endpoint = bearerHub();
    const settings = createSettings(endpoint);
    const bearer = settings.authentication;
    settings.credentials[bearer] = { token: 'example-token' };

    assert.equal(prepareConnection(endpoint, settings).token, 'example-token');
    settings.authentication = undefined;
    const connection = prepareConnection(endpoint, settings);
    assert.equal(connection.token, undefined);
    assert.equal(connection.headers.Authorization, undefined);
    assert.deepEqual(connection.secrets, []);
    assert.equal(prepareConnection(endpoint, settings, true).token, undefined);

    settings.authentication = bearer;
    assert.equal(prepareConnection(endpoint, settings).token, 'example-token');
});

test('Documented variables and query fields determine the URL for connections and snippets', () => {
    const channel = {
        address: '/hubs/{tenant}/events/{tenant}',
        parameters: { tenant: { $ref: '#/components/parameters/Tenant' } },
        bindings: { ws: { query: { $ref: '#/components/schemas/Query' } } }
    };
    const document = { components: {
        parameters: { Tenant: { enum: ['EU west #1', 'APAC'], default: 'EU west #1' } },
        schemas: { Query: { type: 'object', required: ['search'], properties: {
            search: { type: 'string' }, language: { type: 'string', default: 'en' },
            access_token: { type: 'string' }
        } } }
    } };
    const value = session();
    const endpoint = value.hub;
    endpoint.url = new URL('/gateway' + channel.address, 'https://example.com');
    endpoint.parameters = getConnectionParameters(document, channel);
    value.settings = createSettings(endpoint);
    const settings = value.settings;
    endpoint.transports = ['LongPolling'];
    settings.headers = [{ name: 'X-Tenant', value: 'tenant-one' }];
    assert.throws(() => prepareConnection(endpoint, settings), /Enter a value for search/);
    settings.query.search = 'one + two & three';
    settings.query.access_token = 'ignored';
    const prepared = prepareConnection(endpoint, settings);
    const url = new URL(prepared.url);
    assert.deepEqual(prepared.transports, ['LongPolling']);
    assert.deepEqual(prepared.headers, { 'X-Tenant': 'tenant-one' });
    assert.equal(url.pathname, '/gateway/hubs/EU%20west%20%231/events/EU%20west%20%231');
    assert.deepEqual([...url.searchParams], [['search', 'one + two & three'], ['language', 'en']]);
    assert.ok(generateSnippet('javascript', value).includes(prepared.url));
    settings.path.tenant = 'unknown';
    assert.throws(() => prepareConnection(endpoint, settings), /Select a documented value for tenant/);
});

test('A route variable is required and cannot change the structure of the endpoint path', () => {
    const endpoint = hub();
    const channel = { address: '/hubs/{name}/events' };
    endpoint.url = new URL(channel.address, 'https://example.com');
    endpoint.parameters = getConnectionParameters({}, channel);
    const settings = createSettings(endpoint);
    assert.deepEqual(endpoint.parameters.query, []);
    assert.throws(() => prepareConnection(endpoint, settings), /Enter a value for name/);
    for (const name of ['..', 'a/b', 'a\\b']) {
        settings.path.name = name;
        assert.throws(() => prepareConnection(endpoint, settings), /single path segment/);
    }
});

test('Browser-forbidden headers and duplicate names fail before connecting', () => {
    const endpoint = hub();
    for (const headers of [
        [{ name: 'Cookie', value: 'session=secret' }],
        [{ name: 'X-Value', value: 'one\r\ntwo' }],
        [{ name: 'X-Value', value: 'one' }, { name: 'x-value', value: 'two' }],
        [{ name: 'Authorization', value: 'Bearer secret' }]
    ]) {
        assert.throws(() => prepareConnection(endpoint, { ...createSettings(endpoint), headers }));
    }
});

test('Header authentication requires LongPolling and skip negotiation requires explicit WebSockets', () => {
    const authentication = getAuthenticationOptions({}, { security: [{ type: 'http', scheme: 'basic' }] }, {});
    const endpoint = hub(authentication);
    const settings = createSettings(endpoint);
    settings.credentials[authentication.options[0].credentials[0].id] = { username: 'user', password: 'secret' };
    assert.throws(() => prepareConnection(endpoint, settings), /requires LongPolling/);
    settings.transport = 'LongPolling';
    assert.equal(prepareConnection(endpoint, settings).headers.Authorization, 'Basic dXNlcjpzZWNyZXQ=');
    settings.skipNegotiation = true;
    assert.throws(() => prepareConnection(endpoint, settings), /requires the WebSockets/);
});

test('Negotiation diagnostics remove connection and access tokens, including nested secrets', () => {
    const response = negotiationDetails({ statusCode: 200, content: JSON.stringify({
        connectionId: 'public-id', connectionToken: 'private-connection', accessToken: 'private-access',
        availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }],
        extension: { password: 'private-password' }
    }) });
    assert.equal(response.response.connectionId, 'public-id');
    assert.equal(response.response.connectionToken, '[redacted]');
    assert.equal(response.response.extension.password, '[redacted]');
    assert.doesNotMatch(JSON.stringify(response), /private-/);
    assert.equal(redact('secret%2Bvalue secret+value', ['secret+value']), '[redacted] [redacted]');
});

test('Credential redaction covers Bearer prefixes and form-encoded opaque values', () => {
    const endpoint = bearerHub();
    const settings = createSettings(endpoint);
    settings.credentials[settings.authentication] = { token: 'Bearer token+value' };
    const prepared = prepareConnection(endpoint, settings);
    assert.equal(prepared.token, 'token+value');
    assert.equal(redact('token%2Bvalue', prepared.secrets), '[redacted]');
    assert.equal(redact('secret+with+spaces', ['secret with spaces']), '[redacted]');
});

for (const client of ['javascript', 'typescript']) {
    test(`${client} snippets register callbacks before starting and preserve multiple upload streams`, async () => {
        const value = session();
        value.method.inputStreams = ['first', 'second'];
        value.uploads = '[[1,2],[3,4]]';
        const calls = [];
        const connection = {
            on: (...args) => calls.push(['on', ...args]),
            start: async () => calls.push(['start']),
            invoke: async (...args) => { calls.push(['invoke', ...args]); return 'reply'; }
        };
        class Builder {
            withUrl(...args) { calls.push(['url', ...args]); return this; }
            build() { return connection; }
        }
        class Subject {
            items = [];
            next(item) { this.items.push(item); }
            complete() { this.completed = true; }
        }
        let code = generateSnippet(client, value).replace(/^import .+;\n/mu, '');
        if (client === 'typescript') {
            code = stripTypeScriptTypes(code);
        }
        const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
            'HubConnectionBuilder', 'HttpTransportType', 'Subject', 'console', code);
        await execute(Builder, { WebSockets: 1, ServerSentEvents: 2, LongPolling: 4 }, Subject, { log() {} });

        assert.ok(calls.findIndex(call => call[0] === 'on') < calls.findIndex(call => call[0] === 'start'));
        const invocation = calls.find(call => call[0] === 'invoke');
        assert.deepEqual(invocation[2], { text: 'example' });
        assert.deepEqual(invocation[4].items, [1, 2]);
        assert.deepEqual(invocation[5].items, [3, 4]);
        assert.equal(invocation[4].completed, true);
        assert.equal(invocation[5].completed, true);
    });
}

test('Every client uses credential placeholders and generates the selected method and connection settings', () => {
    const value = session();
    value.hub = bearerHub();
    value.settings = createSettings(value.hub);
    value.settings.credentials[value.settings.authentication] = { token: 'never-copy-this-token' };
    value.settings.transport = 'WebSockets';
    value.settings.skipNegotiation = true;
    for (const client of clients) {
        const code = generateSnippet(client.id, value);
        assert.match(code, /YOUR_ACCESS_TOKEN/);
        assert.doesNotMatch(code, /never-copy-this-token/);
        assert.match(code, /Echo/);
        assert.match(code, /Changed/);
        assert.ok(code.indexOf('Changed') < code.indexOf(client.id === 'csharp' ? 'StartAsync' : 'start()'));
        assert.equal(codeTokens(code).map(token => token.text).join(''), code);
    }
});

test('Streaming snippets use streaming APIs and malformed or unsupported examples explain why copying is unavailable', () => {
    const value = session();
    value.method.streamResult = true;
    assert.match(generateSnippet('javascript', value), /connection\.stream/);
    assert.match(generateSnippet('csharp', value), /StreamAsyncCore/);
    assert.match(generateSnippet('java', value), /connection\.stream/);
    value.settings.transport = 'ServerSentEvents';
    assert.throws(() => generateSnippet('java', value), /does not support ServerSentEvents/);
    value.settings.transport = 'Auto';
    value.arguments = '{}';
    assert.throws(() => generateSnippet('javascript', value), /must be a JSON array/);
});
