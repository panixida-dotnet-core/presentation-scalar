using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using PANiXiDA.Core.ApiDocumentation;
using PANiXiDA.Core.ApiDocumentation.AsyncApi;

namespace PANiXiDA.Core.Presentation.Scalar.AotSmoke;

internal sealed class SmokeDocumentSource(ApiSchemaRegistry schemas) : IAsyncApiDocumentSource
{
    private static readonly ApiDocumentDescriptor Descriptor = new("events-v1", "Events", "events", "1.0", ApiDocumentFormat.AsyncApi);
    public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments() => [Descriptor];

    public JsonObject Generate(string documentName, CancellationToken cancellationToken = default) =>
        AsyncApiDocumentBuilder.Build(Descriptor,
            [new AsyncApiOperation("StateChanged", "events", AsyncApiAction.Send,
                new AsyncApiMessage("StateChanged", schemas.GetSchema(typeof(StateChanged))), "kafka")]);
}

internal sealed record StateChanged(Guid Id);

[JsonSerializable(typeof(StateChanged))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
internal sealed partial class SmokeJsonContext : JsonSerializerContext;
