import { addDocumentRequests, addTestRequests, getDocumentPaths } from './requests.js';
import { connectionAddress, connectionPath, createSettings, negotiationDetails, prepareConnection, redact } from './connection.js';
import { mountConnectionControls, mountSnippet, renderEvents } from './view.js';

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
    session.action = 'invoke';
}

function mountConsole(root, requests) {
    const dialog = root.querySelector('dialog');
    const title = root.querySelector('h2');
    const address = root.querySelector('[data-address]');
    const origin = root.querySelector('[data-origin]');
    const copyAddress = root.querySelector('[data-copy-address]');
    const connectionForm = root.querySelector('#panixida-signalr-connection');
    const commandForm = root.querySelector('[data-command]');
    const methodSelect = commandForm.elements.method;
    const argumentsInput = commandForm.elements.arguments;
    const uploadsInput = commandForm.elements.uploads;
    const uploadsField = root.querySelector('[data-uploads]');
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
    const controls = mountConnectionControls(root, () => current, () => {
        renderAddress(current);
        updateStatus(current);
        snippet.render();
    });
    const snippet = mountSnippet(root, () => current);

    function renderAddress(session) {
        origin.textContent = session.hub.url.origin;
        try {
            address.textContent = connectionPath(session.hub, session.settings);
        } catch {
            address.textContent = session.hub.url.pathname.replaceAll('%7B', '{').replaceAll('%7D', '}');
        }
        copyAddress.title = 'Copy hub URL';
    }

    function write(session, kind, target, value, secrets = session.secrets ?? []) {
        const entry = {
            kind,
            target: redact(target, secrets),
            time: new Date(),
            payload: value === undefined ? undefined : redact(JSON.stringify(value, null, 2), secrets).slice(0, 16384)
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
        statusOutput.textContent = ready ? 'Connected · JSON · ' + session.settings.transport : session.status;
        statusOutput.dataset.connected = String(ready);
        controls.setDisabled(session);
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
        const { hub } = session;
        title.textContent = method?.title ?? (hub.title === hub.address ? 'SignalR Test Request' : hub.title);
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
        snippet.render();
    }

    function openRequest({ hub, method }, trigger) {
        let session = sessions.get(hub);
        if (!session) {
            session = { hub, status: disconnected, connection: null, settings: createSettings(hub), secrets: [], entries: [] };
            sessions.set(hub, session);
        }

        const selected = method ?? session.method ?? hub.methods.values().next().value;
        if (selected && (method || session.method !== selected)) {
            selectMethod(session, selected);
        }

        current = session;
        opener = trigger;
        renderAddress(session);
        controls.render(session);
        commandForm.hidden = hub.methods.size === 0;
        methodSelect.replaceChildren(...Array.from(hub.methods, ([key, item]) => new Option(item.title, key)));
        renderEvents(root, hub);
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
        const { hub } = session;
        let candidate;
        try {
            const prepared = prepareConnection(hub, session.settings);
            session.secrets = prepared.secrets;
            const signalR = await loadSignalR();
            const protocol = observeCallbacks(signalR,
                message => write(session, 'Event', message.target, message.arguments));
            const client = new signalR.DefaultHttpClient(signalR.NullLogger.instance);
            class DiagnosticHttpClient extends signalR.HttpClient {
                async send(request) {
                    const negotiation = new URL(request.url).pathname.endsWith('/negotiate');
                    try {
                        const response = await client.send(request);
                        if (negotiation) {
                            write(session, 'Negotiation', hub.address, negotiationDetails(response));
                        }
                        return response;
                    } catch (error) {
                        if (negotiation) {
                            write(session, 'Negotiation', hub.address, { statusCode: error.statusCode, error: error.message });
                        }
                        throw error;
                    }
                }

                getCookieString(url) {
                    return client.getCookieString(url);
                }
            }
            candidate = new signalR.HubConnectionBuilder()
                .withUrl(prepared.url, {
                    transport: prepared.transports.reduce((value, name) => value | signalR.HttpTransportType[name], 0),
                    accessTokenFactory: prepared.token ? () => prepared.token : undefined,
                    headers: prepared.headers,
                    skipNegotiation: prepared.skipNegotiation,
                    withCredentials: prepared.withCredentials,
                    httpClient: new DiagnosticHttpClient()
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
                    error ? error.message : disconnected);
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
                write(session, 'Error', hub.address, error.message);
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
                write(session, 'Error', session.hub.address, error.message);
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
        const fail = error => write(session, 'Error', target, error.message);
        try {
            const args = readArray(session.arguments, 'Arguments');
            const uploads = createUploads(window.signalR, session.uploads, method.inputStreams);
            const parameters = args.concat(uploads.map(upload => upload.subject));
            const sendOnly = event.submitter?.value === 'send';
            session.action = sendOnly ? 'send' : 'invoke';
            snippet.render();
            const command = sendOnly ? 'Send' : 'Invoke';
            const connection = session.connection;

            write(session, method.streamResult ? 'Stream' : command, target, args);
            if (method.streamResult) {
                connection.stream(target, ...parameters).subscribe({
                    next: item => write(session, 'Stream item', target, item),
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
                write(session, sendOnly ? 'Sent' : 'Reply', target, result);
            }
        } catch (error) {
            fail(error);
        }
    }

    root.querySelector('[data-hide]').addEventListener('click', () => dialog.close());
    copyAddress.addEventListener('click', async () => {
        try {
            const url = connectionAddress(current.hub, current.settings);
            await navigator.clipboard.writeText(url.href);
            copyAddress.title = 'Copied';
        } catch (error) {
            copyAddress.title = error.message;
        }
    });
    dialog.addEventListener('close', () => {
        controls.close();
        snippet.close();
        if (!dialog.open && opener?.isConnected) {
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
    argumentsInput.addEventListener('input', () => { current.arguments = argumentsInput.value; snippet.render(); });
    uploadsInput.addEventListener('input', () => { current.uploads = uploadsInput.value; snippet.render(); });
    root.hidden = false;
    addTestRequests(requests, openRequest);
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
