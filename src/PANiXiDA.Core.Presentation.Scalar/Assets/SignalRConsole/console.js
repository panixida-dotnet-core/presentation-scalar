import { addDocumentRequests, addTestRequests, getDocumentPaths } from './requests.js';

const connected = 'Connected';
const disconnected = 'Disconnected';

async function initializeConsole(root) {
    if (!root) {
        return;
    }

    const requests = await loadRequests(getDocumentPaths(JSON.parse(root.dataset.documents)), root.dataset.pathBase);
    if (requests.size > 0) {
        mountConsole(root, requests);
    }
}

async function loadRequests(paths, pathBase) {
    const documents = await Promise.allSettled(paths.map(async ([slug, path]) => {
        const url = sameOriginUrl(path, pathBase);
        if (!url) {
            throw new Error('Expected a local AsyncAPI document.');
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Could not load the AsyncAPI document.');
        }

        return [slug, await response.json()];
    }));

    const requests = new Map();
    for (const document of documents) {
        if (document.status === 'fulfilled') {
            const [slug, source] = document.value;
            addDocumentRequests(requests, slug, source, address => sameOriginUrl(address, pathBase));
        }
    }
    return requests;
}

function sameOriginUrl(path, pathBase) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
        return null;
    }

    const url = new URL(pathBase + path, location.origin);
    return url.origin === location.origin && !url.search && !url.hash ? url : null;
}

function createEntry({ kind, target, time, payload }) {
    const item = document.createElement('li');
    item.dataset.kind = kind;
    const heading = document.createElement('div');
    const timestamp = document.createElement('time');
    timestamp.dateTime = time.toISOString();
    timestamp.textContent = time.toLocaleTimeString();
    const label = document.createElement('span');
    label.textContent = kind;
    const name = document.createElement('code');
    name.textContent = target;
    heading.append(timestamp, label, name);
    item.append(heading);
    if (payload !== undefined) {
        const body = document.createElement('pre');
        body.textContent = payload;
        item.append(body);
    }
    return item;
}

function selectMethod(session, method) {
    session.method = method;
    session.arguments = JSON.stringify(method.arguments(), null, 2);
    session.uploads = JSON.stringify(method.inputStreams.map(() => []), null, 2);
}

