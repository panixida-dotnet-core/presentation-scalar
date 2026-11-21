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

function credentialInput(item, settings, name, onChange) {
    const names = { username: 'Username', password: 'Password', token: 'Token', value: 'Value' };
    const title = item.kind === 'bearer' && !item.tokenSource ? 'Bearer Token' : names[name];
    const label = textElement('label', title + ':', 'signalr-credential');
    const input = document.createElement('input');
    input.type = name === 'username' ? 'text' : 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 8192;
    input.placeholder = names[name];
    input.value = settings.credentials[item.id]?.[name] ?? '';
    input.addEventListener('input', () => {
        settings.credentials[item.id] ??= {};
        settings.credentials[item.id][name] = input.value;
        onChange();
    });
    label.append(input);
    return label;
}

function credentialNames(kind) {
    if (kind === 'basic') {
        return ['username', 'password'];
    }
    return [kind === 'apiKey' ? 'value' : 'token'];
}

function credentialGroup(item, settings, onChange) {
    const group = document.createElement('div');
    group.className = 'signalr-fields';
    if (item.description) {
        group.append(textElement('p', item.description, 'signalr-help'));
    }
    if (item.kind === 'cookie') {
        const suffix = item.name ? ' (' + item.name + ')' : '';
        group.append(textElement('p', 'Uses browser cookies for this API' + suffix + '. Cookies are sent according to browser domain and SameSite rules.', 'signalr-help'));
        return group;
    }
    if (item.kind === 'unsupported') {
        group.append(textElement('p', 'This scheme is not supported by the browser client.', 'signalr-help'));
        return group;
    }
    if (item.tokenSource) {
        group.append(textElement('p', 'Enter an issued access token. OAuth login and token refresh are handled by your identity provider.', 'signalr-help'));
    }
    if (item.scopes?.length) {
        group.append(textElement('p', 'Required scopes: ' + item.scopes.join(', '), 'signalr-help'));
    }
    const names = credentialNames(item.kind);
    group.append(...names.map(name => credentialInput(item, settings, name, onChange)));
    return group;
}

function mountAuthentication(root, getSession, onChange) {
    const section = root.querySelector('[data-authentication]');
    const picker = root.querySelector('[data-auth-picker]');
    const menu = root.querySelector('[data-auth-menu]');
    const search = root.querySelector('[data-auth-search]');
    const options = root.querySelector('[data-auth-options]');
    const fields = root.querySelector('[data-credentials]');

    function render() {
        const { hub, settings } = getSession();
        const auth = hub.authentication;
        const option = auth.options.find(value => value.id === settings.authentication);
        section.hidden = !auth.required && !option;
        picker.hidden = !option;
        picker.textContent = option ? 'Selected Auth Type: ' + option.label + ' ⌄' : '';
        const required = auth.required ? 'Required' : 'Optional';
        root.querySelector('[data-auth-required]').textContent = required;
        root.querySelector('[data-auth-menu-label]').textContent = required + ' authentication';
        const help = root.querySelector('[data-auth-help]');
        help.textContent = 'No authentication scheme is documented for this hub.';
        help.hidden = Boolean(option);
        fields.replaceChildren(...(option?.credentials ?? []).map(item => credentialGroup(item, settings, onChange)));
    }

    function renderOptions() {
        const { hub, settings } = getSession();
        const query = search.value.trim().toLowerCase();
        const choices = hub.authentication.options.filter(option => option.label.toLowerCase().includes(query));
        options.replaceChildren(...choices.map(option => {
            const selected = option.id === settings.authentication;
            const button = textElement('button', (selected ? '✓ ' : '') + option.label);
            button.type = 'button';
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => {
                settings.authentication = option.id;
                menu.hidePopover();
                section.querySelector('details').open = true;
                render();
                onChange();
                picker.focus();
            });
            return button;
        }));
        root.querySelector('[data-no-auth]').hidden = choices.length > 0;
    }

    picker.addEventListener('click', () => {
        if (menu.matches(':popover-open')) {
            menu.hidePopover();
            return;
        }
        search.value = '';
        renderOptions();
        menu.showPopover();
        const anchor = picker.getBoundingClientRect();
        const bounds = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, anchor.right - bounds.width) + 'px';
        menu.style.top = Math.max(8, Math.min(anchor.bottom, window.innerHeight - bounds.height - 8)) + 'px';
        search.focus();
    });
    menu.addEventListener('toggle', () => picker.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
    search.addEventListener('input', renderOptions);
    return { render, close: () => { if (menu.matches(':popover-open')) { menu.hidePopover(); } } };
}

