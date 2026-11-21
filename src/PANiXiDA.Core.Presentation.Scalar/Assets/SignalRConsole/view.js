import { getArgumentSchemas } from './schema.js';
import { clients, codeTokens, generateSnippet } from './snippets.js';

function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) {
        element.className = className;
    }
    return element;
}

export function mountConnectionControls(root, getSession, onChange) {
    const form = root.querySelector('#panixida-signalr-connection');
    const authentication = form.elements.authentication;
    const transport = form.elements.transport;
    const fields = root.querySelector('[data-credentials]');

    function renderCredentials() {
        const { hub, settings } = getSession();
        const option = hub.authentication.options.find(value => value.id === settings.authentication);
        fields.replaceChildren();
        for (const item of option?.credentials ?? []) {
            const group = document.createElement('div');
            group.className = 'signalr-fields';
            if (item.description) {
                group.append(textElement('p', item.description, 'signalr-help'));
            }
            if (item.kind === 'cookie') {
                group.append(textElement('p', `Uses browser cookies for this API${item.name ? ' (' + item.name + ')' : ''}. Cookies are sent according to browser domain and SameSite rules.`, 'signalr-help'));
            } else if (item.kind === 'unsupported') {
                group.append(textElement('p', 'This scheme is not supported by the browser client.', 'signalr-help'));
            } else {
                if (item.tokenSource) {
                    group.append(textElement('p', 'Enter an issued access token. OAuth login and token refresh are handled by your identity provider.', 'signalr-help'));
                }
                if (item.scopes?.length) {
                    group.append(textElement('p', 'Required scopes: ' + item.scopes.join(', '), 'signalr-help'));
                }
                const names = item.kind === 'basic' ? ['username', 'password'] : [item.kind === 'apiKey' ? 'value' : 'token'];
                for (const name of names) {
                    const label = textElement('label', names.length > 1 ? `${item.label}: ${name}` : item.label);
                    const input = document.createElement('input');
                    input.type = name === 'username' ? 'text' : 'password';
                    input.autocomplete = 'off';
                    input.spellcheck = false;
                    input.maxLength = 8192;
                    input.value = settings.credentials[item.id]?.[name] ?? '';
                    input.addEventListener('input', () => {
                        settings.credentials[item.id] ??= {};
                        settings.credentials[item.id][name] = input.value;
                        onChange();
                    });
                    label.append(input);
                    group.append(label);
                }
            }
            fields.append(group);
        }
    }

    function renderPairs(kind) {
        const { settings } = getSession();
        const container = root.querySelector(`[data-pairs="${kind}"]`);
        container.replaceChildren();
        for (const [index, pair] of settings[kind].entries()) {
            const row = document.createElement('div');
            row.className = 'signalr-pair';
            for (const name of ['name', 'value']) {
                const input = document.createElement('input');
                input.type = 'text';
                input.autocomplete = 'off';
                input.spellcheck = false;
                input.placeholder = name === 'name' ? 'Key' : 'Value';
                input.setAttribute('aria-label', `${kind} ${index + 1} ${name}`);
                input.value = pair[name];
                input.addEventListener('input', () => { pair[name] = input.value; onChange(); });
                row.append(input);
            }
            const remove = textElement('button', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove ${kind} ${index + 1}`);
            remove.addEventListener('click', () => {
                settings[kind].splice(index, 1);
                renderPairs(kind);
                onChange();
            });
            row.append(remove);
            container.append(row);
        }
    }

    authentication.addEventListener('change', () => {
        getSession().settings.authentication = authentication.value;
        renderCredentials();
        onChange();
    });
    transport.addEventListener('change', () => {
        const { settings } = getSession();
        settings.transport = transport.value;
        if (transport.value !== 'WebSockets') {
            settings.skipNegotiation = false;
            form.elements.skipNegotiation.checked = false;
        }
        onChange();
    });
    for (const name of ['skipNegotiation', 'withCredentials']) {
        form.elements[name].addEventListener('change', () => {
            getSession().settings[name] = form.elements[name].checked;
            onChange();
        });
    }
    for (const kind of ['headers', 'query']) {
        root.querySelector(`[data-add="${kind}"]`).addEventListener('click', () => {
            getSession().settings[kind].push({ name: '', value: '' });
            renderPairs(kind);
            onChange();
        });
    }
    return {
        render(session) {
            const { hub, settings } = session;
            authentication.replaceChildren(...hub.authentication.options.map(value => {
                const option = new Option(value.label, value.id);
                option.disabled = value.credentials.some(item => item.kind === 'unsupported');
                return option;
            }));
            authentication.value = settings.authentication;
            transport.replaceChildren(...['Auto', ...hub.transports].map(value => new Option(value, value)));
            transport.value = settings.transport;
            form.elements.skipNegotiation.checked = settings.skipNegotiation;
            form.elements.withCredentials.checked = settings.withCredentials;
            root.querySelector('[data-auth-required]').textContent = hub.authentication.required ? 'Required' : 'Optional';
            root.querySelector('[data-auth-help]').textContent = hub.authentication.declared
                ? 'Authentication types are read from this hub’s AsyncAPI security requirements.'
                : 'Authentication schemes are not documented. Select credentials manually; the server decides whether to accept them.';
            renderCredentials();
            renderPairs('headers');
            renderPairs('query');
        },
        setDisabled(session) {
            const idle = session.status === 'Disconnected';
            for (const input of form.querySelectorAll('input, select, button')) {
                input.disabled = !idle;
            }
            form.elements.skipNegotiation.disabled = !idle || session.settings.transport !== 'WebSockets';
        }
    };
}

function schemaNode(node) {
    const element = document.createElement(node.children.length ? 'details' : 'div');
    element.className = 'signalr-schema';
    const heading = document.createElement(node.children.length ? 'summary' : 'div');
    heading.append(textElement('code', node.name), textElement('span', node.type, 'signalr-type'));
    for (const badge of [node.format, node.range, node.nullable && 'nullable', node.required && 'required', node.recursive && 'recursive']) {
        if (badge) {
            heading.append(textElement('span', badge, 'signalr-type'));
        }
    }
    element.append(heading);
    if (node.description) {
        element.append(textElement('p', node.description, 'signalr-help'));
    }
    if (node.values) {
        element.append(textElement('p', 'Values: ' + node.values.map(value => JSON.stringify(value)).join(', '), 'signalr-help'));
    }
    for (const child of node.children) {
        element.append(schemaNode(child));
    }
    return element;
}

export function renderEvents(root, hub) {
    root.querySelector('[data-events]').replaceChildren(...Array.from(hub.events.values(), event => {
        const entry = document.createElement('li');
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.append(textElement('code', event.target));
        details.append(summary);
        if (event.description) {
            details.append(textElement('p', event.description, 'signalr-help'));
        }
        for (const message of event.messages) {
            if (event.messages.length > 1) {
                details.append(textElement('h4', message.title));
            }
            const argumentsSchemas = getArgumentSchemas(message);
            details.append(...argumentsSchemas.map(schemaNode));
            if (!argumentsSchemas.length) {
                details.append(textElement('p', 'This message has no documented arguments.', 'signalr-help'));
            }
        }
        if (!event.messages.length) {
            details.append(textElement('p', 'The message payload is not documented.', 'signalr-help'));
        }
        entry.append(details);
        return entry;
    }));
    root.querySelector('[data-no-events]').hidden = hub.events.size > 0;
}

export function mountSnippet(root, getSession) {
    const button = root.querySelector('[data-client]');
    const menu = root.querySelector('[data-client-menu]');
    const search = root.querySelector('[data-client-search]');
    const options = root.querySelector('[data-client-options]');
    const action = root.querySelector('[data-snippet-action]');
    const code = root.querySelector('[data-code]');
    const error = root.querySelector('[data-snippet-error]');
    const copy = root.querySelector('[data-copy]');
    let source = '';

    function render() {
        const session = getSession();
        const client = clients.find(value => value.id === (session.snippetClient ?? 'javascript'));
        button.textContent = client.language + ' / ' + client.library;
        action.value = session.action ?? 'invoke';
        root.querySelector('[data-snippet-action-label]').hidden = !session.method || session.method.streamResult;
        try {
            source = generateSnippet(client.id, session);
            code.replaceChildren(...codeTokens(source).map(token => textElement('span', token.text,
                token.kind ? 'signalr-code-' + token.kind : undefined)));
            error.hidden = true;
            copy.disabled = false;
            copy.textContent = 'Copy code';
        } catch (failure) {
            source = '';
            code.replaceChildren();
            error.textContent = failure.message;
            error.hidden = false;
            copy.disabled = true;
        }
    }

    function renderClients() {
        const query = search.value.toLowerCase();
        const filtered = clients.filter(value => (value.language + ' ' + value.library).toLowerCase().includes(query));
        options.replaceChildren(...filtered.map(client => {
            const option = document.createElement('button');
            option.type = 'button';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(client.id === (getSession().snippetClient ?? 'javascript')));
            option.append(textElement('span', client.language), textElement('small', client.library));
            option.addEventListener('click', () => {
                getSession().snippetClient = client.id;
                menu.hidePopover();
                render();
                button.focus();
            });
            return option;
        }));
        root.querySelector('[data-no-clients]').hidden = filtered.length > 0;
    }

    button.addEventListener('click', () => {
        if (menu.matches(':popover-open')) {
            menu.hidePopover();
            return;
        }
        search.value = '';
        renderClients();
        const rectangle = button.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rectangle.left, window.innerWidth - 340)) + 'px';
        menu.style.top = Math.max(8, rectangle.top - Math.min(350, window.innerHeight - 16)) + 'px';
        menu.showPopover();
        search.focus();
    });
    menu.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
    search.addEventListener('input', renderClients);
    menu.addEventListener('keydown', event => {
        const choices = [...options.querySelectorAll('button')];
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            choices[(choices.indexOf(document.activeElement) + step + choices.length) % choices.length]?.focus();
        }
    });
    action.addEventListener('change', () => { getSession().action = action.value; render(); });
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(source);
            copy.textContent = 'Copied';
        } catch {
            error.textContent = 'Clipboard access was denied. Select the code to copy it.';
            error.hidden = false;
        }
    });
    return { render, close: () => { if (menu.matches(':popover-open')) { menu.hidePopover(); } } };
}
