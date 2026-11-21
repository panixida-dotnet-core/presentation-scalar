using System.Net.Mime;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;

using PANiXiDA.Core.ApiDocumentation;

using Scalar.AspNetCore;

namespace PANiXiDA.Core.Presentation.Scalar.Configurations;

internal static partial class SignalRConsoleConfiguration
{
    private const string AssetPath = "/scalar/signalr-console";

    private static readonly EmbeddedFileProvider s_assets = new(typeof(SignalRConsoleConfiguration).Assembly,
        "PANiXiDA.Core.Presentation.Scalar.Assets.SignalRConsole");

    private static readonly Lazy<string> s_markup = new(() =>
    {
        using var reader = new StreamReader(s_assets.GetFileInfo("console.html").CreateReadStream());
        return reader.ReadToEnd();
    });

    internal static void MapSignalRConsole(this WebApplication app)
    {
        MapAsset(app, "console.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "requests.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "connection.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "schema.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "snippets.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "view.js", MediaTypeNames.Text.JavaScript);
        MapAsset(app, "console.css", MediaTypeNames.Text.Css);
        MapAsset(app, "signalr.min.js", MediaTypeNames.Text.JavaScript);
    }

    internal static void ConfigureSignalRConsole(this ScalarOptions options, PathString pathBase,
        IEnumerable<ApiDocumentDescriptor> documents)
    {
        var sources = documents
            .Select(document => new ConsoleDocument(document.Title,
                document.Format == ApiDocumentFormat.AsyncApi ? document.Path : null))
            .ToArray();
        if (!sources.Any(source => source.Path is not null))
        {
            return;
        }

        var assets = HtmlEncoder.Default.Encode(pathBase.Add(AssetPath).ToUriComponent());
        var encodedSources = HtmlEncoder.Default.Encode(
            JsonSerializer.Serialize(sources, ConsoleJsonContext.Default.ConsoleDocumentArray));
        var encodedBase = HtmlEncoder.Default.Encode(pathBase.ToUriComponent());
        options.AddHeadContent($"""
            <link rel="stylesheet" href="{assets}/console.css">
            <script type="module" src="{assets}/console.js"></script>
            """);
        options.AddHeaderContent($"""
            <div id="panixida-signalr-console" data-documents="{encodedSources}" data-path-base="{encodedBase}" hidden>
            {s_markup.Value}
            </div>
            """);
    }

    private static void MapAsset(WebApplication app, string name, string contentType)
    {
        using var resource = s_assets.GetFileInfo(name).CreateReadStream();
        using var buffer = new MemoryStream();
        resource.CopyTo(buffer);
        var bytes = buffer.ToArray();

        Task Handler(HttpContext context)
        {
            context.Response.ContentType = contentType;
            context.Response.ContentLength = bytes.Length;
            return context.Response.Body.WriteAsync(bytes, context.RequestAborted).AsTask();
        }

        app.MapGet($"{AssetPath}/{name}", (RequestDelegate)Handler).ExcludeFromDescription();
    }

    private sealed record ConsoleDocument(string Title, string? Path);

    [JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
    [JsonSerializable(typeof(ConsoleDocument[]))]
    private sealed partial class ConsoleJsonContext : JsonSerializerContext;
}
