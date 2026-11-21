# PANiXiDA.Core.Presentation.Scalar

Shared Scalar UI hosting for modular OpenAPI and AsyncAPI documents on .NET 10.

## Status

[![CI](https://github.com/panixida-dotnet-core/presentation-scalar/actions/workflows/ci.yml/badge.svg)](https://github.com/panixida-dotnet-core/presentation-scalar/actions/workflows/ci.yml)
[![NuGet](https://img.shields.io/nuget/v/PANiXiDA.Core.Presentation.Scalar.svg)](https://www.nuget.org/packages/PANiXiDA.Core.Presentation.Scalar)
[![NuGet downloads](https://img.shields.io/nuget/dt/PANiXiDA.Core.Presentation.Scalar.svg)](https://www.nuget.org/packages/PANiXiDA.Core.Presentation.Scalar)
[![Target Framework](https://img.shields.io/badge/target-net10.0-512BD4)](https://dotnet.microsoft.com/)
[![License](https://img.shields.io/github/license/panixida-dotnet-core/presentation-scalar.svg)](LICENSE)

## Overview

This package hosts one Scalar reference for documents supplied by PANiXiDA transport adapters. HTTP provides OpenAPI documents, while SignalR and Wolverine provide AsyncAPI documents through the common `ApiDocumentation` catalog.

The presenter owns the UI and AsyncAPI document endpoints. It has no dependency on the PANiXiDA HTTP, SignalR, or Wolverine packages, so a web host can present only the transports it uses. Infrastructure registers document sources; the web host decides whether to expose Scalar.

## Features

- One document selector for modules, transports, and contract versions.
- OpenAPI and AsyncAPI rendering through Scalar.
- AsyncAPI JSON endpoints at each source's configured path.
- Contextual Test Request for documented SignalR hubs and methods, with authentication, connection settings, event schemas, and client code snippets.
- Development-only availability by default, with an explicit environment override.
- Page title, application-owned favicon, and HTTP operation sorting.
- Shared source-generated JSON schema contexts for transport adapters.
- Scalar OpenAPI transformers without a dependency from the HTTP package to the UI.

## Quick Start

### Requirements

- .NET 10 SDK compatible with `global.json`.
- An ASP.NET Core `WebApplication` host targeting `net10.0`.
- At least one registered document source from a transport adapter or a custom implementation.

### Installation

```shell
dotnet add package PANiXiDA.Core.Presentation.Scalar
```

The HTTP example below also uses `PANiXiDA.Core.Presentation.Http` 6.x, where Scalar hosting is provided separately:

```shell
dotnet add package PANiXiDA.Core.Presentation.Http --version "6.*"
```

### Minimal import

```csharp
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
```

### First example

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

using PANiXiDA.Core.Presentation.Http.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttp(builder.Configuration);
builder.Services.AddApiDocumentation(builder.Configuration);

var app = builder.Build();
app.UseHttp();
app.MapGet("/hello", () => TypedResults.Ok("Hello"))
    .WithName("SayHello")
    .WithSummary("Returns a greeting.");
app.UseApiDocumentation();
app.Run();
```

Run the host in Development and open `/scalar`. HTTP maps its OpenAPI endpoints; the presenter adds the UI. HTTP-only applications do not need to pass a payload JSON context to `AddApiDocumentation`.

## Usage

### Host registration and mapping order

Call `AddApiDocumentation` once in the web host, supplying generated JSON contexts when AsyncAPI adapters export application payloads. Register transport services before building the application; map their endpoints before `UseApiDocumentation`.

For a host already registering HTTP, SignalR, and messaging services:

```csharp
builder.Services.AddApiDocumentation(
    builder.Configuration,
    ApplicationJsonContext.Default);

var app = builder.Build();
app.UseSignalR(MatchmakingPresentationAssembly.Instance);
app.UseHttp();
app.UseApiDocumentation();
app.Run();
```

This fragment assumes the corresponding transport namespaces and application-owned assembly marker/context. `UseSignalR` precedes `UseHttp` so query-token forwarding runs before authentication.

A SignalR-only host can use the same presenter without referencing `Presentation.Http`. Configure that host's authentication/authorization middleware and SignalR serialization separately.

### Document sources

Transport adapters register `IApiDocumentSource` implementations from `PANiXiDA.Core.ApiDocumentation`. A custom source can register through `AddApiDocumentSource<TSource>()`. Sources return module/version descriptors; `IAsyncApiDocumentSource` also implements JSON generation.

`UseApiDocumentation` requires at least one source when enabled. It rejects conflicting catalog names/paths and AsyncAPI sources returning a descriptor of another format. Repeated calls on the same application do not map the UI twice.

### Modules, versions, and display

The UI reads titles, names, paths, modules, and versions from the shared catalog. For example:

| Document | Source path |
| --- | --- |
| Matchmaking API v1 | `/openapi/matchmaking-v1.json` |
| Matchmaking SignalR v1.0 | `/asyncapi/matchmaking-signalr-v1.json` |
| Matchmaking Kafka v1.0 | `/asyncapi/matchmaking-kafka-v1.json` |

OpenAPI documents show HTTP operations; AsyncAPI documents show channels, send/receive operations, messages, and replies. Display names and summaries come from document contents.

Document titles label the selector and introduction. Document names are technical source identifiers used in document paths; they are not separate UI labels.

HTTP owns module/version discovery through `HttpModules`. SignalR owns hub metadata through `IDocumentedHubEndpoint`; Wolverine groups Kafka registrations with `WithDocumentation`. The presenter collects their results and does not change routes, topics, or version negotiation.

### SignalR Test Request

Click **Test Request** beside a SignalR channel heading or a callable hub method in Scalar. The dialog uses that channel’s fixed, same-origin address and supports the SignalR JSON protocol over documented WebSockets, Server-Sent Events, and Long Polling transports. Choose authentication and connection settings, then click **Connect**. Credentials remain in page memory.

**Authentication** lists only the security schemes referenced by the hub's AsyncAPI operations and servers. A required hub without a declared scheme displays that the scheme is missing. Supported credentials include Bearer, issued OAuth2/OpenID Connect access tokens, Basic, HTTP API keys, and declared browser-cookie schemes. Server and operation requirements are combined, and alternatives remain selectable. OAuth login and refresh flows are handled outside this console.

The connection bar shows the server and hub path. **Variables** appears for path placeholders in the channel address and uses `channel.parameters` for descriptions, defaults and allowed values. **Query Parameters** appears when `channel.bindings.ws.query.properties` declares query fields. Both feed the connection URL and Code Snippet. API key schemes use the Authentication section.

**Connection settings** exposes Auto or a documented transport, optional negotiation skipping for explicit WebSockets, HTTP browser credentials, and custom headers. Connect performs negotiation automatically. **Messages** includes the negotiation status and response with connection/access tokens redacted. Basic and header API-key authentication require LongPolling in the browser. Custom headers can reach negotiation and HTTP transports, but browser WebSocket/SSE APIs cannot attach them to the transport connection. Cookies follow browser domain and SameSite rules; the HTTP credentials option does not control WebSocket cookies. Browser-forbidden headers and SignalR-owned query parameters cannot be overridden.

The method button selects the documented method and fills in arguments from a message example or payload schema. Choose another method of the same hub to prepare its arguments while keeping the connection and message history. After connecting, use **Invoke** to see a reply, **Send** for a one-way command, or **Stream** for a streaming method. Supply one JSON array per input stream when the method accepts uploads.

**Server events** expands each callback's documented arguments, DTO names and nested properties, including nullable values, required fields, enums, multiple DTOs, and recursive references. Incoming callbacks, replies, stream items, and errors appear in **Messages**. Use **Close** or press Escape to return to the reference while the hub stays connected. For example, you can make a related HTTP request, then reopen **Test Request** on the same hub to see the events it sent. Each hub keeps its own connection and history until the page is reloaded. Use **Disconnect** to end that hub’s connection.

**Code Snippet** provides a searchable language/client selector, syntax highlighting, and copying for JavaScript, TypeScript (`@microsoft/signalr`), C# (`Microsoft.AspNetCore.SignalR.Client`), and Java (`com.microsoft.signalr`). Examples follow the selected hub, authentication, transport, method, arguments, call type, and upload streams. Event handlers are registered before starting the connection. Authentication credentials use placeholders, and native clients require their own cookies. Java does not support SSE or callbacks with more than eight arguments; unsupported selections show an explanation instead of invalid code. Snippets require the corresponding client dependency in the consuming project.

The package serves the `@microsoft/signalr` 10.0.11 browser bundle locally. The bundle comes from `dist/browser/signalr.min.js` in the npm package. The vendored copy omits the source map reference and decrements the loop index after removing a stream in `HubConnection._replaceStreamingParams` so consecutive upload streams are all extracted.

## Configuration

Settings bind from the existing `ScalarConfiguration` section:

```json
{
  "ScalarConfiguration": {
    "Enabled": true,
    "Title": "Tactical Heroes API",
    "Favicon": "/favicon.svg",
    "SortOperations": true
  }
}
```

### Availability and page settings

| Setting | Default | Behavior |
| --- | --- | --- |
| `Enabled` | `null` | Enable only in Development; explicit true/false overrides the environment |
| `AsyncApiCacheDuration` | `null` | Cache AsyncAPI responses for the configured duration, for example `00:10:00` |
| `Title` | Scalar default | Set the reference page title when nonblank |
| `Favicon` | Scalar default | Use a relative or absolute favicon URI |
| `SortOperations` | `true` | Apply default HTTP ordering unless an explicit sorter/JavaScript configuration is supplied |

The web host owns access control for documentation. Enabling the UI outside Development exposes the configured documents through the application's normal endpoint pipeline.

### Cache AsyncAPI documents

Set `ScalarConfiguration:AsyncApiCacheDuration` to a positive duration such as `00:10:00` when generated documents can be reused for requests with the same URL. The default ASP.NET Core output cache stores each document response in memory per application instance. Authenticated requests and requests with an `Authorization` header bypass the default cache policy. The first request after expiry generates a fresh document.

### Favicon and static assets

The host validates nonblank favicon URIs at startup. Blank values use Scalar's default icon.

Place local favicons in the web host's `wwwroot` and publish its static web assets. A nonblank favicon makes the presenter call `MapStaticAssets().ShortCircuit()` for host assets; those assets must be public. A slim Development host should enable its static web assets explicitly.

### Operation ordering

When standard API Explorer metadata is available, HTTP operations are ordered by GET, POST, PUT, PATCH, DELETE; POST operations declaring 201 are placed first among POST operations. Hosts without API Explorer metadata use Scalar method sorting.

Set `SortOperations` to false to use Scalar's defaults. Explicit Scalar operation sorters and JavaScript configuration take precedence. Scalar-specific OpenAPI transformers are registered by this presenter.

### JSON contracts and Native AOT

Pass source-generated `JsonSerializerContext` instances covering AsyncAPI payloads. They supply documentation schemas; each transport still owns its serializer settings. Missing schema metadata fails without reflection fallback.

The presenter enables AOT analysis and generated configuration binding and maps document handlers through explicit request delegates. Complete host compatibility depends on its adapters and dependencies; referencing the presenter does not remove HTTP or SignalR platform limitations.

## Project Structure

```text
.
├── src/PANiXiDA.Core.Presentation.Scalar/
│   ├── Configurations/
│   ├── DependencyInjection/
│   ├── Options/
│   │   └── ApiDocumentation/
│   └── PANiXiDA.Core.Presentation.Scalar.csproj
├── tests/PANiXiDA.Core.Presentation.Scalar.UnitTests/
│   ├── Configurations/
│   ├── DependencyInjection/
│   ├── Options/ApiDocumentation/
│   └── TestDoubles/
├── .github/workflows/ci.yml
├── Directory.Build.props
├── Directory.Build.targets
├── Directory.Packages.props
├── global.json
├── version.json
├── icon.png
├── LICENSE
└── README.md
```

### Main repository files

`src/` contains presenter registration, endpoint mapping, options, and Scalar configuration helpers. `tests/` contains Kestrel hosting tests. Shared build/package settings live in `Directory.Build.props` and `Directory.Build.targets`; package versions, SDK selection, and versioning use `Directory.Packages.props`, `global.json`, and `version.json`.

## Development

### Build

```shell
dotnet restore
dotnet build --configuration Release
```

### Format

```shell
dotnet format
```

### Test

```shell
dotnet test --configuration Release
```

Run the SignalR console tests with Node.js 24 or later:

```shell
node --test tests/signalr-console.requests.test.mjs tests/signalr-console.behavior.test.mjs
```

You can also compile generated C# and Java examples for RPC, completion-only methods, streaming, upload streams, and authentication locally with .NET 10 and JDK 17 (`JAVA_HOME` or `javac` on PATH). This optional check downloads public compile dependencies into a temporary directory and removes them afterwards:

```shell
node --test tests/signalr-console.snippets.test.mjs
```

### Coverage

```shell
dotnet test --configuration Release -- --coverage --coverage-output coverage.xml --coverage-output-format xml
```

### Pack

```shell
dotnet pack --configuration Release
```

### Full local validation

```shell
dotnet restore
dotnet format
dotnet build --configuration Release
dotnet test --configuration Release
```

### Continuous integration

Every pull request and push to `main` runs formatting, tests, and mandatory SonarQube analysis. Publishing from `main` requires successful formatting, tests, and the SonarQube Quality Gate.

### Tooling and conventions

- .NET 10, nullable reference types, and implicit usings.
- Central package management through `Directory.Packages.props`.
- Microsoft Testing Platform, xUnit v3, and Shouldly.
- Nerdbank.GitVersioning through `version.json`.
- Package metadata, README, and icon inclusion through `Directory.Build.targets`.

## API / Contracts / Examples

### Public API

| API | Responsibility |
| --- | --- |
| `services.AddApiDocumentation(configuration, contexts)` | Register settings, catalog, generated schemas, and Scalar OpenAPI transformers |
| `app.UseApiDocumentation()` | Map AsyncAPI documents, optional static assets/ordering, and one Scalar reference |
| `ApiDocumentationOptions` in `Options.ApiDocumentation` | Configure availability, page title, favicon, and operation sorting |

### Behavioral notes

- Call `UseApiDocumentation` after transport mapping; document sources must be registered in DI.
- The presenter maps AsyncAPI JSON; OpenAPI document routes remain transport-owned.
- Document names and paths must be unique across all registered sources.
- `ScalarConfiguration:Enabled` controls presenter availability; the matching HTTP adapter honors the same setting for OpenAPI routes.
- Workers can use `ApiDocumentation` to export documents without hosting this UI package.

### Package contents

The package includes the `net10.0` library, XML documentation, README, package icon, and Source Link metadata. Repository packaging also produces a symbols package. Transport adapters are separate dependencies chosen by the consuming application.

## Roadmap / TODO

Track proposed changes and known issues in [GitHub Issues](https://github.com/panixida-dotnet-core/presentation-scalar/issues). New capabilities should follow concrete transport and consumer requirements.

## Contributing

### General rules

Keep the public API focused, preserve existing contracts, and justify new dependencies. Public APIs require English XML documentation. Update this README when usage, configuration, or package behavior changes.

### Code style

Follow `.editorconfig` and existing naming. Prefer readable implementations and separate documented members with blank lines.

### Tests

Cover meaningful behavior changes, guard clauses, and failures. Use Arrange, Act, Assert and English `DisplayName` values. Test projects provide global `Xunit` and `Shouldly` imports.

### Validation before completion

Run the commands in [Full local validation](#full-local-validation). Keep generated build output and temporary diagnostics out of commits.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Maintainers / Contacts

Maintained by [PANiXiDA](https://github.com/PANiXiDA).

Use [Issues](https://github.com/panixida-dotnet-core/presentation-scalar/issues) for questions and defects, and [Pull Requests](https://github.com/panixida-dotnet-core/presentation-scalar/pulls) for proposed changes.
