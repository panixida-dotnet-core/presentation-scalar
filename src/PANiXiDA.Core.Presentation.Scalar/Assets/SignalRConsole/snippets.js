import { prepareConnection } from './connection.js';

export const clients = [
    { id: 'javascript', language: 'JavaScript', library: '@microsoft/signalr' },
    { id: 'typescript', language: 'TypeScript', library: '@microsoft/signalr' },
    { id: 'csharp', language: 'C#', library: 'Microsoft.AspNetCore.SignalR.Client' },
    { id: 'java', language: 'Java', library: 'com.microsoft.signalr' }
];

const quote = value => JSON.stringify(value);

function readArguments(value, label) {
    const result = JSON.parse(value);
    if (!Array.isArray(result)) {
        throw new TypeError(`${label} must be a JSON array.`);
    }
    return result;
}

export function generateSnippet(client, session) {
    const options = prepareConnection(session.hub, session.settings, true);
    const args = session.method ? readArguments(session.arguments, 'Arguments') : [];
    const uploads = session.method?.inputStreams.length ? readArguments(session.uploads, 'Upload streams') : [];
    if (uploads.length !== (session.method?.inputStreams.length ?? 0) || !uploads.every(Array.isArray)) {
        throw new Error('Enter one JSON array per upload stream.');
    }
    const context = { session, options, args, uploads, events: [...session.hub.events.values()] };
    if (client === 'javascript' || client === 'typescript') {
        return javascript(context, client === 'typescript');
    }
    if (client === 'csharp') {
        requireArgumentCounts(context.events);
        return csharp(context);
    }
    if (client === 'java') {
        requireArgumentCounts(context.events);
        return java(context);
    }
    throw new Error('Select a SignalR client.');
}

function requireArgumentCounts(events) {
    if (events.some(event => !Number.isInteger(event.argumentCount))) {
        throw new Error('This native client requires a documented, consistent argument count for each server event.');
    }
}

function javascript(context, typed) {
    return [...javascriptConnection(context, typed), ...javascriptInvocation(context, typed),
        '', '// Keep the connection open to receive events; call connection.stop() when finished.'].join('\n');
}

function javascriptConnection({ options, uploads, events }, typed) {
    const imports = ['HubConnectionBuilder', 'HttpTransportType', ...(uploads.length ? ['Subject'] : [])];
    const lines = [
        '// npm install @microsoft/signalr',
        `import { ${imports.join(', ')} } from '@microsoft/signalr';`,
        '',
        'const connection = new HubConnectionBuilder()',
        `    .withUrl(${quote(options.url)}, {`,
        `        transport: ${options.transports.map(value => 'HttpTransportType.' + value).join(' | ')},`,
        `        skipNegotiation: ${options.skipNegotiation},`,
        `        withCredentials: ${options.withCredentials}${options.token || Object.keys(options.headers).length ? ',' : ''}`
    ];
    if (options.token) {
        lines.push(`        accessTokenFactory: () => ${quote(options.token)}${Object.keys(options.headers).length ? ',' : ''}`);
    }
    if (Object.keys(options.headers).length) {
        lines.push('        // Custom headers apply to HTTP requests, not browser WebSocket/SSE connections.',
            `        headers: ${JSON.stringify(options.headers)}`);
    }
    lines.push('    })', '    .build();', '');
    for (const event of events) {
        lines.push(`connection.on(${quote(event.target)}, (...args${typed ? ': unknown[]' : ''}) => {`,
            `    console.log(${quote(event.target)}, ...args);`, '});');
    }
    lines.push('', 'await connection.start();');
    return lines;
}

function javascriptInvocation({ session, args, uploads }, typed) {
    const { method } = session;
    if (!method) {
        return [];
    }
    const lines = [];
    lines.push('');
    for (const [index] of uploads.entries()) {
        lines.push(`const upload${index + 1} = new Subject${typed ? '<unknown>' : ''}();`);
    }
    const parameters = [...args.map(value => JSON.stringify(value)), ...uploads.map((_, index) => `upload${index + 1}`)];
    const call = [quote(method.target), ...parameters].join(', ');
    if (method.streamResult) {
        lines.push(`connection.stream${typed ? '<unknown>' : ''}(${call}).subscribe({`,
            '    next: item => console.log(item),', '    error: error => console.error(error),',
            "    complete: () => console.log('Stream completed')", '});');
    } else {
        lines.push(`const pending = connection.${session.action === 'send' ? 'send' : 'invoke'}(${call});`);
    }
    for (const [index, items] of uploads.entries()) {
        lines.push(`for (const item of ${JSON.stringify(items)}) {`, `    upload${index + 1}.next(item);`, '}',
            `upload${index + 1}.complete();`);
    }
    if (!method.streamResult) {
        lines.push('console.log(await pending);');
    }
    return lines;
}

