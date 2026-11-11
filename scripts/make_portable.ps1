# Build a portable qsearch zip from a finished `mach package`.
#
#   .\scripts\make_portable.ps1
#
# The zip contains the browser plus a launcher that keeps the profile in a
# "profile" folder next to it, so it runs from a USB stick and leaves nothing
# on the PC.
$dist = if ($env:QSEARCH_OBJ) { "$env:QSEARCH_OBJ\dist" } else { 'D:\qsearch-build\obj-qsearch\dist' }
$zip = Get-ChildItem $dist -Filter 'qsearch-*.win64.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw "No qsearch-*.win64.zip in $dist. Run 'mach package' first." }

$work = Join-Path $dist 'portable'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory $work | Out-Null
Expand-Archive $zip.FullName -DestinationPath $work

@'
@echo off
rem qsearch portable: the profile lives next to this file.
if not exist "%~dp0profile" mkdir "%~dp0profile"
start "" "%~dp0qsearch\qsearch.exe" -profile "%~dp0profile" -no-remote %*
'@ | Set-Content (Join-Path $work 'qsearch-portable.bat') -Encoding ascii

$out = Join-Path $dist ($zip.BaseName + '.portable.zip')
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $work '*') -DestinationPath $out
Remove-Item $work -Recurse -Force
"portable build: $out"
