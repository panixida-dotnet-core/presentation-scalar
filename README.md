# PANiXiDA.Core.Presentation.Scalar

One Scalar reference for transport-owned OpenAPI and AsyncAPI documents on .NET 10.

[![CI](https://github.com/panixida-dotnet-core/presentation-scalar/actions/workflows/ci.yml/badge.svg)](https://github.com/panixida-dotnet-core/presentation-scalar/actions/workflows/ci.yml)
[![NuGet](https://img.shields.io/nuget/v/PANiXiDA.Core.Presentation.Scalar.svg)](https://www.nuget.org/packages/PANiXiDA.Core.Presentation.Scalar)
[![License](https://img.shields.io/github/license/panixida-dotnet-core/presentation-scalar.svg)](LICENSE)

## Installation

```shell
dotnet add package PANiXiDA.Core.Presentation.Scalar
```

## Usage

Register HTTP, SignalR or Wolverine document sources, then configure the presenter once in the host:

```csharp
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

builder.Services.AddApiDocumentation(builder.Configuration, ApplicationJsonContext.Default);

var app = builder.Build();
// Map application transports and endpoints first.
app.UseApiDocumentation();
app.Run();
```

`ApplicationJsonContext` is the application's source-generated `JsonSerializerContext` covering documented payloads. It can be omitted for HTTP-only applications. Sources register separately through their transport packages; this package does not reference the HTTP, SignalR or Wolverine libraries.

The `/scalar` reference lists documents by module, transport and version. AsyncAPI sources are published at their descriptor paths (normally `/asyncapi/{name}.json`); HTTP retains its `/openapi/{name}.json` routes. Scalar displays AsyncAPI contracts; this integration does not add a SignalR or Kafka execution console.

```json
{
  "ScalarConfiguration": {
    "Enabled": true,
    "Title": "Tactical Heroes API",
    "Favicon": "/favicon.svg"
  }
}
```

Without `Enabled`, documentation is exposed only in Development. Put the favicon in the web host's `wwwroot` and publish its static web assets. `SortOperations` defaults to `true`; explicit Scalar sorting settings are preserved. When ASP.NET Core API Explorer is available, HTTP operations keep their method order and put POST operations declaring 201 first. Hosts without HTTP metadata use Scalar method sorting. OpenAPI Scalar transformers are configured by this presenter.

## Native AOT

The presenter uses generated configuration binding and explicit request delegates. JSON schemas require source-generated contexts and have no reflection fallback. CI publishes and runs a Linux Native AOT host, serving both Scalar and an AsyncAPI document over Kestrel.

## Development

```shell
dotnet restore
dotnet format
dotnet build --configuration Release
dotnet test --configuration Release
```

## License

Apache-2.0.
