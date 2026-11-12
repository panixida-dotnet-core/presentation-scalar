using System.Net;
using System.Net.Mime;

using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Configurations;

public sealed class SignalRConsoleConfigurationTests
{
    [Fact(DisplayName = "Scalar serves the SignalR console and its local assets under the application path base")]
    public async Task UseApiDocumentation_Should_ServeSignalRConsoleAssets_When_AsyncApiIsRegistered()
    {
        const string PathBase = "/gateway";
        const string ConsolePath = PathBase + "/scalar/signalr-console";
        var cancellationToken = TestContext.Current.CancellationToken;
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.UsePathBase(PathBase);
        app.UseApiDocumentation();
        await app.StartAsync(cancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync(PathBase + "/scalar/", cancellationToken);
        using var script = await client.GetAsync(ConsolePath + "/console.js", cancellationToken);
        using var requests = await client.GetAsync(ConsolePath + "/requests.js", cancellationToken);
        using var stylesheet = await client.GetAsync(ConsolePath + "/console.css", cancellationToken);
        using var signalR = await client.GetAsync(ConsolePath + "/signalr.min.js", cancellationToken);

        page.ShouldContain($"src=\"{ConsolePath}/console.js\"");
        page.ShouldContain($"href=\"{ConsolePath}/console.css\"");
        page.ShouldContain($"data-path-base=\"{PathBase}\"");
        page.ShouldContain("data-documents=\"[&quot;/asyncapi/events-v1.json&quot;]\"");
        page.ShouldContain("SignalR console");
        script.StatusCode.ShouldBe(HttpStatusCode.OK);
        script.Content.Headers.ContentType?.MediaType.ShouldBe(MediaTypeNames.Text.JavaScript);
        requests.StatusCode.ShouldBe(HttpStatusCode.OK);
        requests.Content.Headers.ContentType?.MediaType.ShouldBe(MediaTypeNames.Text.JavaScript);
        stylesheet.StatusCode.ShouldBe(HttpStatusCode.OK);
        stylesheet.Content.Headers.ContentType?.MediaType.ShouldBe(MediaTypeNames.Text.Css);
        signalR.StatusCode.ShouldBe(HttpStatusCode.OK);
        signalR.Content.Headers.ContentType?.MediaType.ShouldBe(MediaTypeNames.Text.JavaScript);
        (await signalR.Content.ReadAsStringAsync(cancellationToken)).ShouldContain("HubConnectionBuilder");
    }

    [Fact(DisplayName = "An OpenAPI-only Scalar page does not load SignalR console assets")]
    public async Task UseApiDocumentation_Should_OmitSignalRConsole_When_OnlyOpenApiIsRegistered()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<OpenApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(cancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync("/scalar/", cancellationToken);
        using var script = await client.GetAsync("/scalar/signalr-console/console.js", cancellationToken);

        page.ShouldNotContain("panixida-signalr-console");
        script.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
