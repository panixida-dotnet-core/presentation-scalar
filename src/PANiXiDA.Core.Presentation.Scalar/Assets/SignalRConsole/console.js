const connected = 'Connected';
const disconnected = 'Disconnected';

export async function initializeConsole(root) {
    if (!root) {
        return;
    }

    const hubs = await loadHubs(JSON.parse(root.dataset.documents), root.dataset.pathBase);
    if (hubs.length > 0) {
        mountConsole(root, hubs);
    }
}

async function loadHubs(paths, pathBase) {
    const documents = await Promise.allSettled(paths.map(async path => {
        const url = sameOriginUrl(path, pathBase);
        if (!url) {
            throw new Error('Expected a local AsyncAPI document.');
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Could not load the AsyncAPI document.');
        }

        return response.json();
    }));

    const hubs = new Map();
    for (const document of documents) {
        if (document.status === 'fulfilled') {
            readOperations(document.value, pathBase, hubs);
        }
    }

    return [...hubs.values()];
}

function readOperations(document, pathBase, hubs) {
    const channelPrefix = '#/channels/';
    for (const operation of Object.values(document?.operations ?? {})) {
        const binding = operation?.bindings?.['x-signalr'];
        const reference = operation?.channel?.$ref;
        if (!Array.isArray(binding?.protocols) || !binding.protocols.includes('json') ||
            !Array.isArray(binding.transports) || !binding.transports.includes('WebSockets') ||
            typeof reference !== 'string' || !reference.startsWith(channelPrefix) || typeof binding.target !== 'string') {
            continue;
        }

        const channelKey = reference.slice(channelPrefix.length).replaceAll('~1', '/').replaceAll('~0', '~');
        const address = document.channels?.[channelKey]?.address;
        const url = sameOriginUrl(address, pathBase);
        if (!url) {
            continue;
        }

        let hub = hubs.get(url.href);
        if (!hub) {
            hub = { url, address, methods: new Map() };
            hubs.set(url.href, hub);
        }

        if (operation.action === 'receive') {
            hub.methods.set(binding.target.toLowerCase(), {
                target: binding.target,
                title: operation.title ?? binding.target,
                streamResult: binding.streamResult === true,
                inputStreams: Array.isArray(binding.inputStreams) ? binding.inputStreams : []
            });
        }
    }
}

function sameOriginUrl(path, pathBase) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
        return null;
    }

    const url = new URL(pathBase + path, location.origin);
    return url.origin === location.origin && !url.search && !url.hash ? url : null;
}

