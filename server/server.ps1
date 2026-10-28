#Requires -Version 5.1
# すっきり容量整理 - Windows 用のローカルサーバー
#  ・app フォルダの画面を http://localhost:8765/ で表示する
#  ・画面からの依頼で、フォルダの一覧作成 / ファイルの読み出し / ゴミ箱への移動 を行う
#  ・クラウドと同期しているフォルダ（OneDrive など）は、消すとクラウドからも消えるため絶対に扱わない
#  ・画面が閉じられてしばらく通信がなければ自動で終了する
param(
    [int]$Port = 8765,
    [int]$IdleMinutes = 5,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$ToolRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $ToolRoot 'app'
$Origin = "http://localhost:$Port"
$Token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$StateDir = Join-Path $env:LOCALAPPDATA 'SukkiriYoryo'
$null = New-Item -ItemType Directory -Force -Path $StateDir

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web
Add-Type -AssemblyName Microsoft.VisualBasic

function Write-Log([string]$msg) {
    try {
        $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
        [IO.File]::AppendAllText((Join-Path $StateDir 'server.log'), $line + "`r`n", [Text.UTF8Encoding]::new($false))
    } catch { }
}

function Show-Message([string]$text) {
    [void][System.Windows.Forms.MessageBox]::Show($text, 'すっきり容量整理', 'OK', 'Information')
}

# ---------- 既に起動中なら、その画面を開くだけ ----------
try {
    $hello = Invoke-WebRequest -Uri "$Origin/api/hello" -UseBasicParsing -TimeoutSec 2
    if ($hello.Content -match '"app":"sukkiri"') {
        if (-not $NoBrowser) { Start-Process "$Origin/" }
        exit 0
    }
} catch { }

if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'index.html'))) {
    Show-Message "画面のファイルが見つかりません。`nZIP ファイルの場合は、先に「すべて展開」してから起動してください。"
    exit 1
}

# ---------- 記録（CSV）の保存先 ----------
function Get-LogDir {
    $dir = Join-Path $ToolRoot '記録'
    try {
        $null = New-Item -ItemType Directory -Force -Path $dir
        $probe = Join-Path $dir '.write-test'
        [IO.File]::WriteAllText($probe, 'ok')
        Remove-Item -LiteralPath $probe -Force
        return $dir
    } catch {
        $dir = Join-Path $StateDir '記録'
        $null = New-Item -ItemType Directory -Force -Path $dir
        return $dir
    }
}
$LogDir = Get-LogDir

function Add-CsvLine([string]$kind, [string[]]$header, [object[]]$values) {
    $file = Join-Path $LogDir ('{0}_{1:yyyyMMdd}.csv' -f $kind, (Get-Date))
    $quote = { param($v) '"' + ([string]$v).Replace('"', '""') + '"' }
    if (-not (Test-Path -LiteralPath $file)) {
        # Excel で文字化けしないよう BOM 付き UTF-8 で作る
        [IO.File]::WriteAllText($file, (($header | ForEach-Object { & $quote $_ }) -join ',') + "`r`n", [Text.UTF8Encoding]::new($true))
    }
    [IO.File]::AppendAllText($file, (($values | ForEach-Object { & $quote $_ }) -join ',') + "`r`n", [Text.UTF8Encoding]::new($false))
}

# ---------- クラウド同期フォルダの検出 ----------
# 同期フォルダの中身を消すと、同期アプリがクラウド側の同じファイルも消してしまう。
# 複数の方法で見つけ出し、該当する場所は選べないようにする。

function Get-NormalPath([string]$p) {
    if (-not $p) { return $null }
    try { $full = [IO.Path]::GetFullPath($p) } catch { return $null }
    # "C:\" はそのまま（"C:" にすると別の意味になる）
    if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
    return $full
}

