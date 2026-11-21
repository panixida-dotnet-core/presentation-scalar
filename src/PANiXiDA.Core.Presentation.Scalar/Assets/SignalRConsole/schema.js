export function readPointer(root, reference) {
    if (reference === '#') {
        return root;
    }
    if (typeof reference !== 'string' || !reference.startsWith('#/')) {
        return undefined;
    }
    return reference.slice(2).split('/').reduce((value, token) => {
        const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
        return value != null && Object.hasOwn(value, key) ? value[key] : undefined;
    }, root);
}

export function resolveDocumentNode(document, value) {
    const visited = new Set();
    while (typeof value?.$ref === 'string') {
        if (visited.has(value)) {
            return undefined;
        }
        visited.add(value);
        value = readPointer(document, value.$ref);
    }
    return value;
}

export function getMessageSchemas(document, operation) {
    return (operation.messages ?? []).flatMap(reference => {
        const message = resolveDocumentNode(document, reference);
        const payload = resolveDocumentNode(document, message?.payload);
        const root = payload?.schema ?? payload;
        return root ? [{ title: message.title ?? message.name ?? 'Message', root, document }] : [];
    });
}

function resolveSchema(schema, context, parents) {
    let value = schema;
    let name;
    const visited = new Set(parents);
    while (value?.$ref || value?.$dynamicRef) {
        const reference = value.$ref ?? value.$dynamicRef;
        name ??= reference.split('/').at(-1)?.replaceAll('~1', '/').replaceAll('~0', '~');
        if (visited.has(value)) {
            return { name, recursive: true };
        }
        visited.add(value);
        value = readPointer(context.root, reference) ?? readPointer(context.document, reference);
    }
    return { value, name };
}

export function getArgumentSchemas(context) {
    const root = resolveSchema(context.root, context, []).value;
    const argumentsSchema = resolveSchema(root?.properties?.arguments ?? root, context, []).value;
    if (!argumentsSchema) {
        return [];
    }
    const tuple = argumentsSchema.prefixItems ?? (Array.isArray(argumentsSchema.items) ? argumentsSchema.items : null);
    if (tuple) {
        return tuple.map((schema, index) => describeSchema(schema, context, `arguments[${index}]`));
    }
    if (argumentsSchema.items && argumentsSchema.maxItems !== 0) {
        const count = argumentsSchema.minItems === argumentsSchema.maxItems ? argumentsSchema.minItems : 1;
        return Array.from({ length: Math.min(count ?? 1, 32) }, (_, index) =>
            describeSchema(argumentsSchema.items, context, `arguments[${index}]`));
    }
    return [];
}

export function replyReturnsValue(document, operation) {
    const reply = resolveDocumentNode(document, operation.reply);
    const results = [];
    const visit = (schema, context, parents = new Set()) => {
        const value = resolveSchema(schema, context, parents).value;
        if (!value || parents.has(value) || parents.size >= 20) {
            return;
        }
        const path = new Set(parents).add(value);
        if (value.properties?.result) {
            const result = resolveSchema(value.properties.result, context, path).value;
            results.push(result?.type !== 'null' && !(Object.hasOwn(result ?? {}, 'const') && result.const === null));
        }
        for (const choice of value.oneOf ?? value.anyOf ?? value.allOf ?? []) {
            visit(choice, context, path);
        }
    };
    for (const context of getMessageSchemas(document, reply ?? {})) {
        visit(context.root, context);
    }
    return results.length ? results.some(Boolean) : null;
}

export function describeSchema(schema, context, name, required = false, parents = new Set(), budget = null) {
    budget ??= { left: 200 };
    if (!schema || budget.left-- <= 0 || parents.size >= 20) {
        return { name, type: 'Schema limit reached', children: [] };
    }
    const resolved = resolveSchema(schema, context, parents);
    const value = resolved.value;
    const title = value?.title ?? resolved.name;
    if (!value || resolved.recursive || parents.has(value)) {
        return { name, type: title ?? 'Unknown', recursive: resolved.recursive || parents.has(value), children: [] };
    }

    const path = new Set(parents).add(value);
    const choices = value.oneOf ?? value.anyOf;
    const nullable = value.nullable === true || value.type === 'null' || value.type?.includes?.('null') === true
        || choices?.some(option => option.type === 'null') === true;
    const variants = choices?.filter(option => option.type !== 'null') ?? [];
    if (variants.length === 1) {
        const result = describeSchema(variants[0], context, name, required, path, budget);
        return { ...result, nullable: nullable || result.nullable, description: value.description ?? result.description };
    }

    const types = Array.isArray(value.type) ? value.type.filter(type => type !== 'null') : [value.type];
    const kind = types.filter(Boolean).join(' | ') || (value.properties || value.allOf ? 'object' : 'unknown');
    const node = {
        name,
        type: title ?? kind,
        format: value.format,
        nullable,
        required,
        description: value.description,
        values: value.enum ?? (Object.hasOwn(value, 'const') ? [value.const] : undefined),
        children: []
    };
    const child = (property, key, isRequired = false) => describeSchema(property, context, key, isRequired, path, budget);
    for (const [key, property] of Object.entries(value.properties ?? {})) {
        node.children.push(child(property, key, value.required?.includes(key)));
    }
    for (const part of value.allOf ?? []) {
        node.children.push(...child(part, 'allOf').children);
    }
    for (const [index, variant] of variants.entries()) {
        node.children.push(child(variant, `Alternative ${index + 1}`));
    }
    if (kind === 'array') {
        const tuple = value.prefixItems ?? (Array.isArray(value.items) ? value.items : null);
        if (tuple) {
            node.children.push(...tuple.map((item, index) => child(item, `[${index}]`)));
        } else if (value.items) {
            node.children.push(child(value.items, 'items'));
        }
        node.range = `${value.minItems ?? 0}…${value.maxItems ?? 'N'}`;
    }
    return node;
}
