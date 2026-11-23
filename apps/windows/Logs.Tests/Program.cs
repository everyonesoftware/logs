using System.Text.RegularExpressions;
using System.Xml.Linq;
using Logs.App;

var model = new Investigation(Sample.Load(typeof(Investigation).Assembly));
Check("default range and newest-first order", () =>
    Require(model.Results.Count == 15 && model.Results[0].Id == "e16" && model.Results[^1].Id == "e02"));
Check("trimmed case-insensitive request, source and message search", () =>
{
    model.SetQuery("  REQ-74A2 ");
    Require(model.Results.Select(e => e.Id).SequenceEqual(new[] { "e11", "e10", "e09", "e08", "e05" }));
    model.SetQuery("LIBRARY-API");
    Require(model.Results.Select(e => e.Id).SequenceEqual(new[] { "e13", "e12", "e11", "e09", "e08", "e07", "e02" }));
    model.SetQuery("pool saturated");
    Require(model.Results.Single().Id == "e07");
});
Check("app and level intersect; hidden selection clears", () =>
{
    model.Reset();
    model.SetApp("Music");
    model.SetLevel("ERROR");
    Require(model.Results.Count == 3);
    model.Select("e10");
    Require(model.Selected?.RequestId == "req-74a2");
    model.SetQuery("unmatched");
    Require(model.Results.Count == 0 && model.Selected is null);
    model.Select("e10");
    Require(model.Selected is null);
});
Check("peak jump resets competing filters and clear retains Music", () =>
{
    model.Reset();
    model.SetApp("Storage");
    model.SetLevel("INFO");
    model.SetQuery("Backup");
    model.Select("e06");
    Require(model.JumpToPeak() && model.IsScoped && model.Selected is null);
    Require(model.Query == "" && model.Level is null && model.App == "Music");
    Require(model.Results.Select(e => e.Id).SequenceEqual(new[] { "e12", "e11", "e10", "e09", "e08", "e07", "e05" }));
    model.ClearScope();
    Require(!model.IsScoped && model.App == "Music" && model.Results.Count == 9);
});
Check("range changes remove scope and include the lower bound", () =>
{
    model.Reset();
    Require(model.JumpToPeak());
    model.SetRange(10);
    Require(!model.IsScoped && model.PeakVisible && model.ChartPoints[0].Time == new TimeOnly(14, 32));
    Require(model.JumpToPeak());
    Require(model.RangeMinutes == 30 && model.Results.Select(e => e.Id).SequenceEqual(new[] { "e12", "e11", "e10", "e09", "e08", "e07", "e05" }));
    model.SetRange(60);
    model.Reset();
    Require(model.RangeMinutes == 30 && model.App is null && model.ChartPoints.Count == 31);
    model.SetRange(60);
    Require(model.Results.Count == 16 && model.ChartPoints.Count == 31 && model.ChartStart == new TimeOnly(13, 42));
    Require(model.ChartPoints.Single(p => p.Time == model.Data.Metric.PeakTime).Value == 12.4);
});
Check("incident starts inclusive and ends exclusive", () =>
{
    var original = model.Data;
    var boundary = new Investigation(original with { Events = [
        new("start", new TimeOnly(14, 30), "WARN", "Music", "Start", "test", "1"),
        new("end", new TimeOnly(14, 35), "WARN", "Music", "End", "test", "2")
    ] });
    Require(boundary.JumpToPeak() && boundary.Results.Single().Id == "start");
    boundary.Select("start");
    Require(boundary.CloseSelection() == "start" && boundary.Selected is null);
});
Check("native shell names resolve to the declared control types and embed the real fixture", () =>
{
    var project = XDocument.Parse(Read("Logs.App.csproj"));
    var resources = project.Descendants("EmbeddedResource").ToDictionary(e => (string)e.Attribute("LogicalName")!, e => (string)e.Attribute("Include")!);
    Require(resources["Logs.Sample.json"] == "../../../contracts/sample.json" && resources["Logs.Shell.xaml"] == "Shell.xaml");
    var shell = XDocument.Parse(Read("Shell.xaml"));
    var xaml = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml");
    var names = shell.Descendants().Where(e => e.Attribute(xaml + "Name") is not null)
        .ToDictionary(e => (string)e.Attribute(xaml + "Name")!, e => e.Name.LocalName);
    var lookups = Regex.Matches(Read("MainWindow.cs"), """C<(?<type>\w+)>\("(?<name>\w+)"\)""");
    Require(lookups.Count >= 30);
    foreach (Match lookup in lookups)
    {
        var type = lookup.Groups["type"].Value;
        Require(names[lookup.Groups["name"].Value] == (type == "XamlPath" ? "Path" : type));
    }
    Require(shell.Root?.Attribute(xaml + "Class") is null && !shell.Descendants().Any(e => e.Name.LocalName == "WebView2"));
});
Check("shell-local background is resolved by a child after the runtime dictionary loads", () =>
{
    var root = XDocument.Parse(Read("Shell.xaml")).Root!;
    const string background = "{ThemeResource LogsBackground}";
    Require(root.Attribute("Background")?.Value != background);
    Require(root.Elements(root.Name.Namespace + "Border").Any(e =>
        e.Attribute("Background")?.Value == background && e.Attribute("Grid.RowSpan")?.Value == "2" &&
        e.Attribute("IsHitTestVisible")?.Value == "False"));
});

static string Read(string name)
{
    var assembly = typeof(Investigation).Assembly;
    var key = assembly.GetManifestResourceNames().Single(n => n.EndsWith("." + name, StringComparison.Ordinal));
    using var reader = new StreamReader(assembly.GetManifestResourceStream(key)!);
    return reader.ReadToEnd();
}
static void Check(string name, Action assert)
{
    try { assert(); Console.WriteLine($"PASS {name}"); }
    catch (Exception ex) { throw new InvalidOperationException(name, ex); }
}
static void Require(bool condition)
{
    if (!condition) throw new InvalidOperationException("Assertion failed.");
}
