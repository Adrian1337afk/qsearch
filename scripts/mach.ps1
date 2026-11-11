# Run Mozilla's `mach` inside the MozillaBuild environment.
#
#   .\scripts\mach.ps1 build
#   .\scripts\mach.ps1 run
#   .\scripts\mach.ps1 package
#
# Source tree defaults to D:\qsearch-build\firefox; override with $env:QSEARCH_SRC.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$MachArgs)

$src = if ($env:QSEARCH_SRC) { $env:QSEARCH_SRC } else { 'D:\qsearch-build\firefox' }

$env:MOZILLABUILD = 'C:\mozilla-build\'
$env:MSYSTEM = 'MSYS'
$env:MSYS2_PATH_TYPE = 'inherit'
$env:CHERE_INVOKING = '1'
$env:INCLUDE = ''
$env:LIB = ''

Set-Location $src
& 'C:\mozilla-build\msys2\usr\bin\bash.exe' -lc "./mach $($MachArgs -join ' ')"
exit $LASTEXITCODE
