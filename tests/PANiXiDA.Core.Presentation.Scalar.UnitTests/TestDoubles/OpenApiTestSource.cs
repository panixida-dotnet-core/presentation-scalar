using PANiXiDA.Core.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

public sealed class OpenApiTestSource : IApiDocumentSource
{
    public IReadOnlyCollection<ApiDocumentDescriptor> GetDocuments() =>
        [new("http-v1", "HTTP", "module", "1.0", ApiDocumentFormat.OpenApi)];
}