function Get-SyncRoots {
    $roots = New-Object System.Collections.Generic.List[object]
    $add = {
        param($p, $svc)
        $n = Get-NormalPath $p
        if ($n -and (Test-Path -LiteralPath $n)) { $roots.Add([pscustomobject]@{ Path = $n; Service = $svc }) }
    }

    foreach ($name in 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial') {
        & $add ([Environment]::GetEnvironmentVariable($name)) 'OneDrive'
    }
    Get-ChildItem 'HKCU:\Software\Microsoft\OneDrive\Accounts' -ErrorAction SilentlyContinue | ForEach-Object {
        $uf = (Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).UserFolder
        & $add $uf 'OneDrive'
    }

    # Windows に登録された同期ルート（OneDrive / Dropbox / iCloud / Box など）
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager' -ErrorAction SilentlyContinue | ForEach-Object {
        $svc = ($_.PSChildName -split '!')[0]
        $ur = Get-ItemProperty -LiteralPath (Join-Path $_.PSPath 'UserSyncRoots') -ErrorAction SilentlyContinue
        if ($ur) {
            foreach ($prop in $ur.PSObject.Properties) {
                if ($prop.Name -eq $sid) { & $add $prop.Value $svc }
            }
        }
    }

    foreach ($f in (Join-Path $env:APPDATA 'Dropbox\info.json'), (Join-Path $env:LOCALAPPDATA 'Dropbox\info.json')) {
        if (Test-Path -LiteralPath $f) {
            try {
                $j = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
                foreach ($prop in $j.PSObject.Properties) { & $add $prop.Value.path 'Dropbox' }
            } catch { }
        }
    }

    & $add (Join-Path $env:USERPROFILE 'iCloudDrive') 'iCloud'
    & $add (Join-Path $env:USERPROFILE 'Pictures\iCloud Photos') 'iCloud'
    & $add (Join-Path $env:USERPROFILE 'Box') 'Box'
    & $add (Join-Path $env:USERPROFILE 'Google Drive') 'Google ドライブ'
    & $add (Join-Path $env:USERPROFILE 'My Drive') 'Google ドライブ'
    return $roots
}

