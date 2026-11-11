using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc.ApiExplorer;

using PANiXiDA.Core.ApiDocumentation;
using PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

using Scalar.AspNetCore;

namespace PANiXiDA.Core.Presentation.Scalar.Configurations;

internal static class ScalarConfiguration
{
    internal static void MapScalar(this WebApplication app, ApiDocumentationOptions settings, ApiDocumentCatalog catalog,
        IApiDescriptionGroupCollectionProvider? descriptions)
    {
        if (!string.IsNullOrWhiteSpace(settings.Favicon))
        {
            app.MapStaticAssets().ShortCircuit();
        }

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

            options.ConfigureOperationSorting(settings.SortOperations, descriptions);

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
}
