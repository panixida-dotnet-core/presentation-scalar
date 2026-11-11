using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.ApiDocumentation;
using System.Text.Json.Serialization;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

using Microsoft.AspNetCore.OpenApi;
using Scalar.AspNetCore;

namespace PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

/// <summary>Registers the single documentation presenter used by the web host.</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Registers Scalar settings and optional source-generated payload schemas.</summary>
    /// <param name="services">The application services.</param>
    /// <param name="configuration">Configuration containing ScalarConfiguration.</param>
    /// <param name="contexts">JSON contexts covering documented payloads.</param>
    /// <returns>The application services.</returns>
    public static IServiceCollection AddApiDocumentation(this IServiceCollection services,
        IConfiguration configuration, params JsonSerializerContext[] contexts)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddApiDocumentationSchemas(contexts);
        services.TryAddSingleton<ApiDocumentCatalog>();
        services.ConfigureAll<OpenApiOptions>(options => options.AddScalarTransformers());
        services.AddSingleton<IValidateOptions<ApiDocumentationOptions>, ApiDocumentationOptionsValidator>();
        services.AddOptions<ApiDocumentationOptions>()
            .Bind(configuration.GetSection(ApiDocumentationOptions.SectionName))
            .ValidateOnStart();

        return services;
    }
}