function csharp({ session, options, args, uploads, events }) {
    const { method } = session;
    const lines = ['// dotnet add package Microsoft.AspNetCore.SignalR.Client',
        'using System;', 'using System.Net;', 'using System.Text.Json;', 'using System.Threading.Channels;',
        'using System.Threading.Tasks;', 'using Microsoft.AspNetCore.Http.Connections;',
        'using Microsoft.AspNetCore.SignalR.Client;', '',
        'await using var connection = new HubConnectionBuilder()', `    .WithUrl(${quote(options.url)}, options =>`, '    {',
        `        options.Transports = ${options.transports.map(value => 'HttpTransportType.' + value).join(' | ')};`,
        `        options.SkipNegotiation = ${options.skipNegotiation};`];
    if (options.token) {
        lines.push(`        options.AccessTokenProvider = () => Task.FromResult<string?>(${quote(options.token)});`);
    }
    for (const [key, value] of Object.entries(options.headers)) {
        lines.push(`        options.Headers[${quote(key)}] = ${quote(value)};`);
    }
    if (options.cookieAuthentication) {
        lines.push('        // Supply cookies for this .NET client; browser cookies are not shared.',
            '        options.Cookies = new CookieContainer();',
            `        options.Cookies.Add(new Uri(${quote(options.url)}), new Cookie("YOUR_COOKIE_NAME", "YOUR_COOKIE_VALUE"));`);
    }
    lines.push('    })', '    .Build();', '');
    for (const event of events) {
        const types = Array.from({ length: event.argumentCount }, () => 'typeof(JsonElement)').join(', ');
        lines.push(`connection.On(${quote(event.target)}, new Type[] { ${types} }, values =>`,
            '{', '    Console.WriteLine(JsonSerializer.Serialize(values));', '    return Task.CompletedTask;', '});');
    }
    lines.push('', 'await connection.StartAsync();');
    if (method) {
        lines.push('');
        for (const [index, items] of uploads.entries()) {
            lines.push(`var upload${index + 1} = Channel.CreateUnbounded<JsonElement>();`);
            for (const item of items) {
                lines.push(`await upload${index + 1}.Writer.WriteAsync(JsonSerializer.Deserialize<JsonElement>(${quote(JSON.stringify(item))}));`);
            }
            lines.push(`upload${index + 1}.Writer.Complete();`);
        }
        const parameters = [...args.map(value => `JsonSerializer.Deserialize<JsonElement>(${quote(JSON.stringify(value))})`),
            ...uploads.map((_, index) => `upload${index + 1}.Reader`)];
        lines.push('var arguments = new object?[]', '{', ...parameters.map(value => `    ${value},`), '};');
        if (method.streamResult) {
            lines.push(`await foreach (var item in connection.StreamAsyncCore<JsonElement>(${quote(method.target)}, arguments))`,
                '{', '    Console.WriteLine(item);', '}');
        } else if (session.action === 'send') {
            lines.push(`await connection.SendCoreAsync(${quote(method.target)}, arguments);`);
        } else {
            lines.push(`var reply = await connection.InvokeCoreAsync<object?>(${quote(method.target)}, arguments);`,
                'Console.WriteLine(JsonSerializer.Serialize(reply));');
        }
    }
    lines.push('', 'Console.WriteLine("Connected. Press Enter to disconnect.");', 'Console.ReadLine();',
        'await connection.StopAsync();');
    return lines.join('\n');
}

function java(context) {
    const supported = context.options.transports.filter(value => value !== 'ServerSentEvents');
    if (supported.length === 0) {
        throw new Error('The Microsoft Java SignalR client does not support ServerSentEvents.');
    }
    if (context.events.some(event => event.argumentCount > 8)) {
        throw new Error('The Microsoft Java client supports callbacks with up to eight arguments.');
    }
    const names = { WebSockets: 'WEBSOCKETS', LongPolling: 'LONG_POLLING' };
    const transport = supported.length > 1 ? 'ALL' : names[supported[0]];
    return [...javaConnection(context.options, transport), ...javaCallbacks(context.events),
        '', '        connection.start().blockingAwait();', ...javaInvocation(context),
        '', '        Runtime.getRuntime().addShutdownHook(new Thread(() => connection.stop().blockingAwait()));',
        '        new CountDownLatch(1).await();', '    }', '}'].join('\n');
}

