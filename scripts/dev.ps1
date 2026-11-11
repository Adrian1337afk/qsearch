# Developer loop: apply the qsearch files to the source tree, rebuild, and
# start a test browser.
#
#   .\scripts\dev.ps1            # keep the test profile
#   .\scripts\dev.ps1 -Fresh     # start with an empty profile (first run)
#   .\scripts\dev.ps1 -NoBuild   # only restart the browser
#   .\scripts\dev.ps1 -Test      # start with Marionette so scripts\qtest.py
#                                # can drive it (address bar turns red)
param(
    [switch]$Fresh,
    [switch]$NoBuild,
    [switch]$Test,
    [string]$Profile = 'D:\qsearch-build\test-profile2'
)

$root = Split-Path $PSScriptRoot -Parent
$build = 'D:\qsearch-build'

function Stop-TestBrowser {
    # Wait until every qsearch process from the build folder is really gone:
    # the linker cannot replace qsearch.exe while one is alive.
    for ($i = 0; $i -lt 10; $i++) {
        $running = Get-Process qsearch -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -like "$build\*" }
        if (-not $running) { return }
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Stop-TestBrowser

if (-not $NoBuild) {
    & "$build\venv\Scripts\python.exe" "$root\scripts\apply.py" "$build\firefox" "$build\upstream\lw-settings" |
        Select-Object -Last 1
    $env:MACH_HIDE_DEV_DRIVE_SUGGESTION = '1'
    foreach ($attempt in 1, 2) {
        & "$root\scripts\mach.ps1" build *> "$build\build-dev.log"
        if ($LASTEXITCODE -eq 0) { break }
        # Most common failure: the browser was opened again during the build.
        Stop-TestBrowser
    }
    "build exit=$LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { Get-Content "$build\build-dev.log" -Tail 30; exit 1 }
}

if ($Fresh -and (Test-Path $Profile)) { Remove-Item $Profile -Recurse -Force }
New-Item -ItemType Directory -Force $Profile | Out-Null

$browserArgs = @('-profile', $Profile, '-no-remote')
if ($Test) { $browserArgs += '-marionette', '-remote-allow-system-access' }
Start-Process "$build\obj-qsearch\dist\bin\qsearch.exe" -ArgumentList $browserArgs

if ($Test) {
    $t = 0
    do {
        Start-Sleep -Seconds 2; $t += 2
        $ok = Test-NetConnection 127.0.0.1 -Port 2828 -WarningAction SilentlyContinue -InformationLevel Quiet
    } while (-not $ok -and $t -lt 60)
    Start-Sleep -Seconds 8
    "browser ready=$ok"
}