function mountConsole(root, hubs) {
    const dialog = root.querySelector('dialog');
    const open = root.querySelector('[data-open]');
    const connectionForm = root.querySelector('[data-connection]');
    const commandForm = root.querySelector('[data-command]');
    const hubSelect = connectionForm.elements.hub;
    const tokenInput = connectionForm.elements.token;
    const methodInput = commandForm.elements.method;
    const uploadsField = root.querySelector('[data-uploads]');
    const methods = root.querySelector('datalist');
    const messages = root.querySelector('[role="log"]');
    const disconnect = root.querySelector('[data-disconnect]');
    const connect = connectionForm.querySelector('button[type="submit"]');
    const invoke = commandForm.querySelector('[value="invoke"]');
    const send = commandForm.querySelector('[value="send"]');
    let connection = null;
    let status = disconnected;

    const selectedHub = () => hubs[Number(hubSelect.value)];
    const selectedMethod = () => selectedHub().methods.get(methodInput.value.trim().toLowerCase());

    function write(kind, target, value) {
        const item = document.createElement('li');
        const payload = value === undefined ? '' : '\n' + JSON.stringify(value, null, 2).slice(0, 16384);
        item.textContent = new Date().toLocaleTimeString() + '  ' + kind + '  ' + target + payload;
        messages.append(item);
        if (messages.childElementCount > 150) {
            messages.firstElementChild.remove();
        }

        messages.scrollTop = messages.scrollHeight;
    }

    function updateControls() {
        const ready = status === connected;
        const idle = status === disconnected;
        const method = selectedMethod();
        const inputs = method?.inputStreams ?? [];
        const streamResult = method?.streamResult ?? false;

        root.querySelector('[data-status]').textContent = status;
        hubSelect.disabled = !idle;
        tokenInput.disabled = !idle;
        connect.disabled = !idle;
        disconnect.disabled = !ready;
        invoke.disabled = !ready;
        invoke.textContent = streamResult ? 'Stream' : 'Invoke';
        send.disabled = !ready || streamResult;
        uploadsField.hidden = inputs.length === 0;
        uploadsField.querySelector('span').textContent = inputs.join(', ');
        commandForm.elements.uploads.placeholder = JSON.stringify(inputs.map(() => []));
    }

    function updateHub() {
        methodInput.value = '';
        commandForm.elements.arguments.value = '[]';
        commandForm.elements.uploads.value = '';
        methods.replaceChildren(...Array.from(selectedHub().methods.values(),
            method => new Option(method.title, method.target)));
        updateControls();
    }

    async function start(event) {
        event.preventDefault();
        if (status !== disconnected) {
            return;
        }

        status = 'Connecting…';
        updateControls();
        const token = tokenInput.value.trim().replace(/^Bearer\s+/i, '');
        const hub = selectedHub();
        try {
            const signalR = await loadSignalR();
            const protocol = observeCallbacks(signalR, message => write('Event', message.target, message.arguments));
            const candidate = new signalR.HubConnectionBuilder()
                .withUrl(hub.url.href, {
                    transport: signalR.HttpTransportType.WebSockets,
                    accessTokenFactory: () => token
                })
                .withHubProtocol(protocol)
                .configureLogging(signalR.LogLevel.None)
                .build();
            connection = candidate;
            candidate.onclose(error => {
                connection = null;
                status = disconnected;
                updateControls();
                if (error) {
                    write('Error', hub.address, redact(error, token));
                }
            });

            await candidate.start();
            status = connection ? connected : disconnected;
        } catch (error) {
            connection = null;
            status = disconnected;
            write('Error', hub.address, redact(error, token));
        }

        updateControls();
    }

    async function stop() {
        if (status !== connected) {
            return;
        }

        status = 'Disconnecting…';
        updateControls();
        try {
            await connection.stop();
        } catch (error) {
            write('Error', selectedHub().address, redact(error, tokenInput.value.trim()));
            status = connection ? connected : disconnected;
            updateControls();
        }
    }

    async function submitCommand(event) {
        event.preventDefault();
        if (status !== connected) {
            return;
        }

        const target = methodInput.value.trim();
        const method = selectedMethod();
        const token = tokenInput.value.trim().replace(/^Bearer\s+/i, '');
        const fail = error => write('Error', target, redact(error, token));
        try {
            const args = readArray(commandForm.elements.arguments.value, 'Arguments');
            const uploads = createUploads(window.signalR, commandForm.elements.uploads.value, method?.inputStreams);
            const parameters = args.concat(uploads.map(upload => upload.subject));
            const mode = event.submitter?.value ?? 'invoke';

            write('→', target, args);
            if (method?.streamResult) {
                connection.stream(target, ...parameters).subscribe({
                    next: item => write('Stream item', target, item),
                    complete: () => write('Stream completed', target),
                    error: fail
                });
                publishUploads(uploads);
            } else {
                const pending = mode === 'send'
                    ? connection.send(target, ...parameters)
                    : connection.invoke(target, ...parameters);
                publishUploads(uploads);
                const result = await pending;
                write(mode === 'send' ? 'Sent' : 'Reply', target, result);
            }
        } catch (error) {
            fail(error);
        }
    }

    for (const [index, hub] of hubs.entries()) {
        hubSelect.add(new Option(hub.address, String(index)));
    }

    open.addEventListener('click', () => {
        open.hidden = true;
        dialog.show();
        messages.scrollTop = messages.scrollHeight;
    });
    root.querySelector('[data-hide]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        open.hidden = false;
        open.focus();
    });
    root.querySelector('[data-clear]').addEventListener('click', () => messages.replaceChildren());
    connectionForm.addEventListener('submit', start);
    disconnect.addEventListener('click', stop);
    commandForm.addEventListener('submit', submitCommand);
    hubSelect.addEventListener('change', updateHub);
    methodInput.addEventListener('input', updateControls);
    updateHub();
    root.hidden = false;
}

let signalRLoad;

function loadSignalR() {
    signalRLoad ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./signalr.min.js', import.meta.url).href;
        script.onload = () => resolve(window.signalR);
        script.onerror = () => {
            script.remove();
            reject(new Error('Could not load the SignalR client.'));
        };
        document.head.append(script);
    }).catch(error => {
        signalRLoad = undefined;
        throw error;
    });

    return signalRLoad;
}

function observeCallbacks(signalR, onEvent) {
    class ConsoleProtocol extends signalR.JsonHubProtocol {
        parseMessages(input, logger) {
            const messages = super.parseMessages(input, logger);
            for (const message of messages) {
                if (message.type === signalR.MessageType.Invocation) {
                    onEvent(message);
                }
            }

            return messages;
        }
    }

    return new ConsoleProtocol();
}

function readArray(value, label) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new TypeError(label + ' must be a JSON array.');
    }

    return parsed;
}

function createUploads(signalR, value, names = []) {
    if (names.length === 0) {
        return [];
    }

    const inputs = readArray(value, 'Upload streams');
    if (inputs.length !== names.length || !inputs.every(Array.isArray)) {
        throw new Error('Enter one JSON array per upload stream.');
    }

    return inputs.map(items => ({ subject: new signalR.Subject(), items }));
}

function publishUploads(uploads) {
    for (const { subject, items } of uploads) {
        for (const item of items) {
            subject.next(item);
        }

        subject.complete();
    }
}

function redact(error, token) {
    const message = error instanceof Error ? error.message : String(error);
    return token ? message.replaceAll(token, '[redacted]').replaceAll(encodeURIComponent(token), '[redacted]') : message;
}

await initializeConsole(document.getElementById('panixida-signalr-console'));
