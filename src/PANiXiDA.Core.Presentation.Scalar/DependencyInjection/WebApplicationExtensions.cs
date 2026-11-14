using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

using PANiXiDA.Core.ApiDocumentation;
using PANiXiDA.Core.Presentation.Scalar.Configurations;
using PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

/// <summary>Publishes transport-owned documents through a single Scalar reference.</summary>
public static class WebApplicationExtensions
{
    private const string MappedKey = "PANiXiDA.Core.Presentation.Scalar.Mapped";

    /// <summary>Maps AsyncAPI documents and Scalar after all application transports have been mapped.</summary>
    /// <param name="app">The web application.</param>
    /// <returns>The original application.</returns>
    /// <remarks>Documentation defaults to Development. Transport libraries map their own OpenAPI endpoints.</remarks>
    public static WebApplication UseApiDocumentation(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        var settings = app.Services.GetRequiredService<IOptions<ApiDocumentationOptions>>().Value;
        if (!(settings.Enabled ?? app.Environment.IsDevelopment()))
        {
            return app;
        }

        var applicationBuilder = (IApplicationBuilder)app;
        if (applicationBuilder.Properties.ContainsKey(MappedKey))
        {
            return app;
        }

        var catalog = app.Services.GetRequiredService<ApiDocumentCatalog>();
        var sources = app.Services.GetServices<IApiDocumentSource>().ToArray();
        if (sources.Length == 0)
        {
            throw new InvalidOperationException("No API document sources were registered. Register HTTP, SignalR or Kafka documentation before UseApiDocumentation.");
        }

        app.MapAsyncApi(sources, settings.AsyncApiCacheDuration);
        if (sources.OfType<IAsyncApiDocumentSource>().Any())
        {
            app.MapSignalRConsole();
        }

        var descriptions = app.Services.GetService<IApiDescriptionGroupCollectionProvider>();
        app.MapOperationOrdering(settings.SortOperations, descriptions);
        app.MapScalar(settings, catalog, descriptions);
        applicationBuilder.Properties[MappedKey] = true;
        return app;
    }
}
