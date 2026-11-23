#Requires -Version 7.0
# Usage: pwsh -File scripts/package-windows.ps1 VERSION SOURCE_SHA
# Produces an unsigned Velopack installer on a native Windows host.
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string]$Version,
    [Parameter(Mandatory, Position = 1)][string]$SourceSha
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Installer packaging requires native Windows; cross-compiled builds are not release payloads.' }
if ($Version -cnotmatch '^0\.1\.[1-9][0-9]{0,9}\z') { throw 'Expected a canonical Windows version 0.1.N.' }
if ([long]($Version.Split('.')[-1]) -gt 65534) { throw 'Windows version exceeds the supported assembly version range.' }
$root = Split-Path $PSScriptRoot -Parent
function Assert-Source {
    $head = & git -C $root rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $SourceSha -cnotmatch '^[a-f0-9]{40}\z' -or $SourceSha -cne $head) {
        throw 'Expected source SHA to match Git HEAD.'
    }
    $dirty = & git -C $root status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Release packaging requires a clean committed checkout.' }
}
function Assert-VelopackOutput([string]$Directory, [string]$Version) {
    $installer = 'LogsWindows-win-x64-Setup.exe'
    $package = "LogsWindows-$Version-win-x64-full.nupkg"
    $feed = 'releases.win-x64.json'
    foreach ($name in @($installer, $package, $feed)) {
        $file = Join-Path $Directory $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -le 0) {
            throw "Missing Velopack release output: $name"
        }
    }
    $entries = @((Get-Content -Raw -LiteralPath (Join-Path $Directory $feed) | ConvertFrom-Json).Assets)
    $full = Get-Item -LiteralPath (Join-Path $Directory $package)
    if ($entries.Count -ne 1 -or $entries[0].Type -cne 'Full' -or $entries[0].PackageId -cne 'LogsWindows' -or
        $entries[0].Version -cne $Version -or $entries[0].FileName -cne $package -or $entries[0].Size -ne $full.Length -or
        $entries[0].SHA256 -ne (Get-FileHash -LiteralPath $full.FullName -Algorithm SHA256).Hash -or
        $entries[0].SHA1 -ne (Get-FileHash -LiteralPath $full.FullName -Algorithm SHA1).Hash) {
        throw 'Native Velopack feed does not match the full package.'
    }
    $installer, $package, $feed
}
Assert-Source
$dist = Join-Path $root 'dist'
$output = Join-Path $dist 'windows'
if (Test-Path -LiteralPath $output) { throw 'dist/windows already exists; use a clean artifact destination.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('logs-package-' + [Guid]::NewGuid().ToString('N'))
$publish = Join-Path $work 'publish'
$releases = Join-Path $work 'releases'
$tools = Join-Path $work 'tools'
$project = Join-Path $root 'apps/windows/Logs.App/Logs.App.csproj'
$stage = Join-Path $dist ('.windows-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    & dotnet publish $project -c Release -r win-x64 --self-contained true -o $publish `
        '-p:WindowsAppSDKSelfContained=true' '-p:ContinuousIntegrationBuild=true' `
        "-p:Version=$Version" "-p:InformationalVersion=$Version+$SourceSha" '-p:IncludeSourceRevisionInInformationalVersion=false'
    if ($LASTEXITCODE -ne 0) { throw 'Native Windows publish failed.' }
    foreach ($name in @('Logs.exe', 'Logs.dll', 'resources.pri', 'coreclr.dll', 'hostfxr.dll', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll')) {
        $file = Join-Path $publish $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -le 0) {
            throw "Incomplete self-contained Windows publish: $name"
        }
    }
    $productVersion = (Get-Item -LiteralPath (Join-Path $publish 'Logs.exe')).VersionInfo.ProductVersion
    if ($productVersion -cne "$Version+$SourceSha") { throw 'Published executable version/source does not match the requested build.' }
    & dotnet tool install vpk --version 1.2.161 --tool-path $tools
    if ($LASTEXITCODE -ne 0) { throw 'Pinned Velopack CLI 1.2.161 installation failed.' }
    $pack = @('pack', '--packId', 'LogsWindows', '--packVersion', $Version, '--packDir', $publish,
        '--mainExe', 'Logs.exe', '--packTitle', 'Logs', '--packAuthors', 'Everyone Software',
        '--runtime', 'win-x64', '--channel', 'win-x64', '--framework', 'vcredist143-x64', '--noPortable', '--delta', 'None',
        '--shortcuts', 'StartMenuRoot', '--outputDir', $releases, '--noDefaultExclude', '--exclude', '(?!)', '--yes', '--skip-updates')
    & (Join-Path $tools 'vpk.exe') @pack
    if ($LASTEXITCODE -ne 0) { throw 'Velopack packaging failed.' }
    $payload = Assert-VelopackOutput $releases $Version
    Assert-Source
    New-Item -ItemType Directory -Path $dist -Force | Out-Null
    New-Item -ItemType Directory -Path $stage | Out-Null
    foreach ($name in $payload) {
        Copy-Item -LiteralPath (Join-Path $releases $name) -Destination $stage
    }
    [IO.Directory]::Move($stage, $output)
    Write-Host "Unsigned Windows installer, full package and feed staged in $output."
}
finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    Remove-Item -LiteralPath $work -Recurse -Force
}
