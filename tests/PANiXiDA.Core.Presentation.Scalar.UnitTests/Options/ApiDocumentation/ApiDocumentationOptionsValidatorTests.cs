using Microsoft.Extensions.Options;

using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.Options.ApiDocumentation;

public sealed class ApiDocumentationOptionsValidatorTests
{
    [Theory(DisplayName = "A configured AsyncAPI cache duration must be positive")]
    [InlineData("00:00:00")]
    [InlineData("-00:01:00")]
    public async Task Validate_Should_RejectNonpositiveAsyncApiCacheDuration(string duration)
    {
        var builder = ScalarTestHost.CreateBuilder();
        builder.Configuration["ScalarConfiguration:AsyncApiCacheDuration"] = duration;
        builder.Services.AddApiDocumentation(builder.Configuration);
        await using var app = builder.Build();

        var error = await Should.ThrowAsync<OptionsValidationException>(() =>
            app.StartAsync(TestContext.Current.CancellationToken));

        error.Failures.ShouldContain("ScalarConfiguration:AsyncApiCacheDuration must be greater than zero when set.");
    }

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
