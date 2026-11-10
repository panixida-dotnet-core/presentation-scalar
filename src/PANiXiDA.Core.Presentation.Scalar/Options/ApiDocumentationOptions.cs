namespace PANiXiDA.Core.Presentation.Scalar.Options;

/// <summary>Configures the shared API documentation presenter.</summary>
public sealed class ApiDocumentationOptions
{
    /// <summary>Gets the existing Scalar configuration section name.</summary>
    public const string SectionName = "ScalarConfiguration";

    /// <summary>Gets or sets whether documentation is enabled; null enables it only in Development.</summary>
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets the reference page title.</summary>
    public string? Title { get; set; }

    /// <summary>Gets or sets the favicon URL owned by the web application.</summary>
    public string? Favicon { get; set; }

    /// <summary>Gets or sets whether default operation sorting is enabled.</summary>
    public bool SortOperations { get; set; } = true;
}
