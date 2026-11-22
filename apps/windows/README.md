# Signal for Windows

Native WinUI 3 implementation of the Logs-first investigation layout in `mockups/Signal.html`. It embeds `contracts/sample.json` and runs offline. The chart shows the one metric the shared fixture defines; the app has no live telemetry, authentication, installer, or update feed. Settings shows the assembly version and that updates are unavailable. Startup handles Velopack lifecycle arguments without automatically applying updates.

## Build and run on Windows x64

Use the .NET 10 SDK and Windows SDK build tools. From the repository root in PowerShell:

```powershell
dotnet run --project apps/windows/Signal.Tests -c Release
dotnet publish apps/windows/Signal.App/Signal.App.csproj -c Release -o apps/windows/artifacts/publish
Test-Path apps/windows/artifacts/publish/resources.pri
& ./apps/windows/artifacts/publish/Signal.exe
```

The default native publish is unpackaged and self-contained. Keep the complete publish directory together. Do not use the Linux compile overrides below for anything you intend to launch or distribute.

### Windows smoke checklist

- Launch; verify the dark native title bar, visible sample label, 15 newest-first events, and the HTTP error-rate trace. Drag, maximize/restore, and resize until the two panes stack. Check an elevated display scaling and a Windows contrast theme.
- Focus search with `/`. Search `req-74a2` (5 events); combine it with Music and Errors (3 events). Search for a nonexistent term, then reset. Check that switching ranges while scoped clears the metric scope.
- Activate the peak marker or its labeled action. Verify Music is selected and the seven events in 14:30–14:35 UTC appear. Clear the window; Music stays selected. At 10 minutes, jump again and verify the range expands to 30 minutes and all seven events are visible.
- Open a log row by pointer and keyboard, check source and request ID, and close with Escape and the close button. Verify focus returns to the row and filtering away a selected row clears its detail. Open Settings and return without losing the investigation.

## Linux compile and logic checks

```sh
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 # only needed if ICU is unavailable
dotnet run --project apps/windows/Signal.Tests -c Release
dotnet build apps/windows/Signal.App/Signal.App.csproj -c Release \
  -p:OutputType=Library -p:WindowsAppSDKSelfContained=false \
  -p:PrepareForRunDependsOn=CopyFilesToOutputDirectory
```

The test runner exercises the shipped investigation logic on the shared fixture and checks native XAML names against typed C# lookups. The Linux build uses real WinUI references and produces a Windows-targeted managed DLL. Neither check runs the XAML loader or proves native rendering, input, or Windows publish.
