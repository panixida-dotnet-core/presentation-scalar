using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace PANiXiDA.Core.Presentation.Scalar.UnitTests.TestDoubles;

internal static class ScalarTestHost
{
    internal static WebApplicationBuilder CreateBuilder(string environment = "Development")
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        return builder;
    }

    internal static HttpClient CreateClient(WebApplication app)
    {
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        return new HttpClient { BaseAddress = new Uri(address) };
    }
}
