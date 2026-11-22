using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using Windows.Graphics;
using Windows.System;
using Windows.UI;
using XamlPath = Microsoft.UI.Xaml.Shapes.Path;

namespace Signal.App;

internal sealed class MainWindow : Window
{
    private readonly Grid root;
    private readonly Investigation model;
    private readonly ComboBox app;
    private readonly ComboBox level;
    private readonly ComboBox range;
    private readonly TextBox search;
    private readonly ListView events;
    private readonly Canvas timeline;
    private readonly Button peak;
    private readonly Button close;
    private readonly Button settingsButton;
    private bool syncing;
    private bool settingsOpen;
    private bool? wide;

    public MainWindow()
    {
        using var reader = new StreamReader(typeof(MainWindow).Assembly.GetManifestResourceStream("Signal.Shell.xaml")!);
        root = (Grid)XamlReader.Load(reader.ReadToEnd());
        Content = root;
        Title = "Signal";
        if (AppWindowTitleBar.IsCustomizationSupported())
        {
            ExtendsContentIntoTitleBar = true;
            SetTitleBar(C<Border>("TitleBar"));
            UpdateCaptionColors();
            root.ActualThemeChanged += (_, _) => UpdateCaptionColors();
        }
        else
        {
            C<Border>("TitleBar").Visibility = Visibility.Collapsed;
            root.RowDefinitions[0].Height = new GridLength(0);
        }
        var display = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        if (display is not null)
        {
            var workArea = display.WorkArea;
            AppWindow.Resize(new SizeInt32(Math.Min(1220, workArea.Width), Math.Min(850, workArea.Height)));
        }

        model = new Investigation(Sample.Load(typeof(MainWindow).Assembly));
        var metric = model.Data.Metric;
        C<TextBlock>("SampleLabel").Text = $"Sample data · Timeline ends at {Stamp(model.Data.End)} UTC";
        app = C<ComboBox>("AppFilter");
        level = C<ComboBox>("LevelFilter");
        range = C<ComboBox>("RangeFilter");
        search = C<TextBox>("SearchBox");
        events = C<ListView>("EventsList");
        timeline = C<Canvas>("Timeline");
        peak = C<Button>("PeakPoint");
        close = C<Button>("CloseDetailsButton");
        settingsButton = C<Button>("SettingsButton");

        app.Items.Add(Option("All apps", null));
        foreach (var name in model.Data.Events.Select(e => e.App).Distinct().Order(StringComparer.Ordinal))
            app.Items.Add(Option(name, name));
        level.Items.Add(Option("All severities", null));
        level.Items.Add(Option("Errors", "ERROR"));
        level.Items.Add(Option("Warnings", "WARN"));
        level.Items.Add(Option("Info", "INFO"));
        range.Items.Add(Option("Last 30 minutes", 30));
        range.Items.Add(Option("Last 10 minutes", 10));
        range.Items.Add(Option("Last hour", 60));
        C<TextBlock>("MetricLabel").Text = $"{metric.App} · {metric.Name} · 1 min buckets";
        C<TextBlock>("ScopeText").Text = $"Metric window · {metric.App} · {Stamp(metric.WindowStart)}–{Stamp(metric.WindowEnd)} UTC";
        var jumpName = $"Show {metric.App} logs around {Stamp(metric.PeakTime)}";
        C<TextBlock>("JumpLabel").Text = jumpName;
        AutomationProperties.SetName(peak, jumpName);
        ToolTipService.SetToolTip(peak, jumpName);
        var version = typeof(MainWindow).Assembly.GetName().Version;
        C<TextBlock>("VersionLabel").Text = $"Current Version: {version?.ToString(3)}";

        search.TextChanged += (_, _) => Apply(() => model.SetQuery(search.Text));
        app.SelectionChanged += (_, _) => Apply(() => model.SetApp(Value(app) as string));
        level.SelectionChanged += (_, _) => Apply(() => model.SetLevel(Value(level) as string));
        range.SelectionChanged += (_, _) =>
        {
            if (Value(range) is int minutes) Apply(() => model.SetRange(minutes), redraw: true);
        };
        C<Button>("ResetButton").Click += (_, _) =>
        {
            Apply(model.Reset, redraw: true);
            search.Focus(FocusState.Programmatic);
        };
        C<Button>("ClearScopeButton").Click += (_, _) =>
        {
            Apply(model.ClearScope);
            app.Focus(FocusState.Programmatic);
        };
        C<Button>("JumpButton").Click += (_, _) => Jump();
        peak.Click += (_, _) => Jump();
        close.Click += (_, _) => CloseDetails();
        settingsButton.Click += (_, _) => ToggleSettings();
        events.SelectionChanged += (_, _) =>
        {
            if (syncing) return;
            if (events.SelectedItem is ListViewItem { Tag: LogEvent entry }) model.Select(entry.Id);
            else model.CloseSelection();
            RenderDetails();
        };
        events.IsItemClickEnabled = true;
        events.ItemClick += (_, args) =>
        {
            if (args.ClickedItem is not ListViewItem { Tag: LogEvent entry } row) return;
            events.SelectedItem = row;
            model.Select(entry.Id);
            RenderDetails();
            close.Focus(FocusState.Programmatic);
        };
        root.KeyDown += HandleKeyDown;
        root.SizeChanged += (_, e) => Arrange(e.NewSize.Width);
        timeline.SizeChanged += (_, _) => RenderChart();
        RenderResults();
        RenderChart();
    }

