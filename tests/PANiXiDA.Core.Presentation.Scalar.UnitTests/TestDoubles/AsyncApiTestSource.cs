using System.Text.Json.Nodes;

using PANiXiDA.Core.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

public sealed class AsyncApiTestSource : IAsyncApiDocumentSource
{
    private int _generationCount;

    internal int GenerationCount => _generationCount;

    public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments() =>
        [new("events-v1", "Events", "module", "1.0", ApiDocumentFormat.AsyncApi)];

    public JsonObject Generate(string documentName, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _generationCount);
        return new JsonObject
        {
            ["asyncapi"] = "3.0.0",
            ["info"] = new JsonObject { ["title"] = "Events", ["version"] = "1.0" }
        };
    }
}