function parameterField(item, settings, kind, onChange) {
    const label = textElement('label', item.name, 'signalr-parameter');
    const control = document.createElement(item.values?.length ? 'select' : 'input');
    if (control instanceof HTMLSelectElement) {
        control.append(new Option('Select value', ''), ...item.values.map(value => new Option(value, value)));
    } else {
        control.placeholder = 'Value';
        control.autocomplete = 'off';
        control.spellcheck = false;
    }
    if (item.required) {
        control.setAttribute('aria-required', 'true');
        label.append(textElement('small', 'Required'));
    }
    control.value = settings[kind][item.name];
    control.addEventListener('input', () => {
        settings[kind][item.name] = control.value;
        onChange();
    });
    label.append(control);
    if (item.description) {
        label.append(textElement('small', item.description, 'signalr-help'));
    }
    return label;
}

export function mountConnectionControls(root, getSession, onChange) {
    const form = root.querySelector('#panixida-signalr-connection');
    const transport = form.elements.transport;
    const auth = mountAuthentication(root, getSession, onChange);

    function renderParameters(hub, settings, kind) {
        const section = form.querySelector(`[data-parameters="${kind}"]`);
        const parameters = hub.parameters[kind];
        section.hidden = parameters.length === 0;
        section.querySelector('[data-parameter-fields]').replaceChildren(
            ...parameters.map(item => parameterField(item, settings, kind, onChange)));
    }

    function renderHeaders() {
        const { settings } = getSession();
        const container = root.querySelector('[data-pairs="headers"]');
        container.replaceChildren();
        for (const [index, pair] of settings.headers.entries()) {
            const row = document.createElement('div');
            row.className = 'signalr-pair';
            for (const name of ['name', 'value']) {
                const input = document.createElement('input');
                input.type = 'text';
                input.autocomplete = 'off';
                input.spellcheck = false;
                input.placeholder = name === 'name' ? 'Key' : 'Value';
                input.setAttribute('aria-label', `Header ${index + 1} ${name}`);
                input.value = pair[name];
                input.addEventListener('input', () => { pair[name] = input.value; onChange(); });
                row.append(input);
            }
            const remove = textElement('button', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove header ${index + 1}`);
            remove.addEventListener('click', () => {
                settings.headers.splice(index, 1);
                renderHeaders();
                onChange();
            });
            row.append(remove);
            container.append(row);
        }
    }

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
    root.querySelector('[data-add="headers"]').addEventListener('click', () => {
        getSession().settings.headers.push({ name: '', value: '' });
        renderHeaders();
        onChange();
    });
    return {
        close: auth.close,
        render(session) {
            const { hub, settings } = session;
            transport.replaceChildren(...['Auto', ...hub.transports].map(value => new Option(value, value)));
            transport.value = settings.transport;
            form.elements.skipNegotiation.checked = settings.skipNegotiation;
            form.elements.withCredentials.checked = settings.withCredentials;
            auth.render();
            renderHeaders();
            renderParameters(hub, settings, 'path');
            renderParameters(hub, settings, 'query');
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
        } catch (error_) {
            source = '';
            code.replaceChildren();
            error.textContent = error_.message;
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
            option.setAttribute('aria-pressed', String(client.id === (getSession().snippetClient ?? 'javascript')));
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
        if (event.key === 'Escape') {
            event.preventDefault();
            menu.hidePopover();
            button.focus();
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
