using PANiXiDA.Core.Presentation.Scalar.AotSmoke;
using System.Text.Json.Nodes;

using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using PANiXiDA.Core.ApiDocumentation.DependencyInjection;
using PANiXiDA.Core.Presentation.Scalar.DependencyInjection;

var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddApiDocumentation(builder.Configuration, SmokeJsonContext.Default);
builder.Services.AddApiDocumentSource<SmokeDocumentSource>();
await using var app = builder.Build();
app.UseApiDocumentation();
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
using var client = new HttpClient { BaseAddress = new Uri(address) };
var page = await client.GetStringAsync("/scalar/");
var document = await client.GetStringAsync("/asyncapi/events-v1.json");
if (!page.Contains("events-v1", StringComparison.Ordinal) || JsonNode.Parse(document)?["asyncapi"]?.GetValue<string>() != "3.0.0")
{
    throw new InvalidOperationException("Scalar or the AsyncAPI endpoint failed in Native AOT.");
}

Console.WriteLine(document);
await app.StopAsync();
