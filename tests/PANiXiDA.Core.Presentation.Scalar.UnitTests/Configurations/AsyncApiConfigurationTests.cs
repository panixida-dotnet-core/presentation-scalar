using System.Net.Mime;
using System.Text.Json.Nodes;

using PANiXiDA.Core.ApiDocumentation;
using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Configurations;

public sealed class AsyncApiConfigurationTests
{
    [Fact(DisplayName = "AsyncAPI endpoints return generated JSON")]
    public async Task MapAsyncApi_Should_ReturnGeneratedJson()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        app.UseApiDocumentation();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = ScalarTestHost.CreateClient(app);

        using var response = await client.GetAsync("/asyncapi/events-v1.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = JsonNode.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!;

        response.Content.Headers.ContentType!.MediaType.ShouldBe(MediaTypeNames.Application.Json);
        document["asyncapi"]!.GetValue<string>().ShouldBe("3.0.0");
    }

    [Theory(DisplayName = "AsyncAPI response caching is opt-in and can use the host output cache")]
    [InlineData(false, false, 2)]
    [InlineData(true, false, 1)]
    [InlineData(true, true, 1)]
    public async Task MapAsyncApi_Should_CacheOnlyConfiguredResponses(
        bool cacheEnabled, bool useHostCache, int expectedGenerations)
    {
        const string documentPath = "/asyncapi/events-v1.json";
        var cancellationToken = TestContext.Current.CancellationToken;
        var builder = ScalarTestHost.CreateBuilder();
        if (cacheEnabled)
        {
            builder.Configuration["ScalarConfiguration:AsyncApiCacheDuration"] = "00:10:00";
        }

        builder.Services.AddApiDocumentSource<AsyncApiTestSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();
        if (useHostCache)
        {
            app.UseOutputCache();
        }

        app.UseApiDocumentation();
        var calls = 0;
        app.MapGet("/counter", () => Interlocked.Increment(ref calls));
        await app.StartAsync(cancellationToken);
        using var client = ScalarTestHost.CreateClient(app);
        var source = app.Services.GetServices<IApiDocumentSource>().OfType<AsyncApiTestSource>().Single();

        var first = await client.GetByteArrayAsync(documentPath, cancellationToken);
        var second = await client.GetByteArrayAsync(documentPath, cancellationToken);
        (await client.GetStringAsync("/counter", cancellationToken)).ShouldBe("1");
        (await client.GetStringAsync("/counter", cancellationToken)).ShouldBe("2");

        second.ShouldBe(first);
        source.GenerationCount.ShouldBe(expectedGenerations);

        using var request = new HttpRequestMessage(HttpMethod.Get, documentPath);
        request.Headers.Authorization = new("Bearer", "test-token");
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        (await response.Content.ReadAsByteArrayAsync(cancellationToken)).ShouldBe(first);
        response.Headers.Age.ShouldBeNull();
        source.GenerationCount.ShouldBe(expectedGenerations + 1);
    }

    [Fact(DisplayName = "AsyncAPI endpoints reject descriptors for other formats")]
    public async Task MapAsyncApi_Should_RejectDescriptors_When_FormatIsOpenApi()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Services.AddApiDocumentSource<WrongSource>();
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        var error = Should.Throw<InvalidOperationException>(() => app.UseApiDocumentation());

        error.Message.ShouldContain("non-AsyncAPI");
    }

    public sealed class WrongSource : IAsyncApiDocumentSource
    {
        public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments() =>
            [new("wrong-v1", "Wrong", "module", "1.0", ApiDocumentFormat.OpenApi)];

        public JsonObject Generate(string documentName, CancellationToken cancellationToken = default) => [];
    }
}
