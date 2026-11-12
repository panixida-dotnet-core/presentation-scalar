import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

const assets = new URL('../../../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/', import.meta.url);
const markup = await readFile(new URL('console.html', assets), 'utf8');
const token = 'console-test-token';

function operation(channel, target, action = 'receive', settings = {}) {
    return {
        action,
        channel: { $ref: '#/channels/' + channel },
        bindings: {
            'x-signalr': { target, protocols: ['json'], transports: ['WebSockets'], ...settings }
        }
    };
}

function useDocument(t, paths) {
    const { window } = new JSDOM('', { url: 'https://example.test/gateway/scalar/' });
    const { document } = window;
    const root = document.createElement('div');
    root.id = 'panixida-signalr-console';
    root.dataset.documents = JSON.stringify(paths);
    root.dataset.pathBase = '/gateway';
    root.hidden = true;
    root.innerHTML = markup;
    document.body.append(root);
    for (const name of ['window', 'document', 'location', 'Option']) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
    }
    t.after(() => {
        for (const name of ['window', 'document', 'location', 'Option']) {
            Reflect.deleteProperty(globalThis, name);
        }
        window.close();
    });

    const dialog = root.querySelector('dialog');
    dialog.show = () => { dialog.open = true; };
    dialog.close = () => {
        dialog.open = false;
        dialog.dispatchEvent(new window.Event('close'));
    };

    return { root, window };
}

function createSignalRClient(requests, callbacks) {
    class JsonHubProtocol {
        parseMessages(input) {
            return input;
        }
    }

    class Subject {
        items = [];
        next(item) {
            this.items.push(item);
        }
        complete() {
            this.completed = true;
        }
    }

    class HubConnectionBuilder {
        withUrl(url, options) {
            this.url = url;
            this.options = options;
            return this;
        }
        withHubProtocol(protocol) {
            this.protocol = protocol;
            return this;
        }
        configureLogging() {
            return this;
        }
        build() {
            const emit = (target, ...args) => this.protocol.parseMessages([
                { type: 6 },
                { type: 1, target, arguments: args }
            ]);
            let onClose;
            return {
                onclose(callback) { onClose = callback; },
                start: async () => {
                    const suppliedToken = this.options.accessTokenFactory();
                    requests.push({ url: this.url, transport: this.options.transport, token: suppliedToken });
                    if (suppliedToken !== token) {
                        throw new Error('Rejected ' + suppliedToken);
                    }
                    callbacks.emit = emit;
                    callbacks.close = onClose;
                    emit('StateChangedAsync', 'connected');
                },
                async stop() { onClose(); },
                async send(target, ...args) { emit(target, ...args); },
                async invoke(target, value) {
                    if (target === 'Fail') {
                        throw new Error('Hub error');
                    }
                    return value.toUpperCase();
                },
                stream(_target, upload) {
                    return {
                        subscribe(observer) {
                            queueMicrotask(() => {
                                assert.equal(upload.completed, true);
                                upload.items.forEach(item => observer.next(item.toUpperCase()));
                                observer.complete();
                            });
                        }
                    };
                }
            };
        }
    }

    return {
        JsonHubProtocol,
        Subject,
        HubConnectionBuilder,
        HttpTransportType: { WebSockets: 1 },
        MessageType: { Invocation: 1 },
        LogLevel: { None: 6 }
    };
}

function submit(window, form, value = '') {
    const button = value ? form.querySelector('button[value="' + value + '"]') : form.querySelector('[type="submit"]');
    form.dispatchEvent(new window.SubmitEvent('submit', { submitter: button, cancelable: true }));
    return new Promise(resolve => setImmediate(resolve));
}

