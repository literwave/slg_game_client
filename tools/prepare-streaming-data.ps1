param([switch]$Check, [string]$RuntimePath)
$ErrorActionPreference = 'Stop'
if (-not $RuntimePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $RuntimePath = $nodeCommand.Source }
    else { $RuntimePath = Get-Process CocosCreator -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path }
}
if (-not $RuntimePath) { throw 'Node.js or a running Cocos Creator is required. You may also specify -RuntimePath.' }
$scriptPath = Join-Path $PSScriptRoot 'prepare-streaming-data.cjs'
$outputFile = [System.IO.Path]::GetTempFileName()
$errorFile = [System.IO.Path]::GetTempFileName()
$previousNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $arguments = @('"' + $scriptPath + '"')
    if ($Check) { $arguments += '--check' }
    $process = Start-Process -FilePath $RuntimePath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru `
        -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
    Get-Content -LiteralPath $outputFile -Encoding UTF8 | Write-Host
    if ($process.ExitCode -ne 0) { throw ([System.IO.File]::ReadAllText($errorFile)) }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousNodeMode
    Remove-Item -LiteralPath $outputFile,$errorFile -Force
}
