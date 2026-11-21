import { getAuthenticationOptions, transportNames } from './connection.js';
import { getArgumentSchemas, getMessageSchemas, readPointer, replyReturnsValue, resolveDocumentNode } from './schema.js';

const channelHeaderSelector = '.section[id] > .section-header-wrapper';
const operationHeaderSelector = '.operation--receive[id] > .operation-header';
const headerSelector = channelHeaderSelector + ', ' + operationHeaderSelector;
const actionSelector = '.signalr-test-request';

function scalarSlug(value) {
    return String(value).slice(0, 255).trim().normalize().toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-|-$/g, '');
}

export function getDocumentPaths(sources) {
    const occurrences = new Map();
    const paths = new Map();
    for (const { title, path } of sources) {
        const slug = scalarSlug(title);
        const index = occurrences.get(slug) ?? 0;
        occurrences.set(slug, index + 1);
        const documentSlug = index === 0 ? slug : slug + '-' + index;
        const anchorSlug = scalarSlug(documentSlug);
        paths.set(anchorSlug, paths.has(anchorSlug) ? null : path);
    }
    return [...paths].filter(([, path]) => path !== null);
}

export function addDocumentRequests(requests, slug, document, getUrl) {
    const channelPrefix = '#/channels/';
    const hubs = new Map();
    for (const [operationId, entry] of Object.entries(document?.operations ?? {})) {
        const operation = resolveDocumentNode(document, entry);
        const binding = operation?.bindings?.['x-signalr'];
        const reference = operation?.channel?.$ref;
        if (!Array.isArray(binding?.protocols) || !binding.protocols.includes('json') ||
            !Array.isArray(binding.transports) || !binding.transports.some(value => transportNames.includes(value)) ||
            typeof reference !== 'string' || !reference.startsWith(channelPrefix) ||
            typeof binding.target !== 'string' || !binding.target.trim()) {
            continue;
        }

        const channelKey = reference.slice(channelPrefix.length).replaceAll('~1', '/').replaceAll('~0', '~');
        const channel = resolveDocumentNode(document, document.channels?.[channelKey]);
        const url = getUrl(channel?.address);
        if (!url) {
            continue;
        }

        const anchor = slug + '/channel/' + scalarSlug(channelKey);
        let hub = hubs.get(channelKey);
        if (!hub) {
            hub = {
                url,
                address: channel.address,
                title: channel.title?.trim() || channel.summary?.trim() || channel.address,
                transports: [],
                authentication: { options: [], required: false, declared: false },
                methods: new Map(),
                events: new Map()
            };
            hubs.set(channelKey, hub);
            registerRequest(requests, anchor, { hub });
        }

        hub.transports = transportNames.filter(value => hub.transports.includes(value) || binding.transports.includes(value));
        const authentication = getAuthenticationOptions(document, operation, channel);
        hub.authentication.required ||= authentication.required;
        hub.authentication.declared ||= authentication.declared;
        hub.authentication.options = [...new Map([...hub.authentication.options, ...authentication.options]
            .map(value => [value.id, value])).values()];
        if (hub.authentication.declared) {
            hub.authentication.options = hub.authentication.options.filter(value => !['bearer', 'cookie'].includes(value.id));
        }
        if (hub.authentication.required) {
            hub.authentication.options.sort((left, right) => Number(left.id === 'none') - Number(right.id === 'none'));
        }

        const target = binding.target;
        const key = target.toLowerCase();
        if (operation.action === 'receive' && binding.messageType !== 'streamItem') {
            const method = {
                target,
                title: operation.title ?? target,
                streamResult: binding.streamResult === true,
                inputStreams: Array.isArray(binding.inputStreams) ? binding.inputStreams : [],
                messages: getMessageSchemas(document, operation),
                returnsValue: replyReturnsValue(document, operation),
                arguments: () => getRequestArguments(document, operation)
            };
            hub.methods.set(key, method);
            registerRequest(requests, anchor + '/operation/' + scalarSlug(operationId), { hub, method });
        } else if (operation.action === 'send') {
            const messages = getMessageSchemas(document, operation);
            const counts = new Set(messages.map(value => getArgumentSchemas(value).length));
            hub.events.set(key, { target, title: operation.title ?? target, description: operation.description,
                messages, argumentCount: counts.size === 1 ? [...counts][0] : null });
        }
    }
}

function registerRequest(requests, anchor, request) {
    requests.set(anchor, requests.has(anchor) ? null : request);
}

function findRequest(requests, header) {
    const id = header.parentElement?.id ?? '';
    const match = /^([^/]+)\/(?:(?:tag|tag-group)\/[^/]+\/)?(channel\/[^/]+(?:\/operation\/[^/]+)?)$/u.exec(id);
    return match && requests.get(match[1] + '/' + match[2]);
}