test('shows documented WebSocket hubs and exchanges commands, events and streams', async t => {
    const { root, window } = useDocument(t, ['/signalr.json', '/broken.json', '//elsewhere.test/spec.json']);
    t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(url.origin, 'https://example.test');
        if (url.pathname === '/gateway/broken.json') {
            return { ok: false };
        }
        assert.equal(url.pathname, '/gateway/signalr.json');
        return {
            ok: true,
            json: async () => ({
                channels: {
                    '/chat~hub': { address: '/hubs/chat' },
                    observer: { address: '/hubs/observer' },
                    external: { address: '//elsewhere.test/hubs/chat' }
                },
                operations: {
                    echo: operation('~1chat~0hub', 'Echo'),
                    duplex: operation('~1chat~0hub', 'Duplex', 'receive', { streamResult: true, inputStreams: ['items'] }),
                    callback: operation('observer', 'StateChangedAsync', 'send'),
                    external: operation('external', 'External'),
                    kafka: { action: 'send', bindings: { kafka: {} } },
                    longPolling: operation('observer', 'Polling', 'receive', { transports: ['LongPolling'] })
                }
            })
        };
    });
    const requests = [];
    const callbacks = {};
    let scriptLoads = 0;
    t.mock.method(window.document.head, 'append', script => {
        assert.match(script.src, /signalr\.min\.js$/);
        queueMicrotask(() => {
            scriptLoads++;
            if (scriptLoads === 1) {
                script.onerror();
            } else {
                window.signalR = createSignalRClient(requests, callbacks);
                script.onload();
            }
        });
    });
    await import(new URL('console.js', assets));

    const connection = root.querySelector('[data-connection]');
    const commands = root.querySelector('[data-command]');
    const log = root.querySelector('[role="log"]');
    const status = () => root.querySelector('[data-status]').textContent;
    const connect = () => submit(window, connection);
    const invoke = () => submit(window, commands, 'invoke');
    const method = name => {
        commands.elements.method.value = name;
        commands.elements.method.dispatchEvent(new window.Event('input'));
    };

    assert.equal(root.hidden, false);
    assert.deepEqual(Array.from(connection.elements.hub.options, option => option.textContent), [
        '/hubs/chat', '/hubs/observer'
    ]);
    root.querySelector('[data-open]').click();
    assert.equal(root.querySelector('dialog').open, true);
    assert.equal(commands.querySelector('[value="invoke"]').disabled, true);
    connection.elements.hub.value = '1';
    connection.elements.hub.dispatchEvent(new window.Event('change'));
    assert.equal(root.querySelector('datalist').childElementCount, 0);
    connection.elements.hub.value = '0';
    connection.elements.hub.dispatchEvent(new window.Event('change'));
    assert.equal(root.querySelector('datalist').childElementCount, 2);

    await connect();
    assert.match(log.textContent, /Could not load the SignalR client/);
    assert.equal(status(), 'Disconnected');

    connection.elements.token.value = 'wrong-token';
    await connect();
    assert.match(log.textContent, /Rejected \[redacted\]/);
    assert.doesNotMatch(log.textContent, /wrong-token/);
    assert.equal(status(), 'Disconnected');

    connection.elements.token.value = 'Bearer ' + token;
    await connect();
    assert.deepEqual(requests.at(-1), { url: 'https://example.test/gateway/hubs/chat', transport: 1, token });
    assert.equal(status(), 'Connected');
    assert.match(log.textContent, /Event\s+StateChangedAsync.*connected/s);

    method('Echo');
    commands.elements.arguments.value = '{}';
    await invoke();
    assert.match(log.textContent, /Arguments must be a JSON array/);
    commands.elements.arguments.value = '["hello"]';
    await invoke();
    assert.match(log.textContent, /Reply\s+Echo.*HELLO/s);

    method('Notify');
    await submit(window, commands, 'send');
    assert.match(log.textContent, /Sent\s+Notify/);
    assert.match(log.textContent, /Event\s+Notify.*hello/s);

    method('Duplex');
    commands.elements.arguments.value = '[]';
    commands.elements.uploads.value = '[]';
    await invoke();
    assert.match(log.textContent, /Enter one JSON array per upload stream/);
    commands.elements.uploads.value = '[["first", "second"]]';
    assert.equal(commands.querySelector('[value="send"]').disabled, true);
    await invoke();
    assert.match(log.textContent, /Stream item\s+Duplex.*FIRST.*SECOND.*Stream completed/s);

    method('Fail');
    await invoke();
    assert.match(log.textContent, /Error\s+Fail.*Hub error/s);
    root.querySelector('[data-hide]').click();
    assert.equal(root.querySelector('dialog').open, false);
    callbacks.emit('StateChangedAsync', 'while hidden');
    root.querySelector('[data-open]').click();
    assert.match(log.textContent, /Event\s+StateChangedAsync.*while hidden/s);
    assert.equal(status(), 'Connected');

    root.querySelector('[data-disconnect]').click();
    assert.equal(status(), 'Disconnected');
    await connect();
    callbacks.close(new Error('Socket closed: ' + token));
    assert.match(log.textContent, /Socket closed: \[redacted\]/);
    assert.doesNotMatch(log.textContent, new RegExp(token));
    assert.equal(status(), 'Disconnected');
    root.querySelector('[data-clear]').click();
    assert.equal(log.childElementCount, 0);
});

test('keeps the launcher hidden for AsyncAPI without a SignalR hub', async t => {
    const { root } = useDocument(t, ['/events.json']);
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ channels: {} }) }));

    const { initializeConsole } = await import(new URL('console.js', assets));
    await initializeConsole(root);

    assert.equal(root.hidden, true);
});