    private T C<T>(string name) where T : FrameworkElement =>
        root.FindName(name) as T ?? throw new InvalidOperationException($"Missing {typeof(T).Name}: {name}");
    private static ComboBoxItem Option(string text, object? value) => new() { Content = text, Tag = value };
    private static object? Value(ComboBox combo) => (combo.SelectedItem as ComboBoxItem)?.Tag;
    private static string Stamp(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);
    private static Visibility AsVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    private void Apply(Action update, bool redraw = false)
    {
        if (syncing) return;
        update();
        RenderResults();
        if (redraw) RenderChart();
    }

    private void Jump()
    {
        if (!model.JumpToPeak()) return;
        RenderResults();
        RenderChart();
        C<Button>("ClearScopeButton").Focus(FocusState.Programmatic);
    }

    private void RenderResults()
    {
        syncing = true;
        try
        {
            if (search.Text != model.Query) search.Text = model.Query;
            SelectOption(app, model.App);
            SelectOption(level, model.Level);
            SelectOption(range, model.RangeMinutes);
            C<Border>("Scope").Visibility = AsVisibility(model.IsScoped);
            var count = model.Results.Count;
            C<TextBlock>("ResultCount").Text = count == 1 ? "1 event" : $"{count} events";
            C<TextBlock>("NoResults").Visibility = AsVisibility(count == 0);
            events.Visibility = AsVisibility(count > 0);
            events.Items.Clear();
            foreach (var entry in model.Results)
            {
                var row = Row(entry);
                events.Items.Add(row);
                if (entry == model.Selected) events.SelectedItem = row;
            }
            RenderDetails();
        }
        finally { syncing = false; }
    }

    private static void SelectOption(ComboBox combo, object? value) =>
        combo.SelectedItem = combo.Items.Cast<ComboBoxItem>().FirstOrDefault(item => Equals(item.Tag, value));

    private static ListViewItem Row(LogEvent entry)
    {
        var time = entry.Time.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
        var row = new ListViewItem
        {
            Tag = entry,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(6, 7, 6, 7),
            Content = new StackPanel
            {
                Spacing = 4,
                Children =
                {
                    new TextBlock { Text = $"{time}  ·  {entry.Level}  ·  {entry.App}", FontFamily = new FontFamily("Consolas"), FontSize = 12, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap },
                    new TextBlock { Text = entry.Message, TextWrapping = TextWrapping.Wrap }
                }
            }
        };
        AutomationProperties.SetName(row, $"{time} UTC, {entry.Level}, {entry.App}: {entry.Message}");
        return row;
    }

    private void RenderDetails()
    {
        var entry = model.Selected;
        C<Border>("Details").Visibility = AsVisibility(entry is not null);
        C<TextBlock>("DetailMessage").Text = entry?.Message ?? "";
        C<TextBlock>("DetailFields").Text = entry is null ? "" : $"Time: {entry.Time:HH:mm:ss} UTC\nSeverity: {entry.Level}\nApp: {entry.App}\nSource: {entry.Source}\nRequest ID: {entry.RequestId}";
    }

    private void CloseDetails()
    {
        var row = events.SelectedItem as ListViewItem;
        model.CloseSelection();
        events.SelectedItem = null;
        RenderDetails();
        if (row?.Focus(FocusState.Programmatic) != true) search.Focus(FocusState.Programmatic);
    }

    private void ToggleSettings()
    {
        settingsOpen = !settingsOpen;
        C<StackPanel>("Workspace").Visibility = AsVisibility(!settingsOpen);
        C<Border>("Settings").Visibility = AsVisibility(settingsOpen);
        C<TextBlock>("PageHeading").Text = settingsOpen ? "Settings" : "Investigate";
        C<TextBlock>("PageCaption").Text = settingsOpen ? "Signal for Windows" : "Search across apps. Check the metric without leaving the results.";
        settingsButton.Content = settingsOpen ? "Back" : "Settings";
    }