function javaConnection(options, transport) {
    const lines = ['// Dependency: com.microsoft.signalr:signalr (10.x)',
        'import com.microsoft.signalr.HubConnection;', 'import com.microsoft.signalr.HubConnectionBuilder;',
        'import com.microsoft.signalr.TransportEnum;', 'import com.google.gson.JsonElement;',
        'import com.google.gson.JsonParser;', 'import io.reactivex.rxjava3.core.Single;',
        'import io.reactivex.rxjava3.subjects.ReplaySubject;', 'import java.util.concurrent.CountDownLatch;',
        '', 'public class SignalRExample {', '    public static void main(String[] args) throws InterruptedException {',
        `        HubConnection connection = HubConnectionBuilder.create(${quote(options.url)})`,
        `            .withTransport(TransportEnum.${transport})`, `            .shouldSkipNegotiate(${options.skipNegotiation})`];
    if (options.token) {
        lines.push(`            .withAccessTokenProvider(Single.defer(() -> Single.just(${quote(options.token)})))`);
    }
    for (const [key, value] of Object.entries(options.headers)) {
        lines.push(`            .withHeader(${quote(key)}, ${quote(value)})`);
    }
    if (options.cookieAuthentication) {
        lines.push('            // Supply cookies for this Java client; browser cookies are not shared.',
            '            .withHeader("Cookie", "YOUR_COOKIE_NAME=YOUR_COOKIE_VALUE")');
    }
    lines.push('            .build();', '');
    return lines;
}

function javaCallbacks(events) {
    const lines = [];
    for (const event of events) {
        const parameters = Array.from({ length: event.argumentCount }, (_, index) => 'JsonElement value' + (index + 1));
        const values = parameters.map((_, index) => 'value' + (index + 1));
        const types = parameters.map(() => 'JsonElement.class');
        lines.push(`        connection.on(${quote(event.target)}, (${parameters.join(', ')}) -> {`,
            `            System.out.println(${quote(event.target)}${values.length ? ' + ": " + java.util.Arrays.toString(new Object[] { ' + values.join(', ') + ' })' : ''});`,
            `        }${types.length ? ', ' + types.join(', ') : ''});`);
    }
    return lines;
}

function javaInvocation({ session, args, uploads }) {
    const { method } = session;
    if (!method) {
        return [];
    }
    const lines = [];
    for (const [index, items] of uploads.entries()) {
        lines.push(`        ReplaySubject<JsonElement> upload${index + 1} = ReplaySubject.create();`);
        for (const item of items) {
            lines.push(`        upload${index + 1}.onNext(JsonParser.parseString(${quote(JSON.stringify(item))}));`);
        }
        lines.push(`        upload${index + 1}.onComplete();`);
    }
    const parameters = [...args.map(value => `JsonParser.parseString(${quote(JSON.stringify(value))})`),
        ...uploads.map((_, index) => `upload${index + 1}`)];
    const call = [quote(method.target), ...parameters].join(', ');
    if (method.streamResult) {
        lines.push(`        connection.stream(JsonElement.class, ${call}).blockingForEach(System.out::println);`);
    } else if (session.action === 'send') {
        lines.push(`        connection.send(${call});`);
    } else if (method.returnsValue === true) {
        lines.push(`        JsonElement reply = connection.invoke(JsonElement.class, ${call}).blockingGet();`,
            '        System.out.println(reply);');
    } else {
        lines.push(`        connection.invoke(${call}).blockingAwait();`);
    }
    return lines;
}

const codeKeywords = new Set('import from const let new await async using var public class static void throws for foreach in return true false null typeof'.split(' '));

function codeTokenKind(text) {
    if (text.startsWith('//')) {
        return 'comment';
    }
    if (text.startsWith('"') || text.startsWith("'")) {
        return 'string';
    }
    if (/^\d/u.test(text)) {
        return 'number';
    }
    return codeKeywords.has(text) ? 'keyword' : undefined;
}

export function codeTokens(code) {
    const expression = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\b[A-Za-z_]\w*\b|\b\d+\b)/gu;
    const tokens = [];
    let position = 0;
    for (const match of code.matchAll(expression)) {
        tokens.push({ text: code.slice(position, match.index) });
        const text = match[0];
        tokens.push({ text, kind: codeTokenKind(text) });
        position = match.index + text.length;
    }
    tokens.push({ text: code.slice(position) });
    return tokens;
}
