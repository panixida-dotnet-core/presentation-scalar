using System.Net;

using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;

using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

using Scalar.AspNetCore;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Configurations;

public sealed class ScalarOperationOrderingConfigurationTests
{
    [Theory(DisplayName = "Scalar orders HTTP creation operations through standard API Explorer metadata")]
    [InlineData(true)]
    [InlineData(false)]
    public async Task MapOperationOrdering_Should_ExposeScript_When_SortingIsEnabled(bool enabled)
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddOpenApi();
        builder.Services.AddSingleton<IApiDescriptionGroupCollectionProvider, ExampleDescriptions>();
        builder.Services.AddApiDocumentSource<OpenApiTestSource>();
        builder.Configuration["ScalarConfiguration:SortOperations"] = enabled.ToString();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.MapOpenApi();
        app.MapGet("/orders", static () => "orders");
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

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
    }

    [Fact(DisplayName = "Explicit JavaScript configuration takes precedence over default sorting")]
    public async Task ConfigureOperationSorting_Should_PreserveExplicitJavaScriptConfiguration()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddSingleton<IApiDescriptionGroupCollectionProvider, ExampleDescriptions>();
        builder.Services.AddApiDocumentSource<OpenApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        builder.Services.Configure<ScalarOptions>(options => options.WithJavaScriptConfiguration("custom-sort.js"));
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        var page = await client.GetStringAsync("/scalar/", TestContext.Current.CancellationToken);

        page.ShouldContain("custom-sort.js");
        page.ShouldNotContain("scalar/operation-order.js");
    }

    public sealed class ExampleDescriptions : IApiDescriptionGroupCollectionProvider
    {
        public ApiDescriptionGroupCollection ApiDescriptionGroups { get; } = new(
            [new ApiDescriptionGroup("v1",
            [
                new() { ActionDescriptor = new ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "orders/", SupportedResponseTypes = { new() { StatusCode = 201 } } },
                new() { ActionDescriptor = new ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "orders", SupportedResponseTypes = { new() { StatusCode = 201 } } },
                new() { ActionDescriptor = new ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "GET", RelativePath = "ignored" },
                new() { ActionDescriptor = new ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, GroupName = "excluded", HttpMethod = "POST", RelativePath = null },
                new() { ActionDescriptor = new ActionDescriptor { RouteValues = { ["controller"] = "Orders" } }, HttpMethod = "POST", RelativePath = "ignored", SupportedResponseTypes = { new() { StatusCode = 200 } } }
            ])], 1);
    }
}
