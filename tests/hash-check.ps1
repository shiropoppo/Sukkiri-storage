# 検証用: 指定フォルダ内の全ファイルについて MD5（Windows 標準）と QuickXorHash（Microsoft 公開実装）を JSON で出力する。
# 使い方: pwsh tests/hash-check.ps1 <フォルダ>
param([Parameter(Mandatory)][string]$Dir)

Add-Type -Path (Join-Path $PSScriptRoot 'QuickXorHashReference.cs')

$result = [ordered]@{}
foreach ($f in Get-ChildItem -LiteralPath $Dir -File | Sort-Object Name) {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    # 実装の分割処理も確かめるため、わざと半端な大きさに区切って入れる
    $q = [QuickXorHashReference]::new()
    $off = 0
    $step = 1000003
    while ($off -lt $bytes.Length) {
        $n = [Math]::Min($step, $bytes.Length - $off)
        [void]$q.TransformBlock($bytes, $off, $n, $null, 0)
        $off += $n
    }
    [void]$q.TransformFinalBlock([byte[]]::new(0), 0, 0)
    $result[$f.Name] = [ordered]@{
        md5 = (Get-FileHash -LiteralPath $f.FullName -Algorithm MD5).Hash.ToLower()
        qxh = [Convert]::ToBase64String($q.Hash)
    }
}
$result | ConvertTo-Json -Compress
