using Microsoft.Extensions.Options;

namespace PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

internal sealed class ApiDocumentationOptionsValidator : IValidateOptions<ApiDocumentationOptions>
{
    public ValidateOptionsResult Validate(string? name, ApiDocumentationOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.Favicon)
            || Uri.IsWellFormedUriString(options.Favicon, UriKind.RelativeOrAbsolute))
        {
            return ValidateOptionsResult.Success;
        }

        return ValidateOptionsResult.Fail(
            $"{ApiDocumentationOptions.SectionName}:{nameof(ApiDocumentationOptions.Favicon)} must be a well-formed relative or absolute URI.");
    }
}
