using System.Net;
using System.Net.Mime;

using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Configurations;

public sealed class ScalarConfigurationTests
{
    [Fact(DisplayName = "One Scalar reference lists OpenAPI and AsyncAPI documents from independent sources")]
    public async Task MapScalar_Should_ListDocumentsFromBothFormats()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentSource<OpenApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.MapGet("/openapi/http-v1.json", () => Results.Text("{\"openapi\":\"3.1.0\"}", MediaTypeNames.Application.Json));
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);
        using var openApi = await client.GetAsync("/openapi/http-v1.json", TestContext.Current.CancellationToken);

        page.ShouldContain("http-v1");
        page.ShouldContain("events-v1");
        openApi.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact(DisplayName = "Scalar uses the configured page title")]
    public async Task MapScalar_Should_UseConfiguredTitle()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Configuration["ScalarConfiguration:Title"] = "Shared API documentation";
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);

        page.ShouldContain("Shared API documentation");
    }

    [Theory(DisplayName = "Scalar uses relative and absolute favicon URIs and exposes host assets")]
    [InlineData("/favicon.svg")]
    [InlineData("https://cdn.example.com/favicon.svg")]
    public async Task MapScalar_Should_UseConfiguredFavicon(string favicon)
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Configuration["ScalarConfiguration:Favicon"] = favicon;
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);
        var asset = await client.GetStringAsync("/favicon.svg", TestContext.Current.CancellationToken);

        page.ShouldContain(favicon);
        asset.ShouldContain("<svg");
    }
}
