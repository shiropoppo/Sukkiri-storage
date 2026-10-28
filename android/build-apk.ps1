# すっきり容量整理（Android）の APK を作る
#   pwsh android/build-apk.ps1            … 配布用（release）
#   pwsh android/build-apk.ps1 -Test      … テストだけ
# プロジェクトの場所に日本語が含まれ、OneDrive で同期もされているため、
# 英数字だけの作業用フォルダに写してからビルドし、できた APK だけを dist に戻す。
param([switch]$Test)
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$base = Join-Path $env:LOCALAPPDATA 'SukkiriBuild'
$work = Join-Path $base 'work'
$env:JAVA_HOME = Join-Path $base 'jdk21'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

if (-not (Test-Path (Join-Path $src 'keystore\keystore.properties'))) {
    throw 'android/keystore/keystore.properties がありません（署名鍵が必要です）'
}

# 作業用フォルダへ写す（ビルドの途中でできるものは写さない）
robocopy $src $work /MIR /XD build .gradle .idea dist /XF local.properties /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "ファイルの写しに失敗しました（robocopy $LASTEXITCODE）" }
Set-Content -Path (Join-Path $work 'local.properties') -Value ("sdk.dir=" + ($env:ANDROID_HOME -replace '\\', '\\\\')) -Encoding ASCII

Push-Location $work
try {
    if ($Test) {
        & .\gradlew.bat --no-daemon testDebugUnitTest
        if ($LASTEXITCODE) { throw 'テストに失敗しました' }
        return
    }
    & .\gradlew.bat --no-daemon testDebugUnitTest assembleRelease
    if ($LASTEXITCODE) { throw 'ビルドに失敗しました' }
} finally {
    Pop-Location
}

$apk = Join-Path $work 'app\build\outputs\apk\release\app-release.apk'
$dist = Join-Path $src 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist 'sukkiri-yoryo.apk'
Copy-Item $apk $out -Force
Write-Output ("APK: {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