function mountConsole(root, requests) {
    const dialog = root.querySelector('dialog');
    const title = root.querySelector('h2');
    const address = root.querySelector('[data-address]');
    const connectionForm = root.querySelector('#panixida-signalr-connection');
    const commandForm = root.querySelector('[data-command]');
    const tokenInput = connectionForm.elements.token;
    const methodSelect = commandForm.elements.method;
    const argumentsInput = commandForm.elements.arguments;
    const uploadsInput = commandForm.elements.uploads;
    const uploadsField = root.querySelector('[data-uploads]');
    const events = root.querySelector('[data-events]');
    const journal = root.querySelector('.signalr-journal');
    const messages = journal.querySelector('ol');
    const emptyLog = journal.querySelector('[data-empty]');
    const statusOutput = root.querySelector('[data-status]');
    const disconnect = root.querySelector('[data-disconnect]');
    const connect = root.querySelector('[data-connect]');
    const invoke = commandForm.querySelector('[value="invoke"]');
    const send = commandForm.querySelector('[value="send"]');
    const sessions = new Map();
    let current;
    let opener;

    function write(session, kind, target, value, token = '') {
        const entry = {
            kind,
            target: redact(target, token),
            time: new Date(),
            payload: value === undefined ? undefined : redact(JSON.stringify(value, null, 2), token).slice(0, 16384)
        };
        session.entries.push(entry);
        const trim = session.entries.length > 150;
        if (trim) {
            session.entries.shift();
        }

        if (current === session && dialog.open) {
            const atBottom = journal.scrollHeight - journal.scrollTop - journal.clientHeight <= 12;
            emptyLog.hidden = true;
            messages.append(createEntry(entry));
            if (trim) {
                messages.firstElementChild.remove();
            }
            if (atBottom) {
                journal.scrollTop = journal.scrollHeight;
            }
        }
    }

    function updateStatus(session) {
        if (current !== session) {
            return;
        }

        const ready = session.status === connected;
        const idle = session.status === disconnected;
        statusOutput.textContent = ready ? 'Connected · JSON · WebSockets' : session.status;
        statusOutput.dataset.connected = String(ready);
        tokenInput.disabled = !idle;
        connect.hidden = ready || session.status === 'Disconnecting…';
        connect.disabled = !idle;
        connect.textContent = session.status === 'Connecting…' ? session.status : 'Connect';
        disconnect.hidden = !connect.hidden;
        disconnect.disabled = !ready;
        invoke.disabled = !ready || !session.method;
        send.disabled = !ready || !session.method || session.method.streamResult;
        emptyLog.textContent = ready ? 'Waiting for messages from the hub.' : 'Connect to receive messages.';
        emptyLog.hidden = session.entries.length > 0;
    }

    function renderMethod(session) {
        const method = session.method;
        const inputs = method?.inputStreams ?? [];
        if (method) {
            methodSelect.value = method.target.toLowerCase();
            argumentsInput.value = session.arguments;
            uploadsInput.value = session.uploads;
        }
        uploadsField.hidden = inputs.length === 0;
        uploadsField.querySelector('span').textContent = inputs.join(', ');
        invoke.textContent = method?.streamResult ? 'Stream' : 'Invoke';
        send.hidden = method?.streamResult === true;
        updateStatus(session);
    }

    function openRequest({ hub, method }, trigger) {
        let session = sessions.get(hub);
        if (!session) {
            session = { hub, status: disconnected, connection: null, token: '', entries: [] };
            sessions.set(hub, session);
        }

        const selected = method ?? session.method ?? hub.methods.values().next().value;
        if (selected && (method || session.method !== selected)) {
            selectMethod(session, selected);
        }

        current = session;
        opener = trigger;
        title.textContent = hub.title;
        address.textContent = hub.url.href;
        tokenInput.value = session.token;
        commandForm.hidden = hub.methods.size === 0;
        methodSelect.replaceChildren(...Array.from(hub.methods, ([key, item]) => new Option(item.title, key)));
        events.replaceChildren(...Array.from(hub.events.values(), target => {
            const entry = document.createElement('li');
            const name = document.createElement('code');
            name.textContent = target;
            entry.append(name);
            return entry;
        }));
        root.querySelector('[data-no-events]').hidden = hub.events.size > 0;
        messages.replaceChildren(...session.entries.map(createEntry));
        renderMethod(session);

        if (!dialog.open) {
            dialog.showModal();
        }
        journal.scrollTop = journal.scrollHeight;
    }

    async function start(event) {
        event.preventDefault();
        const session = current;
        if (session?.status !== disconnected) {
            return;
        }

        session.status = 'Connecting…';
        updateStatus(session);
        session.token = tokenInput.value;
        const token = bearerToken(session.token);
        const { hub } = session;
        let candidate;
        try {
            const signalR = await loadSignalR();
            const protocol = observeCallbacks(signalR,
                message => write(session, 'Event', message.target, message.arguments, token));
            candidate = new signalR.HubConnectionBuilder()
                .withUrl(hub.url.href, {
                    transport: signalR.HttpTransportType.WebSockets,
                    accessTokenFactory: () => token
                })
                .withHubProtocol(protocol)
                .configureLogging(signalR.LogLevel.None)
                .build();
            session.connection = candidate;
            candidate.onclose(error => {
                if (session.connection !== candidate) {
                    return;
                }
                session.connection = null;
                session.status = disconnected;
                write(session, error ? 'Error' : 'Connection', hub.address,
                    error ? error.message : disconnected, token);
                updateStatus(session);
            });

            await candidate.start();
            if (session.connection === candidate) {
                session.status = connected;
                write(session, 'Connection', hub.address, connected);
            }
        } catch (error) {
            if (!candidate || session.connection === candidate) {
                session.connection = null;
                session.status = disconnected;
                write(session, 'Error', hub.address, error.message, token);
            }
        }

        updateStatus(session);
    }

    async function stop() {
        const session = current;
        if (session.status !== connected) {
            return;
        }

        session.status = 'Disconnecting…';
        updateStatus(session);
        const connection = session.connection;
        try {
            await connection.stop();
        } catch (error) {
            if (session.connection === connection) {
                write(session, 'Error', session.hub.address, error.message, bearerToken(session.token));
                session.status = connected;
                updateStatus(session);
            }
        }
    }

    async function submitCommand(event) {
        event.preventDefault();
        const session = current;
        const method = session?.method;
        if (!method || session.status !== connected) {
            return;
        }

        const { target } = method;
        const token = bearerToken(session.token);
        const fail = error => write(session, 'Error', target, error.message, token);
        try {
            const args = readArray(session.arguments, 'Arguments');
            const uploads = createUploads(window.signalR, session.uploads, method.inputStreams);
            const parameters = args.concat(uploads.map(upload => upload.subject));
            const sendOnly = event.submitter?.value === 'send';
            const command = sendOnly ? 'Send' : 'Invoke';
            const connection = session.connection;

            write(session, method.streamResult ? 'Stream' : command, target, args, token);
            if (method.streamResult) {
                connection.stream(target, ...parameters).subscribe({
                    next: item => write(session, 'Stream item', target, item, token),
                    complete: () => write(session, 'Stream completed', target),
                    error: fail
                });
                publishUploads(uploads);
            } else {
                const pending = sendOnly
                    ? connection.send(target, ...parameters)
                    : connection.invoke(target, ...parameters);
                publishUploads(uploads);
                const result = await pending;
                write(session, sendOnly ? 'Sent' : 'Reply', target, result, token);
            }
        } catch (error) {
            fail(error);
        }
    }

    root.querySelector('[data-hide]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        if (!dialog.open && opener.isConnected) {
            opener.focus({ preventScroll: true });
        }
    });
    root.querySelector('[data-clear]').addEventListener('click', () => {
        current.entries.length = 0;
        messages.replaceChildren();
        emptyLog.hidden = false;
    });
    connectionForm.addEventListener('submit', start);
    disconnect.addEventListener('click', stop);
    commandForm.addEventListener('submit', submitCommand);
    methodSelect.addEventListener('change', () => {
        selectMethod(current, current.hub.methods.get(methodSelect.value));
        renderMethod(current);
    });
    tokenInput.addEventListener('input', () => { current.token = tokenInput.value; });
    argumentsInput.addEventListener('input', () => { current.arguments = argumentsInput.value; });
    uploadsInput.addEventListener('input', () => { current.uploads = uploadsInput.value; });
    root.hidden = false;
    addTestRequests(requests, openRequest);
}

function bearerToken(value) {
    return value.trim().replace(/^Bearer\s+/i, '');
}

function redact(text, token) {
    if (!token) {
        return text;
    }
    const variants = new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]);
    for (const variant of variants) {
        text = text.replaceAll(variant, '[redacted]');
    }
    return text;
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

await initializeConsole(document.getElementById('panixida-signalr-console'));
