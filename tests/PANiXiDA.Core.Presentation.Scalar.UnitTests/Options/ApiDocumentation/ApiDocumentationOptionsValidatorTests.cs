using Microsoft.Extensions.Options;

using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Options.ApiDocumentation;

public sealed class ApiDocumentationOptionsValidatorTests
{
    [Fact(DisplayName = "An invalid favicon URI is rejected during host startup")]
    public async Task Validate_Should_RejectInvalidFavicon_When_HostStarts()
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Configuration["ScalarConfiguration:Favicon"] = "https://";
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        var error = await Should.ThrowAsync<OptionsValidationException>(() =>
            app.StartAsync(TestContext.Current.CancellationToken));

        error.Failures.ShouldContain("ScalarConfiguration:Favicon must be a well-formed relative or absolute URI.");
    }
}
