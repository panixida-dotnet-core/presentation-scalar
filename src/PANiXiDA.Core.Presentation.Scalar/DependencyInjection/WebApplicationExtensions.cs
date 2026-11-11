using System.Net.Mime;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using PANiXiDA.Core.Presentation.Scalar.Configurations;
using PANiXiDA.Core.ApiDocumentation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

using Scalar.AspNetCore;

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

        MapAsyncApi(app, sources);
        var descriptions = app.Services.GetService<IApiDescriptionGroupCollectionProvider>();
        MapOperationOrdering(app, settings, descriptions);

        if (!string.IsNullOrWhiteSpace(settings.Favicon))
        {
            app.MapStaticAssets().ShortCircuit();
        }

        MapScalar(app, settings, catalog, descriptions);
        applicationBuilder.Properties[MappedKey] = true;
        return app;
    }

    private static void MapAsyncApi(WebApplication app, IApiDocumentSource[] sources)
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
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(
                        source.Generate(document.Name, context.RequestAborted).ToJsonString(), context.RequestAborted);
                }

                app.MapGet(document.Path, (RequestDelegate)Handler).ExcludeFromDescription();
            }
        }

    }

    private static void MapScalar(WebApplication app, ApiDocumentationOptions settings, ApiDocumentCatalog catalog,
        IApiDescriptionGroupCollectionProvider? descriptions)
    {
        app.MapScalarApiReference(options =>
        {
            if (!string.IsNullOrWhiteSpace(settings.Title))
            {
                options.WithTitle(settings.Title);
            }

            if (!string.IsNullOrWhiteSpace(settings.Favicon))
            {
                options.WithFavicon(settings.Favicon);
            }

            ConfigureOperationSorting(options, settings, descriptions);

            foreach (var document in catalog.GetDocuments())
            {
                if (document.Format == ApiDocumentFormat.OpenApi)
                {
                    options.AddDocument(document.Name, document.Title, document.Path);
                }
                else
                {
                    options.AddAsyncApiDocument(document.Name, document.Title, document.Path);
                }
            }
        });
    }

    private static void ConfigureOperationSorting(ScalarOptions options, ApiDocumentationOptions settings,
        IApiDescriptionGroupCollectionProvider? descriptions)
    {
        if (!settings.SortOperations || options.OperationSorter is not null ||
            !string.IsNullOrWhiteSpace(options.JavaScriptConfiguration))
        {
            return;
        }

        if (descriptions is null)
        {
            options.SortOperationsByMethod();
        }
        else
        {
            options.WithJavaScriptConfiguration(ScalarOperationOrdering.ConfigurationPath.TrimStart('/'));
        }
    }

    private static void MapOperationOrdering(WebApplication app, ApiDocumentationOptions settings,
        IApiDescriptionGroupCollectionProvider? descriptions)
    {
        if (!settings.SortOperations || descriptions is null)
        {
            return;
        }

        Task Handler(HttpContext context)
        {
            context.Response.ContentType = MediaTypeNames.Text.JavaScript;
            return context.Response.WriteAsync(ScalarOperationOrdering.CreateConfiguration(descriptions), context.RequestAborted);
        }

        app.MapGet(ScalarOperationOrdering.ConfigurationPath, (RequestDelegate)Handler).ExcludeFromDescription();
    }
}