# Google ドライブ パソコン版がバックアップ・ミラー対象にしているフォルダの記録（中身を文字列として検索する）
function Get-DriveFsText {
    $base = Join-Path $env:LOCALAPPDATA 'Google\DriveFS'
    if (-not (Test-Path -LiteralPath $base)) { return '' }
    $sb = [Text.StringBuilder]::new()
    Get-ChildItem -LiteralPath $base -Recurse -Depth 2 -File -Filter 'root_preference_sqlite.db' -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $fs = [IO.File]::Open($_.FullName, 'Open', 'Read', 'ReadWrite, Delete')
            try {
                $ms = [IO.MemoryStream]::new()
                $fs.CopyTo($ms)
                [void]$sb.Append([Text.Encoding]::UTF8.GetString($ms.ToArray()).Replace('/', '\').ToLowerInvariant())
                [void]$sb.Append([Text.Encoding]::Unicode.GetString($ms.ToArray()).Replace('/', '\').ToLowerInvariant())
            } finally { $fs.Dispose() }
        } catch { }
    }
    return $sb.ToString()
}

$SyncNamePattern = '^(onedrive( - .*)?|dropbox( \(.*\))?|my drive|マイドライブ|shared drives|共有ドライブ|google ?drive|google ?ドライブ|icloud ?drive|icloud photos|icloud 写真|box)$'

function Test-DriveFsRoot([string]$path, [string]$text) {
    if (-not $text) { return $false }
    $p = $path.ToLowerInvariant()
    $i = $text.IndexOf($p, [StringComparison]::Ordinal)
    while ($i -ge 0) {
        $next = $i + $p.Length
        # 直後が "\" なら、さらに下のフォルダの記録なのでこのフォルダ自体ではない
        if ($next -ge $text.Length -or $text[$next] -ne '\') { return $true }
        $i = $text.IndexOf($p, $next, [StringComparison]::Ordinal)
    }
    return $false
}

function Get-SyncInfo([string]$path) {
    # 指定した場所が同期フォルダの中（またはそれ自体）なら、そのサービス名を返す
    $n = Get-NormalPath $path
    foreach ($r in $script:SyncRoots) {
        if ($n.Equals($r.Path, [StringComparison]::OrdinalIgnoreCase) -or
            $n.StartsWith($r.Path + '\', [StringComparison]::OrdinalIgnoreCase)) { return $r.Service }
    }
    $d = [IO.DirectoryInfo]::new($n)
    while ($d -and $d.Parent) {
        if ($d.Name -match $SyncNamePattern) { return $d.Name }
        if (Test-DriveFsRoot $d.FullName.TrimEnd('\') $script:DriveFsText) { return 'Google ドライブ' }
        $d = $d.Parent
    }
    try {
        $label = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($n)).VolumeLabel
        if ($label -match 'Google') { return 'Google ドライブ' }
    } catch { }
    return $null
}

function Test-ContainsSyncRoot([string]$dir) {
    # スキャン中のサブフォルダが同期フォルダなら丸ごと飛ばす
    foreach ($r in $script:SyncRoots) {
        if ($dir.Equals($r.Path, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    if ((Split-Path -Leaf $dir) -match $SyncNamePattern) { return $true }
    return (Test-DriveFsRoot $dir $script:DriveFsText)
}

function Get-FolderInfo([string]$path, [string]$key) {
    $n = Get-NormalPath $path
    $info = [ordered]@{ key = $key; path = $n; name = $null; exists = $false; blocked = $false; reason = $null; service = $null; recycle = $true }
    if (-not $n) { $info.blocked = $true; $info.reason = 'notfound'; return $info }
    $info.name = Split-Path -Leaf $n
    if (-not $info.name) { $info.name = $n }
    if (-not (Test-Path -LiteralPath $n -PathType Container)) { $info.blocked = $true; $info.reason = 'notfound'; return $info }
    $info.exists = $true
    $svc = Get-SyncInfo $n
    if ($svc) { $info.blocked = $true; $info.reason = 'synced'; $info.service = $svc; return $info }
    if ($n.StartsWith('\\')) { $info.blocked = $true; $info.reason = 'network'; return $info }
    try {
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($n))
        if ($drive.DriveType -eq 'Network') { $info.blocked = $true; $info.reason = 'network'; return $info }
        if ($drive.DriveType -ne 'Fixed') { $info.recycle = $false }
    } catch { }
    $attr = [int]([IO.DirectoryInfo]::new($n).Attributes)
    if ($attr -band $CloudAttrMask) { $info.blocked = $true; $info.reason = 'synced'; $info.service = 'クラウド'; return $info }
    return $info
}

# ---------- フォルダの一覧作成 ----------
$MediaExt = @{}
foreach ($e in 'jpg jpeg jpe png gif heic heif webp bmp tif tiff dng raw cr2 cr3 nef arw orf rw2 raf srw pef avif jxl'.Split(' ')) { $MediaExt[".$e"] = 'image' }
foreach ($e in 'mp4 mov m4v avi wmv mkv 3gp 3g2 mts m2ts mpg mpeg webm hevc vob flv'.Split(' ')) { $MediaExt[".$e"] = 'video' }

$SkipDirs = @{}
foreach ($d in 'AppData', '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)',
    'ProgramData', 'Recovery', 'PerfLogs', 'Config.Msi', 'node_modules') { $SkipDirs[$d] = $true }

# 0x400 再解析ポイント / 0x1000 オフライン / 0x40000・0x400000 クラウドから呼び出し / 0x80000・0x100000 ピン留め状態
$CloudAttrMask = 0x400 -bor 0x1000 -bor 0x40000 -bor 0x400000 -bor 0x80000 -bor 0x100000

$script:Files = New-Object System.Collections.Generic.List[string]
$script:SyncRoots = @()
$script:DriveFsText = ''
$script:ScanRoot = $null

function Get-UnixMs([datetime]$utc) { return [DateTimeOffset]::new($utc).ToUnixTimeMilliseconds() }

function Invoke-Scan([string[]]$roots) {
    $script:Files = New-Object System.Collections.Generic.List[string]
    $sb = [Text.StringBuilder]::new()
    [void]$sb.Append('{"items":[')
    $first = $true
    $skipSynced = 0
    $skipErrors = 0
    for ($ri = 0; $ri -lt $roots.Count; $ri++) {
    $root = $roots[$ri]
    $prefixLen = $root.TrimEnd('\').Length + 1
    # 画面で「どの場所のファイルか」が分かるよう、場所の名前を頭に付ける
    $label = Split-Path -Leaf $root
    if (-not $label) { $label = $root.TrimEnd('\') }
    $stack = New-Object System.Collections.Generic.Stack[System.IO.DirectoryInfo]
    $stack.Push([IO.DirectoryInfo]::new($root))
    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        try { $entries = $dir.GetFileSystemInfos() } catch { $skipErrors++; continue }
        foreach ($en in $entries) {
            $attr = [int]$en.Attributes
            if ($en -is [IO.DirectoryInfo]) {
                if ($attr -band $CloudAttrMask) { $skipSynced++; continue }
                if (($attr -band 0x2) -and ($attr -band 0x4)) { continue }
                if ($en.Name.StartsWith('.') -or $SkipDirs.ContainsKey($en.Name)) { continue }
                if (Test-ContainsSyncRoot $en.FullName) { $skipSynced++; continue }
                $stack.Push($en)
                continue
            }
            $kind = $MediaExt[$en.Extension.ToLowerInvariant()]
            if (-not $kind) { continue }
            if ($attr -band $CloudAttrMask) { $skipSynced++; continue }
            if ($attr -band 0x2) { continue }
            $id = $script:Files.Count
            $script:Files.Add($en.FullName)
            if (-not $first) { [void]$sb.Append(',') }
            $first = $false
            [void]$sb.Append('{"id":').Append($id)
            [void]$sb.Append(',"name":').Append([System.Web.HttpUtility]::JavaScriptStringEncode($en.Name, $true))
            [void]$sb.Append(',"rel":').Append([System.Web.HttpUtility]::JavaScriptStringEncode($label + '\' + $en.FullName.Substring($prefixLen), $true))
            [void]$sb.Append(',"root":').Append($ri)
            [void]$sb.Append(',"size":').Append($en.Length)
            [void]$sb.Append(',"mtime":').Append((Get-UnixMs $en.LastWriteTimeUtc))
            [void]$sb.Append(',"kind":"').Append($kind).Append('"}')
        }
    }
    }
    [void]$sb.Append('],"skippedSynced":').Append($skipSynced).Append(',"skippedErrors":').Append($skipErrors)
    [void]$sb.Append(',"roots":').Append((ConvertTo-Json -InputObject @($roots) -Compress))
    return $sb
}

# 選ばれた場所のうち、ほかの場所の中に含まれるものは重ねてしらべない
function Get-ScanRoots([string[]]$paths) {
    $accepted = New-Object System.Collections.Generic.List[string]
    foreach ($p in ($paths | Sort-Object Length)) {
        $inside = $false
        foreach ($r in $accepted) {
            if ($p.Equals($r, [StringComparison]::OrdinalIgnoreCase) -or
                $p.StartsWith($r.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { $inside = $true; break }
        }
        if (-not $inside) { $accepted.Add($p) }
    }
    return , $accepted.ToArray()
}

# 作業中はパソコンがスリープしないようにする（裏方が終わると自動で元に戻る）
Add-Type -Namespace SukkiriNative -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
function Set-KeepAwake([bool]$on) {
    if ($on) { [void][SukkiriNative.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) }
    else { [void][SukkiriNative.Power]::SetThreadExecutionState($ES_CONTINUOUS) }
}

function Get-FileById($id) {
    $i = 0
    if ($null -eq $id -or -not [int]::TryParse([string]$id, [ref]$i)) { return $null }
    if ($i -lt 0 -or $i -ge $script:Files.Count) { return $null }
    return $script:Files[$i]
}

# ---------- フォルダ選択ダイアログ ----------
function Show-FolderPicker([string]$title) {
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = [System.Drawing.Size]::new(1, 1)
    $owner.Opacity = 0
    $owner.Show()
    $owner.Activate()
    try {
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = $title
        $dlg.ShowNewFolderButton = $false
        $dlg.SelectedPath = [Environment]::GetFolderPath('MyPictures')
        if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath }
        return $null
    } finally { $owner.Close(); $owner.Dispose() }
}

function Get-CandidateFolders {
    $list = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    $downloads = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders' -ErrorAction SilentlyContinue).'{374DE290-123F-4565-9164-39C4925E467B}'
    if (-not $downloads) { $downloads = Join-Path $env:USERPROFILE 'Downloads' }
    $cands = @(
        @('pictures', [Environment]::GetFolderPath('MyPictures')),
        @('pictures_local', (Join-Path $env:USERPROFILE 'Pictures')),
        @('videos', [Environment]::GetFolderPath('MyVideos')),
        @('downloads', $downloads),
        @('desktop', [Environment]::GetFolderPath('Desktop'))
    )
    foreach ($c in $cands) {
        $n = Get-NormalPath $c[1]
        if (-not $n -or $seen.ContainsKey($n.ToLowerInvariant())) { continue }
        $seen[$n.ToLowerInvariant()] = $true
        $info = Get-FolderInfo $n $c[0]
        if ($info.exists) { $list.Add($info) }
    }
    return $list
}

# ---------- ゴミ箱へ移動 ----------
function Move-ToRecycleBin($body) {
    $p = Get-FileById $body.id
    if (-not $p) { return @{ ok = $false; reason = 'missing' } }
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return @{ ok = $false; reason = 'missing' } }
    $fi = [IO.FileInfo]::new($p)
    if ($fi.Length -ne [long]$body.size -or (Get-UnixMs $fi.LastWriteTimeUtc) -ne [long]$body.mtime) {
        return @{ ok = $false; reason = 'changed' }
    }
    if (([int]$fi.Attributes) -band $CloudAttrMask) { return @{ ok = $false; reason = 'synced' } }
    if (Get-SyncInfo $fi.DirectoryName) { return @{ ok = $false; reason = 'synced' } }
    # 他のアプリで開いているファイルは触らない（読み取り専用のファイルも残す）
    try {
        $s = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None')
        $s.Dispose()
    } catch { return @{ ok = $false; reason = 'in_use' } }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    if (Test-Path -LiteralPath $p) { return @{ ok = $false; reason = 'error' } }

    $log = $body.log
    Add-CsvLine '削除記録' @('日時', 'このパソコンでの場所', 'サイズ(バイト)', '同じ中身が残っている所', 'その場所', '照合方法', '扱い') @(
        (Get-Date).ToString('yyyy/MM/dd HH:mm:ss'), $p, $fi.Length, $log.cloud, $log.cloudPath, $log.check,
        $(if ((Get-FolderInfo $fi.DirectoryName '').recycle) { 'ゴミ箱へ移動' } else { '削除（このドライブはゴミ箱なし）' }))
    return @{ ok = $true }
}

# ---------- HTTP ----------
$Mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
    '.png' = 'image/png'; '.ico' = 'image/x-icon'
    '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.jpe' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'
    '.bmp' = 'image/bmp'; '.avif' = 'image/avif'; '.mp4' = 'video/mp4'; '.mov' = 'video/quicktime'; '.webm' = 'video/webm'
}

function Send-Bytes($ctx, [int]$status, [string]$type, [byte[]]$bytes) {
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers['Cache-Control'] = 'no-store'
    $res.Headers['X-Content-Type-Options'] = 'nosniff'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-Json($ctx, $obj, [int]$status = 200) {
    if ($obj -is [string]) { $json = $obj } else { $json = ConvertTo-Json -InputObject $obj -Compress -Depth 6 }
    Send-Bytes $ctx $status 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
}

function Read-Body($req) {
    $sr = [IO.StreamReader]::new($req.InputStream, [Text.Encoding]::UTF8)
    try { $text = $sr.ReadToEnd() } finally { $sr.Dispose() }
    if ($text) { return ConvertFrom-Json $text }
    return [pscustomobject]@{}
}

function Send-File($ctx, [string]$path) {
    $req = $ctx.Request
    $res = $ctx.Response
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        $len = $fs.Length
        $start = [long]0
        $end = $len - 1
        $range = $req.Headers['Range']
        if ($range -and $range -match '^bytes=(\d+)-(\d*)$') {
            $start = [long]$Matches[1]
            if ($Matches[2]) { $end = [Math]::Min([long]$Matches[2], $len - 1) }
            if ($start -gt $end) {
                $res.StatusCode = 416
                $res.Headers['Content-Range'] = "bytes */$len"
                return
            }
            $res.StatusCode = 206
            $res.Headers['Content-Range'] = "bytes $start-$end/$len"
        } else {
            $res.StatusCode = 200
        }
        $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
        $type = $Mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $res.ContentType = $type
        $res.Headers['Cache-Control'] = 'no-store'
        $res.Headers['Accept-Ranges'] = 'bytes'
        $remain = $end - $start + 1
        $res.ContentLength64 = $remain
        $fs.Position = $start
        $buf = New-Object byte[] (1MB)
        while ($remain -gt 0) {
            $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $remain))
            if ($n -le 0) { break }
            $res.OutputStream.Write($buf, 0, $n)
            $remain -= $n
        }
    } finally { $fs.Dispose() }
}

function Send-Static($ctx) {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if (-not $rel) { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $AppDir $rel))
    if (-not $full.StartsWith($AppDir + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Bytes $ctx 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('not found'))
        return
    }
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = $Mime[$ext]
    if (-not $type) { $type = 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($full)
    if ($ext -eq '.html') {
        # 画面にだけ合言葉を埋め込む（他のサイトからこのサーバーを操作されないようにするため）
        $html = [Text.Encoding]::UTF8.GetString($bytes).Replace('<meta name="local-token" content="">', "<meta name=`"local-token`" content=`"$Token`">")
        $bytes = [Text.Encoding]::UTF8.GetBytes($html)
    }
    Send-Bytes $ctx 200 $type $bytes
}

function Invoke-Api($ctx, [string]$path) {
    $req = $ctx.Request
    switch ($path) {
        '/api/heartbeat' { Send-Json $ctx @{ ok = $true }; return }
        '/api/info' {
            Send-Json $ctx @{ computer = $env:COMPUTERNAME; logDir = $LogDir }
            return
        }
        '/api/folders' {
            $script:SyncRoots = Get-SyncRoots
            $script:DriveFsText = Get-DriveFsText
            Send-Json $ctx @{ folders = @(Get-CandidateFolders) }
            return
        }
        '/api/folder/pick' {
            $body = Read-Body $req
            $picked = Show-FolderPicker ([string]$body.title)
            if (-not $picked) { Send-Json $ctx @{ cancelled = $true }; return }
            $script:SyncRoots = Get-SyncRoots
            $script:DriveFsText = Get-DriveFsText
            Send-Json $ctx @{ folder = (Get-FolderInfo $picked 'picked') }
            return
        }
        '/api/scan' {
            $body = Read-Body $req
            $script:SyncRoots = Get-SyncRoots
            $script:DriveFsText = Get-DriveFsText
            $paths = @()
            if ($body.paths) { $paths = @($body.paths) } elseif ($body.path) { $paths = @([string]$body.path) }
            $ok = New-Object System.Collections.Generic.List[string]
            $blocked = New-Object System.Collections.Generic.List[object]
            foreach ($p in $paths) {
                $info = Get-FolderInfo ([string]$p) 'scan'
                if ($info.blocked) { $blocked.Add($info) } else { $ok.Add($info.path) }
            }
            if ($ok.Count -eq 0) {
                Send-Json $ctx @{ folder = $(if ($blocked.Count) { $blocked[0] } else { $null }); blocked = $blocked.ToArray() }
                return
            }
            $sb = Invoke-Scan (Get-ScanRoots $ok.ToArray())
            # 空のリストを ConvertTo-Json に渡すとエラーになるため、空のときは自分で書く
            $blockedJson = '[]'
            if ($blocked.Count) { $blockedJson = ConvertTo-Json -InputObject $blocked.ToArray() -Compress -Depth 4 }
            [void]$sb.Append(',"blocked":').Append($blockedJson).Append('}')
            Send-Json $ctx $sb.ToString()
            return
        }
        '/api/keepawake' {
            $body = Read-Body $req
            Set-KeepAwake ([bool]$body.on)
            Send-Json $ctx @{ ok = $true }
            return
        }
        '/api/file' {
            $p = Get-FileById $req.QueryString['id']
            if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) {
                Send-Bytes $ctx 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('not found'))
                return
            }
            Send-File $ctx $p
            return
        }
        '/api/stat' {
            $body = Read-Body $req
            $p = Get-FileById $body.id
            if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { Send-Json $ctx @{ exists = $false }; return }
            $fi = [IO.FileInfo]::new($p)
            Send-Json $ctx @{ exists = $true; size = $fi.Length; mtime = (Get-UnixMs $fi.LastWriteTimeUtc) }
            return
        }
        '/api/recycle' {
            $body = Read-Body $req
            $result = Move-ToRecycleBin $body
            Write-Log ("recycle id={0} ok={1} reason={2}" -f $body.id, $result.ok, $result.reason)
            Send-Json $ctx $result
            return
        }
        '/api/log-upload' {
            $body = Read-Body $req
            $p = Get-FileById $body.id
            Add-CsvLine '保存記録' @('日時', 'このパソコンでの場所', 'サイズ(バイト)', '保存先クラウド', 'クラウドでの場所') @(
                (Get-Date).ToString('yyyy/MM/dd HH:mm:ss'), $p, $body.size, $body.cloud, $body.cloudPath)
            Send-Json $ctx @{ ok = $true }
            return
        }
        '/api/open' {
            $body = Read-Body $req
            if ($body.what -eq 'recycle') { Start-Process explorer.exe 'shell:RecycleBinFolder' }
            elseif ($body.what -eq 'log') { Start-Process explorer.exe $LogDir }
            Send-Json $ctx @{ ok = $true }
            return
        }
        '/api/quit' {
            Send-Json $ctx @{ ok = $true }
            $script:Quit = $true
            return
        }
    }
    Send-Json $ctx @{ error = 'unknown' } 404
}

function Invoke-Request($ctx) {
    $req = $ctx.Request
    # 名前を偽装したアクセス（DNS リバインディング）を断る
    if ($req.Headers['Host'] -ne "localhost:$Port") {
        Send-Bytes $ctx 403 'text/plain' ([Text.Encoding]::ASCII.GetBytes('forbidden'))
        return
    }
    $path = $req.Url.AbsolutePath
    if (-not $path.StartsWith('/api/')) { Send-Static $ctx; return }
    if ($path -eq '/api/hello') { Send-Json $ctx '{"app":"sukkiri","version":1}'; return }

    # PowerShell の変数名は大文字小文字を区別しないため、$Origin と別の名前にする
    $reqOrigin = $req.Headers['Origin']
    $tok = $req.Headers['X-Token']
    if (-not $tok) { $tok = $req.QueryString['t'] }
    if (($reqOrigin -and $reqOrigin -cne $Origin) -or $tok -cne $Token) {
        Send-Json $ctx @{ error = 'forbidden' } 403
        return
    }
    Invoke-Api $ctx $path
}

# ---------- 起動 ----------
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("$Origin/")
try {
    $listener.Start()
} catch {
    Write-Log "start failed: $_"
    Show-Message "起動できませんでした（ポート $Port がほかのアプリで使われています）。`nパソコンを再起動してから、もう一度お試しください。"
    exit 1
}
Write-Log "started on $Origin (app: $AppDir)"
if (-not $NoBrowser) { Start-Process "$Origin/" }

$script:LastSeen = Get-Date
$script:Quit = $false
try {
    while ($listener.IsListening -and -not $script:Quit) {
        $ar = $listener.BeginGetContext($null, $null)
        while (-not $ar.AsyncWaitHandle.WaitOne(1000)) {
            if (((Get-Date) - $script:LastSeen).TotalMinutes -ge $IdleMinutes) { $script:Quit = $true; break }
        }
        if ($script:Quit) { break }
        $ctx = $listener.EndGetContext($ar)
        $script:LastSeen = Get-Date
        try {
            Invoke-Request $ctx
        } catch {
            Write-Log ("error {0}: {1} {2}" -f $ctx.Request.Url.AbsolutePath, $_, $_.InvocationInfo.PositionMessage)
            try { Send-Json $ctx @{ error = 'server'; message = "$_" } 500 } catch { }
        } finally {
            try { $ctx.Response.Close() } catch { }
        }
        $script:LastSeen = Get-Date
    }
} finally {
    $listener.Close()
    Write-Log 'stopped'
}
