using System.Text.Json.Serialization;

namespace PANiXiDA.Core.Presentation.Scalar.Configurations;

[JsonSerializable(typeof(string[]))]
internal sealed partial class ScalarJsonContext : JsonSerializerContext;