export function addTestRequests(requests, openRequest) {
    if (requests.size === 0) {
        return;
    }

    const reference = document.getElementById('app') ?? document.body;
    const actions = new Map();

    function addButtons() {
        const renderedHeaders = new Set(reference.querySelectorAll(headerSelector));
        for (const [header, action] of actions) {
            if (!renderedHeaders.has(header) || action.button.parentElement !== header.lastElementChild
                || findRequest(requests, header) !== action.request) {
                action.button.remove();
                actions.delete(header);
            }
        }
        for (const header of renderedHeaders) {
            const request = findRequest(requests, header);
            if (!request || actions.has(header)) {
                continue;
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'signalr-test-request';
            button.textContent = 'Test Request';
            button.setAttribute('aria-label', 'Test Request for ' + (request.method?.title ?? request.hub.title));
            button.setAttribute('aria-haspopup', 'dialog');
            header.lastElementChild.prepend(button);
            actions.set(header, { request, button });
        }
    }

    reference.addEventListener('click', event => {
        const button = event.target.closest(actionSelector);
        const header = button?.closest(headerSelector);
        const action = actions.get(header);
        if (action?.button === button && action.request === findRequest(requests, header)) {
            openRequest(action.request, button);
        }
    });

    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                addButtons();
            });
        }
    });
    observer.observe(reference, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'class'] });
    addButtons();
}

function getRequestArguments(document, operation) {
    const messages = Array.isArray(operation.messages) ? operation.messages : [];
    for (const reference of messages) {
        const message = resolveDocumentNode(document, reference);
        const examples = Array.isArray(message?.examples) ? message.examples : [];
        const explicit = examples.map(example => asArguments(example?.payload)).find(Array.isArray);
        if (explicit) {
            return explicit;
        }

        const payload = resolveDocumentNode(document, message?.payload);
        const schema = resolveDocumentNode(document, payload?.schema ?? payload);
        const example = asArguments(providedExample(payload)) ?? asArguments(providedExample(schema));
        if (example) {
            return example;
        }

        const argumentsSchema = schema?.properties?.arguments ?? (schema?.type === 'array' ? schema : undefined);
        const generated = createExample(argumentsSchema, schema, document);
        if (Array.isArray(generated)) {
            return generated;
        }
    }

    return [];
}

function asArguments(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return Array.isArray(value?.arguments) ? value.arguments : undefined;
}

function providedExample(schema) {
    return [schema?.example, schema?.examples?.[0], schema?.default, schema?.const, schema?.enum?.[0]]
        .find(value => value !== undefined);
}

function createExample(schema, root, document, parents = new Set()) {
    if (!schema || parents.has(schema) || parents.size >= 16) {
        return null;
    }

    const explicit = providedExample(schema);
    if (explicit !== undefined) {
        return explicit;
    }
    const path = new Set(parents).add(schema);
    const nestedExample = value => createExample(value, root, document, path);
    const reference = schema.$ref ?? schema.$dynamicRef;
    if (typeof reference === 'string') {
        const resolved = readPointer(root, reference) ?? readPointer(document, reference);
        return nestedExample(resolved);
    }

    const choices = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices.find(option => option?.type !== 'null') ?? choices[0];
        return nestedExample(choice);
    }

    return exampleForType(schema, nestedExample);
}

const stringExamples = new Map([
    ['uuid', '00000000-0000-4000-8000-000000000000'],
    ['date-time', '2026-01-01T00:00:00Z'],
    ['date', '2026-01-01'],
    ['time', '00:00:00'],
    ['email', 'user@example.com'],
    ['uri', 'https://example.com']
]);

function exampleForType(schema, nestedExample) {
    if (Array.isArray(schema.allOf)) {
        const parts = schema.allOf.map(nestedExample)
            .filter(value => value && typeof value === 'object' && !Array.isArray(value));
        return Object.fromEntries(parts.flatMap(Object.entries));
    }

    const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type;
    switch (type ?? (schema.properties && 'object')) {
        case 'object':
            return Object.fromEntries(Object.entries(schema.properties ?? {})
                .map(([name, property]) => [name, nestedExample(property)]));
        case 'array':
            if (Array.isArray(schema.prefixItems)) {
                return schema.prefixItems.map(nestedExample);
            }
            return Array.from({ length: Math.min(schema.minItems ?? 1, schema.maxItems ?? 10, 10) },
                () => nestedExample(schema.items));
        case 'number':
        case 'integer':
            return schema.minimum ?? 0;
        case 'boolean':
            return false;
        case 'string':
            return stringExamples.get(schema.format) ?? 'string';
        default:
            return null;
    }
}