    private void HandleKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if (settingsOpen || app.IsDropDownOpen || level.IsDropDownOpen || range.IsDropDownOpen) return;
        if (args.Key == VirtualKey.Escape && model.Selected is not null)
        {
            args.Handled = true;
            CloseDetails();
        }
        else if (args.Key == (VirtualKey)0xBF && FocusManager.GetFocusedElement(root.XamlRoot) is not TextBox)
        {
            var control = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control);
            var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift);
            var alt = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Menu);
            if (((control | shift | alt) & Windows.UI.Core.CoreVirtualKeyStates.Down) != 0) return;
            args.Handled = true;
            search.Focus(FocusState.Keyboard);
        }
    }

    private void Arrange(double width)
    {
        var next = width >= 900;
        if (wide == next) return;
        wide = next;
        var work = C<Grid>("Work");
        var side = C<StackPanel>("Side");
        var toolbar = C<Grid>("Toolbar");
        var reset = C<Button>("ResetButton");
        toolbar.ColumnDefinitions[2].Width = next ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        toolbar.ColumnDefinitions[3].Width = next ? GridLength.Auto : new GridLength(0);
        toolbar.RowSpacing = next ? 0 : 8;
        Grid.SetRow(range, next ? 0 : 1);
        Grid.SetColumn(range, next ? 2 : 0);
        Grid.SetRow(reset, next ? 0 : 1);
        Grid.SetColumn(reset, next ? 3 : 1);
        work.ColumnSpacing = next ? 14 : 0;
        work.RowSpacing = next ? 0 : 14;
        work.ColumnDefinitions[1].Width = new GridLength(next ? 350 : 0);
        Grid.SetColumn(side, next ? 1 : 0);
        Grid.SetRow(side, next ? 0 : 1);
    }

    private void RenderChart()
    {
        var metric = model.Data.Metric;
        var points = model.ChartPoints;
        var topValue = Math.Max(1, Math.Ceiling(metric.Values.Max() / 5) * 5);
        var peakValue = points.FirstOrDefault(p => p.Time == metric.PeakTime).Value;
        C<TextBlock>("MetricValue").Text = $"{metric.Values[^1].ToString("0.0", CultureInfo.InvariantCulture)}{metric.Unit}";
        C<TextBlock>("PeakLabel").Text = model.PeakVisible ? $"Peak {peakValue.ToString("0.0", CultureInfo.InvariantCulture)}{metric.Unit}" : "Latest sample";
        C<TextBlock>("AxisStart").Text = Stamp(model.ChartStart);
        C<TextBlock>("AxisEnd").Text = $"{Stamp(model.Data.End)} UTC";
        C<Button>("JumpButton").Visibility = peak.Visibility = AsVisibility(model.PeakVisible);
        C<TextBlock>("NoPeak").Visibility = AsVisibility(!model.PeakVisible);
        var width = timeline.ActualWidth;
        var height = timeline.Height;
        if (width < 1 || points.Count == 0) return;
        double X(TimeOnly time) => 3 + (width - 6) * (time - model.ChartStart).TotalMinutes / model.RangeMinutes;
        double Y(double value) => height - 4 - (height - 14) * value / topValue;
        var grid = new PathGeometry();
        foreach (var value in new[] { 0d, topValue / 3, 2 * topValue / 3, topValue })
        {
            var y = Y(value);
            var line = new PathFigure { StartPoint = new Point(0, y) };
            line.Segments.Add(new LineSegment { Point = new Point(width, y) });
            grid.Figures.Add(line);
        }
        C<XamlPath>("TimelineGrid").Data = grid;
        var trace = new PathGeometry();
        var figure = new PathFigure { StartPoint = new Point(X(points[0].Time), Y(points[0].Value)) };
        foreach (var point in points.Skip(1)) figure.Segments.Add(new LineSegment { Point = new Point(X(point.Time), Y(point.Value)) });
        trace.Figures.Add(figure);
        C<XamlPath>("TimelineLine").Data = trace;
        Canvas.SetLeft(peak, Math.Clamp(X(metric.PeakTime) - peak.Width / 2, 0, Math.Max(0, width - peak.Width)));
        Canvas.SetTop(peak, Math.Clamp(Y(peakValue) - peak.Height / 2, 0, height - peak.Height));
    }

    private void UpdateCaptionColors()
    {
        var title = AppWindow.TitleBar;
        var highContrast = new Windows.UI.ViewManagement.AccessibilitySettings().HighContrast;
        Color? background = highContrast ? null : Color.FromArgb(255, 21, 24, 24);
        title.ButtonBackgroundColor = background;
        title.ButtonInactiveBackgroundColor = background;
        title.ButtonForegroundColor = highContrast ? null : Color.FromArgb(255, 237, 241, 237);
        title.ButtonInactiveForegroundColor = highContrast ? null : Color.FromArgb(255, 165, 175, 170);
    }
}
