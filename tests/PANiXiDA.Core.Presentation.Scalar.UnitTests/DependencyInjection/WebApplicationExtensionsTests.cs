using System.Net;

using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.DependencyInjection;

public sealed class WebApplicationExtensionsTests
{
    [Theory(DisplayName = "Documentation defaults to Development and supports explicit environment overrides")]
    [InlineData("Production", null, false)]
    [InlineData("Production", "true", true)]
    [InlineData("Development", "false", false)]
    public async Task UseApiDocumentation_Should_HonorEnvironmentAndOverrides(string environment, string? enabled, bool expected)
    {
        var builder = ScalarTestHost.CreateBuilder(environment);
        if (enabled is not null)
        {
            builder.Configuration["ScalarConfiguration:Enabled"] = enabled;
        }

        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);
        using var scalar = await client.GetAsync("/scalar/", TestContext.Current.CancellationToken);
        using var asyncApi = await client.GetAsync("/asyncapi/events-v1.json", TestContext.Current.CancellationToken);

        scalar.StatusCode.ShouldBe(expected ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        asyncApi.StatusCode.ShouldBe(expected ? HttpStatusCode.OK : HttpStatusCode.NotFound);
    }

    [Fact(DisplayName = "Documentation routes are mapped once when registration is repeated")]
    public async Task UseApiDocumentation_Should_MapRoutesOnce_When_CalledTwice()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        var first = app.UseApiDocumentation();
        var second = app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);
        using var scalar = await client.GetAsync("/scalar/", TestContext.Current.CancellationToken);
        using var asyncApi = await client.GetAsync("/asyncapi/events-v1.json", TestContext.Current.CancellationToken);

        first.ShouldBeSameAs(app);
        second.ShouldBeSameAs(app);
        scalar.StatusCode.ShouldBe(HttpStatusCode.OK);
        asyncApi.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact(DisplayName = "Documentation mapping requires an application and a registered source")]
    public async Task UseApiDocumentation_Should_RejectMissingApplicationOrSource()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        Should.Throw<InvalidOperationException>(() => app.UseApiDocumentation());
        Should.Throw<ArgumentNullException>(() => WebApplicationExtensions.UseApiDocumentation(null!));
    }
}
