# Start the TTS proxy and launch the presentation (oracle + punch-card form).
# Windows equivalent of deploy/start-avatar.sh (Pi / macOS / Linux).
# Opens kiosk (no browser chrome) on chosen monitors — use AVATAR_WINDOWED=1 for windowed dev mode.

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AvatarWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ClipCursor(ref RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClipCursor(IntPtr lpRect);
    [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT lpRect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$Port = if ($env:AVATAR_PORT) { $env:AVATAR_PORT } else { "8765" }
$Base = "http://127.0.0.1:$Port"
$OracleUrl = "$Base/?production=1&showcase=1"
$FormUrl = "$Base/showcase/form-1517a.html"
$FormScreenIndex = if ($env:AVATAR_FORM_SCREEN) { [int]$env:AVATAR_FORM_SCREEN } else { 0 }
$OracleScreenIndex = if ($env:AVATAR_ORACLE_SCREEN) { [int]$env:AVATAR_ORACLE_SCREEN } else { 1 }
$UseKiosk = $env:AVATAR_WINDOWED -ne "1"
# Form and oracle must share one Chrome profile so BroadcastChannel("absolution") works.
$SharedProfileDir = Join-Path $env:TEMP "aaa-avatar"
New-Item -ItemType Directory -Path $SharedProfileDir -Force | Out-Null

Set-Location $RepoRoot

function Get-ScreenByIndex {
    param([int]$Index)
    $screens = [System.Windows.Forms.Screen]::AllScreens
    if ($Index -lt 0 -or $Index -ge $screens.Count) {
        Write-Warning "Screen index $Index not found (have $($screens.Count) monitor(s)); using primary."
        return [System.Windows.Forms.Screen]::PrimaryScreen
    }
    return $screens[$Index]
}

function Get-ChromeWindowHandles {
    $handles = New-Object System.Collections.Generic.List[IntPtr]
    $callback = [AvatarWin32+EnumWindowsProc]{
        param([IntPtr]$hWnd, [IntPtr]$lParam)
        if (-not [AvatarWin32]::IsWindowVisible($hWnd)) { return $true }
        $className = New-Object System.Text.StringBuilder 256
        [AvatarWin32]::GetClassName($hWnd, $className, 256) | Out-Null
        if ($className.ToString() -eq "Chrome_WidgetWin_1") {
            [void]$handles.Add($hWnd)
        }
        return $true
    }
    [AvatarWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return @($handles)
}

function Move-NewChromeWindowsToScreen {
    param(
        [IntPtr[]]$BeforeHandles,
        [System.Windows.Forms.Screen]$Screen,
        [switch]$UseFullBounds
    )
    $area = if ($UseFullBounds) { $Screen.Bounds } else { $Screen.WorkingArea }
    $after = Get-ChromeWindowHandles
    $newHandles = @($after | Where-Object { $BeforeHandles -notcontains $_ })
    foreach ($hWnd in $newHandles) {
        [AvatarWin32]::MoveWindow($hWnd, $area.X, $area.Y, $area.Width, $area.Height, $true) | Out-Null
    }
}

function Focus-ChromeOnScreen {
    param([System.Windows.Forms.Screen]$Screen)
    $bounds = $Screen.Bounds
    foreach ($hWnd in Get-ChromeWindowHandles) {
        $rect = New-Object AvatarWin32+RECT
        if (-not [AvatarWin32]::GetWindowRect($hWnd, [ref]$rect)) { continue }
        $cx = [int](($rect.Left + $rect.Right) / 2)
        $cy = [int](($rect.Top + $rect.Bottom) / 2)
        if ($cx -ge $bounds.Left -and $cx -lt $bounds.Right -and $cy -ge $bounds.Top -and $cy -lt $bounds.Bottom) {
            [AvatarWin32]::SetForegroundWindow($hWnd) | Out-Null
            return
        }
    }
}

function Get-ScreenClipRect {
    param([System.Windows.Forms.Screen]$Screen)
    $b = $Screen.Bounds
    $rect = New-Object AvatarWin32+RECT
    $rect.Left = $b.Left
    $rect.Top = $b.Top
    $rect.Right = $b.Right
    $rect.Bottom = $b.Bottom
    return $rect
}

function Lock-MouseToFormScreen {
    param([System.Windows.Forms.Screen]$Screen)
    $clip = Get-ScreenClipRect -Screen $Screen
    if (-not [AvatarWin32]::ClipCursor([ref]$clip)) {
        throw "ClipCursor failed (Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    Focus-ChromeOnScreen -Screen $Screen
}

function Unlock-Mouse {
    [AvatarWin32]::ClipCursor([IntPtr]::Zero) | Out-Null
}

function Start-MouseClipKeeper {
    param(
        [System.Windows.Forms.Screen]$Screen,
        [int]$ParentPid
    )
    $clip = Get-ScreenClipRect -Screen $Screen
    $keeperPath = Join-Path $env:TEMP "aaa-avatar-clip-mouse.ps1"
    @"
`$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ClipWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool ClipCursor(ref RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClipCursor(IntPtr lpRect);
}
'@
`$clip = New-Object ClipWin32+RECT
`$clip.Left = $($clip.Left)
`$clip.Top = $($clip.Top)
`$clip.Right = $($clip.Right)
`$clip.Bottom = $($clip.Bottom)
try {
    while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
        [ClipWin32]::ClipCursor([ref]`$clip) | Out-Null
        Start-Sleep -Milliseconds 400
    }
} finally {
    [ClipWin32]::ClipCursor([IntPtr]::Zero) | Out-Null
}
"@ | Set-Content -Path $keeperPath -Encoding UTF8
    return Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $keeperPath) `
        -PassThru
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node is required to run the TTS proxy (deploy/tts-proxy/server.js)."
    exit 1
}

$Chrome = $env:CHROMIUM
if (-not $Chrome) {
    $candidates = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $Chrome = $candidate
            break
        }
    }
}
if (-not $Chrome) {
    Write-Error "Chrome not found. Install Chrome or set CHROMIUM to the full path to chrome.exe."
    exit 1
}

$ServerStarted = $false
$ServerPid = $null
try {
    $health = Invoke-WebRequest -Uri "$Base/tts/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -ne 200) { throw "unhealthy" }
} catch {
    $proc = Start-Process -FilePath "node" `
        -ArgumentList "$RepoRoot\deploy\tts-proxy\server.js" `
        -WorkingDirectory $RepoRoot `
        -PassThru `
        -WindowStyle Hidden
    $ServerStarted = $true
    $ServerPid = $proc.Id
    Start-Sleep -Seconds 1
}

function Launch-AvatarWindow {
    param(
        [string]$Url,
        [int]$ScreenIndex,
        [string]$WindowRole
    )

    $screen = Get-ScreenByIndex $ScreenIndex
    $area = if ($UseKiosk) { $screen.Bounds } else { $screen.WorkingArea }
    $isPortrait = $area.Height -gt $area.Width
    if ($isPortrait -and $WindowRole -eq "oracle") {
        if ($Url -match '\?') { $Url = "$Url&portrait=1" } else { $Url = "$Url?portrait=1" }
    }

    $args = @(
        "--user-data-dir=$SharedProfileDir",
        "--noerrdialogs",
        "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--no-first-run",
        "--disable-translate",
        "--autoplay-policy=no-user-gesture-required",
        "--window-position=$($area.X),$($area.Y)"
    )
    if ($isPortrait) {
        $args += "--start-maximized"
    } else {
        $args += "--window-size=$($area.Width),$($area.Height)"
    }
    $args += "--app=$Url"
    if ($UseKiosk) {
        $args += "--kiosk"
    }

    $before = Get-ChromeWindowHandles
    Start-Process -FilePath $Chrome -ArgumentList $args | Out-Null
    Start-Sleep -Seconds 2
    Move-NewChromeWindowsToScreen -BeforeHandles $before -Screen $screen -UseFullBounds:($UseKiosk -or $isPortrait)
}

if ($env:AVATAR_ORACLE_ONLY -eq "1") {
    Launch-AvatarWindow -Url "$Base/?production=1" -ScreenIndex $OracleScreenIndex -WindowRole "oracle"
    exit 0
}

Write-Host "Presentation mode (kiosk):"
Write-Host "  Oracle:  $OracleUrl (+ portrait=1 when that screen is tall)"
Write-Host "           screen index $OracleScreenIndex ($((Get-ScreenByIndex $OracleScreenIndex).DeviceName))"
Write-Host "  Form:    $FormUrl"
Write-Host "           screen index $FormScreenIndex ($((Get-ScreenByIndex $FormScreenIndex).DeviceName))"
Write-Host ""
Write-Host "Monitors (0-based index):"
$idx = 0
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    $primary = if ($s.Primary) { ", primary" } else { "" }
    Write-Host "  [$idx] $($s.DeviceName)$primary - $($s.WorkingArea.Width)x$($s.WorkingArea.Height) at ($($s.WorkingArea.X),$($s.WorkingArea.Y))"
    $idx++
}
Write-Host ""
Write-Host "Override with AVATAR_FORM_SCREEN / AVATAR_ORACLE_SCREEN. Windowed dev mode: AVATAR_WINDOWED=1"
Write-Host "Skip mouse lock: AVATAR_CLIP_MOUSE=0"
Write-Host "Seconds before mouse lock (tap oracle first): AVATAR_CLIP_WAIT=20"
Write-Host ""
Write-Host "Tap the oracle window once for audio. The mouse will lock to the form display after a short countdown."

Launch-AvatarWindow -Url $OracleUrl -ScreenIndex $OracleScreenIndex -WindowRole "oracle"
Start-Sleep -Seconds 1
Launch-AvatarWindow -Url $FormUrl -ScreenIndex $FormScreenIndex -WindowRole "form"

if ($ServerStarted -and $ServerPid) {
    Write-Host "TTS proxy running (PID $ServerPid). Stop with: Stop-Process -Id $ServerPid"
    Write-Host ""
}

$formScreen = Get-ScreenByIndex $FormScreenIndex
$clipMouse = $env:AVATAR_CLIP_MOUSE -ne "0"
if ($clipMouse) {
    $clipWait = if ($env:AVATAR_CLIP_WAIT) { [int]$env:AVATAR_CLIP_WAIT } else { 20 }
    if ($clipWait -lt 0) { $clipWait = 0 }
    for ($i = $clipWait; $i -gt 0; $i--) {
        Write-Host "  Mouse locks in $i s - tap the oracle now if you have not yet..."
        Start-Sleep -Seconds 1
    }
    Lock-MouseToFormScreen -Screen $formScreen
    $clipProc = Start-MouseClipKeeper -Screen $formScreen -ParentPid $PID
    $clipRect = Get-ScreenClipRect -Screen $formScreen
    Write-Host "Mouse locked to $($formScreen.DeviceName) ($($clipRect.Left),$($clipRect.Top)-$($clipRect.Right),$($clipRect.Bottom))."
    Write-Host "Clip keeper PID $($clipProc.Id). Press Ctrl+C here to end the session and release the mouse."
    try {
        while ($true) { Start-Sleep -Seconds 3600 }
    } finally {
        if (-not $clipProc.HasExited) { Stop-Process -Id $clipProc.Id -Force -ErrorAction SilentlyContinue }
        Unlock-Mouse
    }
}
