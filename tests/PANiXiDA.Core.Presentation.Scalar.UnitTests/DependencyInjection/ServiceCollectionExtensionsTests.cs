using Microsoft.Extensions.Options;

using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.Options.ApiDocumentation;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.DependencyInjection;

public sealed class ServiceCollectionExtensionsTests
{
    [Fact(DisplayName = "Documentation registration binds Scalar settings from configuration")]
    public void AddApiDocumentation_Should_BindScalarSettings()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ScalarConfiguration:Enabled"] = "true",
            ["ScalarConfiguration:Title"] = "Configured API",
            ["ScalarConfiguration:SortOperations"] = "false"
        }).Build();
        var services = new ServiceCollection();

        var registeredServices = services.AddApiDocumentation(configuration);
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<ApiDocumentationOptions>>().Value;

        registeredServices.ShouldBeSameAs(services);
        options.Enabled.ShouldBe(true);
        options.Title.ShouldBe("Configured API");
        options.SortOperations.ShouldBeFalse();
    }

    [Fact(DisplayName = "Documentation registration rejects null arguments")]
    public void AddApiDocumentation_Should_RejectNullArguments()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        Should.Throw<ArgumentNullException>(() => ServiceCollectionExtensions.AddApiDocumentation(null!, configuration));
        Should.Throw<ArgumentNullException>(() => services.AddApiDocumentation(null!));
    }
}
