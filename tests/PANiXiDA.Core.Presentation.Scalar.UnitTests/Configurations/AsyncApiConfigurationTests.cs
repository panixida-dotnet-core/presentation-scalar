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

        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/json");
        document["asyncapi"]!.GetValue<string>().ShouldBe("3.0.0");
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
