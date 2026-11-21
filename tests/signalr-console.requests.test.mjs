import assert from 'node:assert/strict';
import test from 'node:test';

import { addDocumentRequests, getDocumentPaths } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/requests.js';

test('Scalar document IDs follow configured source titles, including HTTP sources', () => {
    const documents = [
        { title: 'Example API', path: null },
        { title: 'Example API', path: '/first.json' },
        { title: 'Example_API', path: '/second.json' },
        { title: 'Other', path: '/other.json' },
        { title: 'Other API', path: null }
    ];

    assert.deepEqual(getDocumentPaths(documents), [
        ['example-api-1', '/first.json'],
        ['example-api-2', '/second.json'],
        ['other', '/other.json']
    ]);
});

function operation(channel, action, target, binding = {}) {
    return {
        channel: { $ref: '#/channels/' + channel },
        action,
        bindings: { 'x-signalr': { target, protocols: ['json'], transports: ['WebSockets'], ...binding } }
    };
}

test('Each SignalR channel exposes its own callable methods and observed events', () => {
    const document = {
        channels: {
            'chat/v1': { address: '/chat', title: 'Chat' },
            Updates: { address: '/updates' },
            Unsupported: { address: '/sse' }
        },
        operations: {
            Echo: {
                ...operation('chat~1v1', 'receive', 'Echo'),
                messages: [{ $ref: '#/components/messages/Echo' }]
            },
            Upload: operation('chat~1v1', 'receive', 'Upload', { streamResult: true, inputStreams: ['values'] }),
            Item: operation('chat~1v1', 'receive', 'Upload', { messageType: 'streamItem' }),
            Changed: operation('Updates', 'send', 'ChangedAsync'),
            Sse: operation('Unsupported', 'receive', 'Sse', { transports: ['ServerSentEvents'] })
        },
        components: {
            messages: {
                Echo: {
                    payload: {
                        type: 'object',
                        properties: {
                            arguments: {
                                type: 'array',
                                prefixItems: [{ type: 'string', default: 'example' }]
                            }
                        }
                    }
                }
            }
        }
    };
    const requests = new Map();
    const getUrl = address => address && new URL(address, 'https://example.com');
    addDocumentRequests(requests, 'first', document, getUrl);
    addDocumentRequests(requests, 'second', document, getUrl);

    const chat = requests.get('first/channel/chatv1').hub;
    const echo = requests.get('first/channel/chatv1/operation/echo');
    const upload = requests.get('first/channel/chatv1/operation/upload');
    const updates = requests.get('first/channel/updates').hub;
    assert.equal(chat.url.href, 'https://example.com/chat');
    assert.equal(chat.title, 'Chat');
    assert.equal(echo.hub, chat);
    assert.deepEqual(echo.method.arguments(), ['example']);
    assert.deepEqual([...chat.methods.keys()], ['echo', 'upload']);
    assert.equal(upload.method.streamResult, true);
    assert.deepEqual(upload.method.inputStreams, ['values']);
    assert.deepEqual([...updates.events.values()].map(value => value.target), ['ChangedAsync']);
    assert.equal(updates.methods.size, 0);
    assert.equal(requests.has('first/channel/chatv1/operation/item'), false);
    assert.equal(requests.has('first/channel/updates/operation/changed'), false);
    assert.deepEqual(requests.get('first/channel/unsupported').hub.transports, ['ServerSentEvents']);
    assert.notEqual(chat, requests.get('second/channel/chatv1').hub);
});

test('SignalR uses a versioned document slug and the published channel title', () => {
    const [source] = getDocumentPaths([
        { title: 'Matchmaking API v1', path: null },
        { title: 'Matchmaking SignalR v1', path: '/matchmaking-signalr-v1.json' }
    ]);
    const address = '/api/v1/match-searches/state';
    const requests = new Map();
    addDocumentRequests(requests, source[0], {
        channels: { 'match-searches-state': { address, title: 'Matchmaking' } },
        operations: { 'read-state': operation('match-searches-state', 'receive', 'ReadState') }
    }, path => new URL(path, 'https://example.com'));

    const request = requests.get('matchmaking-signalr-v1/channel/match-searches-state/operation/read-state');
    assert.equal(request.hub.title, 'Matchmaking');
    assert.equal(request.hub.url.href, 'https://example.com' + address);
    assert.equal(request.method.target, 'ReadState');
});
