using Scalar.AspNetCore;

using System.Net;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

using PANiXiDA.Core.ApiDocumentation;
using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests;

public sealed class ScalarHostingTests
{
    [Fact(DisplayName = "One Scalar reference lists OpenAPI and AsyncAPI documents from independent sources")]
    public async Task HostsMixedDocuments()
    {
        await using var app = CreateApplication("Development");
        app.MapGet("/openapi/http-v1.json", () => Results.Text("{\"openapi\":\"3.1.0\"}", "application/json"));
        app.UseApiDocumentation().ShouldBeSameAs(app);
        app.UseApiDocumentation().ShouldBeSameAs(app);
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = CreateClient(app);
        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);
        page.ShouldContain("http-v1");
        page.ShouldContain("events-v1");
        var document = JsonNode.Parse(await client.GetStringAsync("/asyncapi/events-v1.json", TestContext.Current.CancellationToken))!;
        document["asyncapi"]!.GetValue<string>().ShouldBe("3.0.0");
        (await client.GetAsync("/openapi/http-v1.json", TestContext.Current.CancellationToken)).StatusCode.ShouldBe(HttpStatusCode.OK);
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory(DisplayName = "Documentation defaults to Development and supports explicit environment overrides")]
    [InlineData("Production", null, false)]
    [InlineData("Production", "true", true)]
    [InlineData("Development", "false", false)]
    public async Task HonorsEnvironment(string environment, string? enabled, bool expected)
    {
        await using var app = CreateApplication(environment, enabled);
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = CreateClient(app);
        (await client.GetAsync("/scalar/", TestContext.Current.CancellationToken)).StatusCode.ShouldBe(expected ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        (await client.GetAsync("/asyncapi/events-v1.json", TestContext.Current.CancellationToken)).StatusCode.ShouldBe(expected ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact(DisplayName = "Presenter validates registration and public arguments")]
    public async Task GuardsRegistration()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        Should.Throw<InvalidOperationException>(() => app.UseApiDocumentation());
        Should.Throw<ArgumentNullException>(() => WebApplicationExtensions.UseApiDocumentation(null!));
        Should.Throw<ArgumentNullException>(() => PANiXiDA.Core.Presentation.Scalar.DependencyInjection.ServiceCollectionExtensions.AddApiDocumentation(null!, builder.Configuration));
        Should.Throw<ArgumentNullException>(() => builder.Services.AddApiDocumentation(null!));
    }

    [Fact(DisplayName = "Presenter applies shared title and supports disabling operation sorting")]
    public async Task AppliesOptions()
    {
        await using var app = CreateApplication("Development", extra: new Dictionary<string, string?>
        {
            ["ScalarConfiguration:Title"] = "Shared API documentation",
            ["ScalarConfiguration:SortOperations"] = "false"
        });
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = CreateClient(app);
        (await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken)).ShouldContain("Shared API documentation");
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory(DisplayName = "Scalar orders HTTP creation operations through standard API Explorer metadata")]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OrdersHttpOperations(bool enabled)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddOpenApi();
        builder.Services.AddSingleton<Microsoft.AspNetCore.Mvc.ApiExplorer.IApiDescriptionGroupCollectionProvider, ExampleDescriptions>();
        builder.Services.AddApiDocumentSource<HttpSource>();
        builder.Configuration["ScalarConfiguration:SortOperations"] = enabled.ToString();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.MapOpenApi();
        app.MapGet("/orders", static () => "orders");
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = CreateClient(app);
        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);
        using var script = await client.GetAsync("/scalar/operation-order.js", TestContext.Current.CancellationToken);
        script.StatusCode.ShouldBe(HttpStatusCode.OK);
        script.Content.Headers.ContentType!.MediaType.ShouldBe(enabled ? "text/javascript" : "text/html");
        if (enabled)
        {
            var code = await script.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            code.ShouldContain("/orders");
            code.ShouldNotContain("/ignored");
            page.ShouldContain("scalar/operation-order.js");
            (await client.GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken)).ShouldContain("openapi");
        }

        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    public sealed class ExampleDescriptions : Microsoft.AspNetCore.Mvc.ApiExplorer.IApiDescriptionGroupCollectionProvider
    {
        public Microsoft.AspNetCore.Mvc.ApiExplorer.ApiDescriptionGroupCollection ApiDescriptionGroups { get; } = new(
            [new Microsoft.AspNetCore.Mvc.ApiExplorer.ApiDescriptionGroup("v1",
            [
                new() { ActionDescriptor = new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "orders/", SupportedResponseTypes = { new() { StatusCode = 201 } } },
                new() { ActionDescriptor = new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "orders", SupportedResponseTypes = { new() { StatusCode = 201 } } },
                new() { ActionDescriptor = new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "GET", RelativePath = "ignored" },
                new() { ActionDescriptor = new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, GroupName = "excluded", HttpMethod = "POST", RelativePath = null },
                new() { ActionDescriptor = new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "ignored", SupportedResponseTypes = { new() { StatusCode = 200 } } }
            ])], 1);
    }
    private static WebApplication CreateApplication(string environment, string? enabled = null,
        Dictionary<string, string?>? extra = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        var settings = extra ?? [];
        if (enabled is not null)
        {
            settings["ScalarConfiguration:Enabled"] = enabled;
        }

        builder.Configuration.AddInMemoryCollection(settings);
        builder.Services.AddApiDocumentSource<ExampleSource>();
        builder.Services.AddApiDocumentSource<HttpSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        return builder.Build();
    }

    [Fact(DisplayName = "Presenter rejects non-AsyncAPI descriptors returned by AsyncAPI sources")]
    public async Task RejectsInvalidSources()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.Services.AddApiDocumentation(builder.Configuration);
        builder.Services.AddApiDocumentSource<WrongSource>();
        await using var app = builder.Build();
        Should.Throw<InvalidOperationException>(() => app.UseApiDocumentation()).Message.ShouldContain("non-AsyncAPI");
    }

    [Fact(DisplayName = "Presenter applies the host favicon and preserves explicitly configured Scalar sorting")]
    public async Task AppliesFaviconAndCustomSorting()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration["ScalarConfiguration:Favicon"] = "/favicon.svg";
        builder.Services.AddApiDocumentSource<ExampleSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        builder.Services.Configure<global::Scalar.AspNetCore.ScalarOptions>(options =>
            options.WithJavaScriptConfiguration("custom-sort.js"));
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = CreateClient(app);
        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);
        page.ShouldContain("/favicon.svg");
        (await client.GetStringAsync("/favicon.svg", TestContext.Current.CancellationToken)).ShouldContain("<svg");
        page.ShouldContain("custom-sort.js");
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    private static HttpClient CreateClient(WebApplication app)
    {
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        return new HttpClient { BaseAddress = new Uri(address) };
    }

    public sealed class ExampleSource : IAsyncApiDocumentSource
    {
        public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments()
        {
            return [
                new("events-v1", "Events", "module", "1.0", ApiDocumentFormat.AsyncApi)
            ];
        }

        public JsonObject Generate(string documentName, CancellationToken cancellationToken = default)
        {
            return new JsonObject { ["asyncapi"] = "3.0.0", ["info"] = new JsonObject { ["title"] = "Events", ["version"] = "1.0" } };
        }
    }

    public sealed class HttpSource : IApiDocumentSource
    {
        public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments()
        {
            return [new("http-v1", "HTTP", "module", "1.0", ApiDocumentFormat.OpenApi)];
        }
    }

    public sealed class WrongSource : IAsyncApiDocumentSource
    {
        public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments() =>
            [new("wrong-v1", "Wrong", "module", "1.0", ApiDocumentFormat.OpenApi)];

        public JsonObject Generate(string documentName, CancellationToken cancellationToken = default) => [];
    }
}
