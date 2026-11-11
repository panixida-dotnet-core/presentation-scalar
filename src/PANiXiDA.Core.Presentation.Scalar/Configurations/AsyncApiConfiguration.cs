using System.Net.Mime;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

using PANiXiDA.Core.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.Configurations;

internal static class AsyncApiConfiguration
{
    internal static void MapAsyncApi(this WebApplication app, IApiDocumentSource[] sources)
    {
        foreach (var source in sources.OfType<IAsyncApiDocumentSource>())
        {
            foreach (var document in source.GetDocuments())
            {
                if (document.Format != ApiDocumentFormat.AsyncApi)
                {
                    throw new InvalidOperationException($"AsyncAPI source returned non-AsyncAPI document '{document.Name}'.");
                }

                async Task Handler(HttpContext context)
                {
                    context.Response.ContentType = MediaTypeNames.Application.Json;
                    await context.Response.WriteAsync(
                        source.Generate(document.Name, context.RequestAborted).ToJsonString(), context.RequestAborted);
                }

                app.MapGet(document.Path, (RequestDelegate)Handler).ExcludeFromDescription();
            }
        }
    }
}
