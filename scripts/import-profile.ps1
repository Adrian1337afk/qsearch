# Copy a Firefox, Waterfox or LibreWolf profile into a separate qsearch profile.
[CmdletBinding()]
param(
    [string]$Source,
    [string]$BrowserExe = 'D:\qsearch-build\obj-qsearch\dist\bin\qsearch.exe',
    [string]$DestinationRoot = (Join-Path $env:APPDATA 'qsearch\Imported Profiles'),
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
if (-not $NoLaunch) {
    $BrowserExe = (Get-Item -LiteralPath $BrowserExe).FullName
}

if (-not $Source) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    try {
        $picker.Description = 'Close the source browser, then select its profile folder. Find it under Profile Folder in about:support.'
        $picker.ShowNewFolderButton = $false
        if ($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
        $Source = $picker.SelectedPath
    } finally {
        $picker.Dispose()
    }
}

$profile = Get-Item -LiteralPath $Source
if (-not $profile.PSIsContainer -or
    ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    -not (Test-Path -LiteralPath (Join-Path $profile.FullName 'prefs.js') -PathType Leaf)) {
    throw 'Choose the browser profile folder that contains prefs.js.'
}

$root = [IO.Path]::GetFullPath($DestinationRoot)
$sourcePrefix = $profile.FullName.TrimEnd('\') + '\'
if (($root.TrimEnd('\') + '\').StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a destination outside the source profile.'
}
foreach ($path in @($profile.FullName, $root)) {
    for ($ancestor = [IO.DirectoryInfo]::new($path); $ancestor; $ancestor = $ancestor.Parent) {
        if ($ancestor.Exists -and ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Choose a path outside symbolic links and junctions: $($ancestor.FullName)"
        }
    }
}
$excluded = @(
    'parent.lock', '.parentlock', 'lock', 'compatibility.ini',
    'cache2', 'startupCache', 'shader-cache', 'crashes', 'minidumps'
)

function Copy-ProfileContents($from, $to, [switch]$TopLevel) {
    foreach ($entry in Get-ChildItem -LiteralPath $from -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($TopLevel -and $entry.Name -in $excluded) { continue }
        $target = Join-Path $to $entry.Name
        if ($entry.PSIsContainer) {
            [IO.Directory]::CreateDirectory($target) | Out-Null
            Copy-ProfileContents $entry.FullName $target
        } else {
            Copy-Item -LiteralPath $entry.FullName -Destination $target -Force
        }
    }
}

$name = 'Imported-{0}-{1}' -f $profile.Name, [guid]::NewGuid().ToString('N')
$staging = Join-Path $root ('.incomplete-' + $name)
$destination = Join-Path $root $name
$lockPath = Join-Path $profile.FullName 'parent.lock'
$profileLock = $null
if (Test-Path -LiteralPath $lockPath) {
    try {
        $profileLock = [IO.File]::Open($lockPath, 'Open', 'Read', 'None')
    } catch {
        throw 'Could not lock the source profile for copying. Close the source browser and try again.'
    }
}
try {
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    Copy-ProfileContents $profile.FullName $staging -TopLevel
    [IO.Directory]::Move($staging, $destination)
} catch {
    throw "Profile import failed. Incomplete copy: $staging. $($_.Exception.Message)"
} finally {
    if ($profileLock) { $profileLock.Dispose() }
}

Write-Output $destination
if (-not $NoLaunch) {
    Start-Process -FilePath $BrowserExe -ArgumentList "-no-remote -profile `"$destination`""
}
