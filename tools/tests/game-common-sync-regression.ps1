$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('slg-common-sync-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $fixture 'external/game_common'
$oldSync = $env:GAME_COMMON_SYNC
$utf8 = New-Object System.Text.UTF8Encoding $false
function Write-Fixture([string]$relative, [string]$content) {
    $file = Join-Path $fixture $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $content, $utf8)
}
function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}
try {
    Write-Fixture 'tools/sync-game-common.ps1' ([IO.File]::ReadAllText((Join-Path $project 'tools/sync-game-common.ps1')))
    $table = '[{"Id":4,"Name":"Move"}]'
    $enum = 'export enum TargetTypeEnum { MOVE = 4 }'
    Write-Fixture 'external/game_common/client/res/TargetType.json' $table
    Write-Fixture 'external/game_common/client/enum/TargetTypeEnum.ts' $enum
    Write-Fixture 'external/game_common/client/net_pb.json' '{"define":{}}'
    Write-Fixture 'external/game_common/proto/test.proto' 'syntax = "proto3";'
    git -C $source init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'fixture git init failed' }
    git -C $source add .
    git -C $source -c user.name=SyncTest -c user.email=sync-test@example.invalid -c core.hooksPath=disabled-hooks commit --quiet -m fixture
    if ($LASTEXITCODE -ne 0) { throw 'fixture commit failed' }
    Write-Fixture 'assets/resources/config/TargetType.json.meta' '{"uuid":"keep-config-uuid"}'
    Write-Fixture 'assets/resources/config/TargetTypeEnum.json' $table
    Write-Fixture 'assets/resources/config/TargetTypeEnum.json.meta' '{"uuid":"old-alias"}'
    Write-Fixture 'assets/resources/config/mapRes_0.json' '{"localMap":true}'
    Write-Fixture 'assets/scripts/config/enum/TargetTypeEnum.ts.meta' '{"uuid":"keep-enum-uuid"}'
    $script = Join-Path $fixture 'tools/sync-game-common.ps1'
    $env:GAME_COMMON_SYNC = '1'
    & $script -CopyOnly
    Assert-True ($env:GAME_COMMON_SYNC -eq '1') 'hook recursion guard was not restored'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixture 'assets/scripts/config/enum/TargetTypeEnum.ts')) -eq $enum) 'TypeScript enum was not copied'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixture 'assets/resources/config/TargetType.json')) -eq $table) 'table was not copied'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixture 'assets/resources/config/TargetTypeEnum.json'))) 'old identical alias remained'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixture 'assets/resources/config/TargetTypeEnum.json.meta'))) 'old alias metadata remained'
    $env:GAME_COMMON_SYNC = $null
    & $script -CopyOnly
    Assert-True (-not $env:GAME_COMMON_SYNC) 'sync disabled future checkout hooks'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixture 'assets/resources/config/TargetType.json.meta')) -eq '{"uuid":"keep-config-uuid"}') 'config UUID changed'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixture 'assets/scripts/config/enum/TargetTypeEnum.ts.meta')) -eq '{"uuid":"keep-enum-uuid"}') 'enum UUID changed'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixture 'assets/resources/config/mapRes_0.json')) -eq '{"localMap":true}') 'local map config was changed'
    Write-Fixture 'assets/resources/config/TargetTypeEnum.json' '[{"localEdit":true}]'
    & $script -CopyOnly
    Assert-True (Test-Path -LiteralPath (Join-Path $fixture 'assets/resources/config/TargetTypeEnum.json')) 'locally edited alias was deleted'
    git -C $source rm --quiet -- client/enum/TargetTypeEnum.ts
    if ($LASTEXITCODE -ne 0) { throw 'fixture legacy revision failed' }
    & $script -CopyOnly
    Assert-True (Test-Path -LiteralPath (Join-Path $fixture 'assets/scripts/config/enum/TargetTypeEnum.ts')) 'older common revision broke existing enum assets'
    Write-Output 'PASS: enum sync, repeatability, UUID preservation, legacy cleanup, local-table safety, environment restoration, older revisions'
} finally {
    $env:GAME_COMMON_SYNC = $oldSync
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('slg-common-sync-')) {
        throw 'Unsafe fixture cleanup path'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
