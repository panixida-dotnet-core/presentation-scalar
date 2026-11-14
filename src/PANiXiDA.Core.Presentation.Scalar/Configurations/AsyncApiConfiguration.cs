using System.Net.Mime;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.Extensions.DependencyInjection;

using PANiXiDA.Core.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.Configurations;

internal static class AsyncApiConfiguration
{
    internal static void MapAsyncApi(this WebApplication app, IApiDocumentSource[] sources, TimeSpan? cacheDuration)
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

                var endpoint = app.MapGet(document.Path, (RequestDelegate)Handler).ExcludeFromDescription();
                if (cacheDuration is { } duration)
                {
                    endpoint.CacheOutput(policy => policy.Expire(duration));
                    endpoint.Finally(builder =>
                    {
                        var generateDocument = builder.RequestDelegate!;
                        var pipeline = ((IApplicationBuilder)app).New();
                        pipeline.UseOutputCache();
                        pipeline.Run(generateDocument);
                        var serveCachedDocument = pipeline.Build();
                        builder.RequestDelegate = context => context.Features.Get<IOutputCacheFeature>() is null
                            ? serveCachedDocument(context)
                            : generateDocument(context);
                    });
                }
            }
        }
    }
}
