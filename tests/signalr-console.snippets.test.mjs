import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { createSettings, getAuthenticationOptions } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/connection.js';
import { generateSnippet } from '../src/PANiXiDA.Core.Presentation.Scalar/Assets/SignalRConsole/snippets.js';

const workspace = mkdtempSync(join(tmpdir(), 'signalr-snippets-'));
assert.equal(dirname(workspace), resolve(tmpdir()));
const dotnetDirectory = join(workspace, 'dotnet');
const javaDirectory = join(workspace, 'java');
const jars = join(javaDirectory, 'jars');
for (const directory of [dotnetDirectory, javaDirectory, jars]) {
    mkdirSync(directory, { recursive: true });
}

function run(command, arguments_) {
    try {
        execFileSync(command, arguments_, { encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
    } catch (error) {
        throw new Error(String(error.stdout ?? '') + String(error.stderr ?? ''), { cause: error });
    }
}

async function downloadJavaDependencies() {
    const artifacts = [
        ['com/microsoft/signalr', 'signalr', '10.0.0'],
        ['io/reactivex/rxjava3', 'rxjava', '3.0.11'],
        ['com/google/code/gson', 'gson', '2.8.9'],
        ['com/squareup/okhttp3', 'okhttp', '4.12.0'],
        ['org/slf4j', 'slf4j-api', '1.7.25'],
        ['org/reactivestreams', 'reactive-streams', '1.0.3']
    ];
    await Promise.all(artifacts.map(async ([group, name, version]) => {
        const filename = `${name}-${version}.jar`;
        const response = await fetch(`https://repo.maven.apache.org/maven2/${group}/${name}/${version}/${filename}`,
            { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            throw new Error(`Could not download Java compile dependency ${filename}: ${response.status}.`);
        }
        writeFileSync(join(jars, filename), new Uint8Array(await response.arrayBuffer()));
    }));
}

function example(target, security, transport = 'Auto') {
    const operation = security ? { security: [security] } : {};
    const hub = { url: new URL('https://example.com/hubs/demo'),
        transports: ['WebSockets', 'ServerSentEvents', 'LongPolling'],
        authentication: getAuthenticationOptions({}, operation, {}),
        events: new Map([['changed', { target: 'Changed', argumentCount: 2 }]]) };
    const settings = createSettings(hub);
    settings.transport = transport;
    let arguments_ = '[]';
    if (target === 'Echo') {
        arguments_ = '[{"id":"example","nullable":null},{"region":"dev"}]';
    } else if (target === 'Count') {
        arguments_ = '[3]';
    }
    return { hub, settings, method: { target, returnsValue: target !== 'Publish', streamResult: target === 'Count',
        inputStreams: target === 'Upload' ? ['first', 'second'] : [] },
        arguments: arguments_, uploads: target === 'Upload' ? '[[1,2],[3,4]]' : '[]' };
}

test('Generated C# and Java examples compile against their SignalR SDKs', async () => {
    try {
        const project = join(dotnetDirectory, 'Snippet.csproj');
        writeFileSync(project, `<Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
      <ItemGroup><PackageReference Include="Microsoft.AspNetCore.SignalR.Client" Version="10.0.14" /></ItemGroup>
    </Project>\n`);
        await downloadJavaDependencies();
        run('dotnet', ['restore', project]);
        const compiler = process.platform === 'win32' ? 'javac.exe' : 'javac';
        const javac = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', compiler) : compiler;
        const examples = [
            example('Echo', { type: 'http', scheme: 'bearer' }),
            example('Publish', null, 'WebSockets'),
            example('Count', null, 'LongPolling'),
            example('Upload', null),
            example('Echo', { type: 'http', scheme: 'basic' }, 'LongPolling'),
            example('Echo', { type: 'httpApiKey', in: 'cookie', name: 'session' })
        ];
        for (const [index, value] of examples.entries()) {
            writeFileSync(join(dotnetDirectory, 'Program.cs'), generateSnippet('csharp', value));
            run('dotnet', ['build', project, '--no-restore', '--configuration', 'Release']);
            const java = join(javaDirectory, 'SignalRExample.java');
            writeFileSync(java, generateSnippet('java', value));
            run(javac, ['-cp', join(jars, '*'), '-d', javaDirectory, java]);
            process.stdout.write(`Compiled C# and Java example ${index + 1}: ${value.method.target}\n`);
        }
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});
