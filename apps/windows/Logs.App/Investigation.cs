using System.Reflection;
using System.Text.Json;

namespace Logs.App;

internal sealed record LogEvent(string Id, TimeOnly Time, string Level, string App, string Message, string Source, string RequestId);
internal sealed record Metric(string App, string Name, string Unit, TimeOnly PeakTime, TimeOnly WindowStart, TimeOnly WindowEnd, double[] Values);
internal sealed record Sample(TimeOnly End, LogEvent[] Events, Metric Metric)
{
    public static Sample Load(Assembly assembly)
    {
        using var stream = assembly.GetManifestResourceStream("Logs.Sample.json")
            ?? throw new InvalidOperationException("Logs's bundled sample is missing.");
        return JsonSerializer.Deserialize<Sample>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Logs's bundled sample is empty.");
    }
}

internal sealed class Investigation
{
    public Sample Data { get; }
    public string Query { get; private set; } = "";
    public string? App { get; private set; }
    public string? Level { get; private set; }
    public int RangeMinutes { get; private set; } = 30;
    public bool IsScoped { get; private set; }
    public LogEvent? Selected { get; private set; }
    public IReadOnlyList<LogEvent> Results { get; private set; } = [];
    public TimeOnly ChartStart => Data.End.AddMinutes(-RangeMinutes);
    public bool PeakVisible => Data.Metric.PeakTime.IsBetween(ChartStart, Data.End) || Data.Metric.PeakTime == Data.End;
    public IReadOnlyList<(TimeOnly Time, double Value)> ChartPoints => Data.Metric.Values
        .Select((value, index) => (Time: Data.End.AddMinutes(index + 1 - Data.Metric.Values.Length), Value: value))
        .Where(point => Includes(point.Time)).ToArray();

    public Investigation(Sample data) { Data = data; Refresh(); }
    public void SetQuery(string value) { Query = value; Refresh(); }
    public void SetApp(string? value) { App = value; IsScoped = false; Refresh(); }
    public void SetLevel(string? value) { Level = value; Refresh(); }
    public void SetRange(int minutes)
    {
        if (minutes is not (10 or 30 or 60)) throw new ArgumentOutOfRangeException(nameof(minutes));
        RangeMinutes = minutes;
        IsScoped = false;
        Refresh();
    }
    public bool JumpToPeak()
    {
        if (!PeakVisible) return false;
        var required = (Data.End - Data.Metric.WindowStart).TotalMinutes;
        if (RangeMinutes < required)
            RangeMinutes = new[] { 10, 30, 60 }.FirstOrDefault(minutes => minutes >= required, RangeMinutes);
        Query = "";
        Level = null;
        App = Data.Metric.App;
        IsScoped = true;
        Refresh();
        return true;
    }
    public void ClearScope() { IsScoped = false; Refresh(); }
    public void Reset()
    {
        Query = "";
        App = Level = null;
        IsScoped = false;
        RangeMinutes = 30;
        Refresh();
    }
    public void Select(string id) => Selected = Results.FirstOrDefault(e => e.Id == id);
    public string? CloseSelection()
    {
        var id = Selected?.Id;
        Selected = null;
        return id;
    }
    private bool Includes(TimeOnly time) => time == Data.End || time.IsBetween(ChartStart, Data.End);
    private void Refresh()
    {
        var query = Query.Trim();
        bool Matches(string value) => value.Contains(query, StringComparison.OrdinalIgnoreCase);
        Results = Data.Events.Where(e => Includes(e.Time)
            && (!IsScoped || (e.App == Data.Metric.App && e.Time.IsBetween(Data.Metric.WindowStart, Data.Metric.WindowEnd)))
            && (App is null || e.App == App) && (Level is null || e.Level == Level)
            && (Matches(e.Message) || Matches(e.Source) || Matches(e.RequestId)))
            .OrderBy(e => Data.End - e.Time).ToArray();
        if (Selected is not null && !Results.Contains(Selected)) Selected = null;
    }
}
