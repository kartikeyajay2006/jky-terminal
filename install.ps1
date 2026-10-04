# JKY Terminal installer for Windows.
#
#   irm https://raw.githubusercontent.com/kartikeyajay2006/jky-terminal/main/install.ps1 | iex
#
# Downloads the latest release, checks it against the release's SHA256SUMS,
# installs it for this user - no administrator - and adds a `jky` command
# that opens JKY Terminal from any terminal. It then offers a shortcut that
# summons JKY from anywhere, and stores the choice in JKY's own settings so
# it is never asked again.
#
# Choices through the environment, since `iex` passes no arguments:
#   $env:JKY_VERSION = "v0.1.0"      install that release rather than the latest
#   $env:JKY_SHORTCUT = "Ctrl+Alt+J" choose without being asked ("none" for none)
#   $env:JKY_NO_ANIMATION = "1"      plain output
#   $env:NO_COLOR = "1"              no colour
# Or run a saved copy: .\install.ps1 -Shortcut Ctrl+Alt+J, or -Uninstall.
#
# Works in Windows PowerShell 5.1 and PowerShell 7. JKY_INSTALLER_MARKER

param(
    [string]$Version = "",
    [string]$Shortcut = $null,
    [switch]$NoAnimation,
    [switch]$Uninstall,
    [string]$SetShortcut = $null,
    [switch]$Lib
)

# Captured here: inside a function $PSBoundParameters is that function's own,
# and a [string] parameter turns $null into "", so "was it given" can only be
# answered at this level.
$JkyBound = $PSBoundParameters
$JkyRepo = "kartikeyajay2006/jky-terminal"
$JkyScriptUrl = "https://raw.githubusercontent.com/$JkyRepo/main/install.ps1"
if ($env:JKY_SCRIPT_URL) { $JkyScriptUrl = $env:JKY_SCRIPT_URL }

# --- output ------------------------------------------------------------------

function Initialize-JkyOutput {
    $script:Tty = -not [Console]::IsOutputRedirected
    $script:Vt = $false
    if ($script:Tty -and -not $env:NO_COLOR) { $script:Vt = Enable-JkyVt }
    $script:Anim = $script:Vt -and -not $env:JKY_NO_ANIMATION -and -not $NoAnimation
    try { $script:Cols = [Console]::WindowWidth } catch { $script:Cols = 80 }
    if (-not $script:Cols -or $script:Cols -lt 40) { $script:Cols = 80 }
    # Windows Terminal and VS Code draw any Unicode; the classic console's
    # Consolas does not, so it gets the shapes it is guaranteed to have.
    $script:Rich = [bool]($env:WT_SESSION -or $env:TERM_PROGRAM -eq "vscode" -or $env:JKY_RICH)
    try { $script:OldEncoding = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
    $e = [char]27
    if ($script:Vt) {
        $script:RST = "$e[0m"; $script:BLD = "$e[1m"
        $script:CYAN = Get-JkyRgb 0 229 255; $script:BLUE = Get-JkyRgb 56 189 248
        $script:VIOLET = Get-JkyRgb 189 147 249; $script:MINT = Get-JkyRgb 61 220 151
        $script:AMBER = Get-JkyRgb 255 179 64; $script:RED = Get-JkyRgb 255 77 106
        $script:TEXT = Get-JkyRgb 232 232 240; $script:MUTED = Get-JkyRgb 154 154 178
        $script:FAINT = Get-JkyRgb 90 90 112
    } else {
        foreach ($n in "RST", "BLD", "CYAN", "BLUE", "VIOLET", "MINT", "AMBER", "RED", "TEXT", "MUTED", "FAINT") { Set-Variable -Scope Script -Name $n -Value "" }
    }
    if ($script:Rich) {
        $script:OK = [string][char]0x2713; $script:BAD = [string][char]0x2717; $script:DOT = [string][char]0x25C6
        $script:ARROW = [string][char]0x276F; $script:STAR = [string][char]0x2726
        $script:TL = [string][char]0x256D; $script:TR = [string][char]0x256E; $script:BL = [string][char]0x2570; $script:BR = [string][char]0x256F
    } else {
        $script:OK = [string][char]0x221A; $script:BAD = "x"; $script:DOT = [string][char]0x2666
        $script:ARROW = [string][char]0x25BA; $script:STAR = "*"
        $script:TL = [string][char]0x250C; $script:TR = [string][char]0x2510; $script:BL = [string][char]0x2514; $script:BR = [string][char]0x2518
    }
    $script:H = [string][char]0x2500; $script:V = [string][char]0x2502
    $script:FULL = [string][char]0x2588; $script:EMPTY = [string][char]0x2591
}

function Enable-JkyVt {
    try { if ($Host.UI.SupportsVirtualTerminal) { return $true } } catch {}
    try {
        $sig = '[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out int m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, int m);'
        $k = Add-Type -MemberDefinition $sig -Name JkyConsole -Namespace JkyInstaller -PassThru
        $h = $k::GetStdHandle(-11); $m = 0
        if ($k::GetConsoleMode($h, [ref]$m)) { return [bool]$k::SetConsoleMode($h, ($m -bor 4)) }
    } catch {}
    return $false
}

function Get-JkyRgb([int]$r, [int]$g, [int]$b) { return "$([char]27)[38;2;$r;$g;${b}m" }

# Cyan to violet, step $i of $n: the gradient everything is drawn in.
function Get-JkyGrad([int]$i, [int]$n) {
    if (-not $script:Vt) { return "" }
    return Get-JkyRgb ([int](189 * $i / $n)) ([int](229 - 82 * $i / $n)) ([int](255 - 6 * $i / $n))
}

function W([string]$s) { [Console]::Write($s) }
function WL([string]$s = "") { [Console]::Write($s + "`n") }
function Wait-JkyBeat([int]$ms) { if ($script:Anim) { Start-Sleep -Milliseconds $ms } }
function Hide-JkyCursor { if ($script:Vt) { W "$([char]27)[?25l" } }
function Show-JkyCursor { if ($script:Vt) { W "$([char]27)[?25h" } }
function Clear-JkyLine { if ($script:Vt) { W "`r$([char]27)[K" } }

function Write-JkySection([string]$title) { WL ""; WL "  $script:CYAN$script:DOT$script:RST  $script:BLD$script:TEXT$title$script:RST" }
function Write-JkyDone([string]$label, [string]$detail) { WL ("     $script:MINT$script:OK$script:RST {0,-26} $script:MUTED{1}$script:RST" -f $label, $detail) }

function Stop-Jky([string]$what, [string]$hint = "") {
    Show-JkyCursor
    WL ""; WL "     $script:RED$script:BAD $what$script:RST"
    # Each line of the hint on its own, so a long link never wraps into the
    # next sentence.
    if ($hint) { foreach ($line in $hint -split "`n") { WL "       $script:MUTED$line$script:RST" } }
    WL ""
    throw "JKY_INSTALL_FAILED: $what"
}

function Get-JkySpinner([int]$i) {
    if ($script:Rich) { $f = [char[]](0x280B, 0x2819, 0x2839, 0x2838, 0x283C, 0x2834, 0x2826, 0x2827, 0x2807, 0x280F) }
    else { $f = [char[]](0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588, 0x2587, 0x2586, 0x2585, 0x2584, 0x2583, 0x2582) }
    return [string]$f[$i % $f.Length]
}

function Write-JkySpinner([string]$label, [int]$i) {
    W ("`r     {0}{1}$script:RST $script:TEXT{2}$script:RST" -f (Get-JkyGrad ($i % 12) 12), (Get-JkySpinner $i), $label)
}

# Run a step with a spinner beside its name, then mark it done.
function Invoke-JkyStep([string]$label, [string]$detail, [scriptblock]$work) {
    $result = $null
    if ($script:Anim) {
        Write-JkySpinner $label 0
        $result = & $work
        Clear-JkyLine
    } else {
        $result = & $work
    }
    Write-JkyDone $label $detail
    return $result
}

# A process run with a spinner while it works.
function Wait-JkyProcess([System.Diagnostics.Process]$p, [string]$label) {
    $i = 0
    while (-not $p.HasExited) {
        if ($script:Anim) { Write-JkySpinner $label $i; $i++ }
        Start-Sleep -Milliseconds 90
    }
    Clear-JkyLine
    $p.WaitForExit()
    return $p.ExitCode
}

# --- the banner --------------------------------------------------------------

function Expand-JkyGlyphs([string[]]$rows) {
    # Letters chosen so no two differ only by case: PowerShell's hashtables
    # ignore case, and B and b would be one key.
    $map = @{ "X" = 0x2588; "a" = 0x2557; "l" = 0x2551; "c" = 0x2554; "d" = 0x255D; "e" = 0x2550; "f" = 0x255A }
    $out = @()
    foreach ($row in $rows) {
        $sb = New-Object System.Text.StringBuilder
        foreach ($ch in $row.ToCharArray()) {
            $code = $map[[string]$ch]
            if ($code) { [void]$sb.Append([char]$code) } else { [void]$sb.Append($ch) }
        }
        $out += $sb.ToString()
    }
    return $out
}

function Write-JkyBannerRows([int]$shift, [int]$pause, [string]$label) {
    # Written in letters and decoded, so this file stays ASCII: Windows
    # PowerShell 5.1 reads a script without a byte-order mark as Windows-1252.
    $j = Expand-JkyGlyphs @("     XXa", "     XXl", "     XXl", "XX   XXl", "fXXXXXcd", " feeeed ")
    $k = Expand-JkyGlyphs @("XXa  XXa", "XXl XXcd", "XXXXXcd ", "XXceXXa ", "XXl  XXa", "fed  fed")
    $y = Expand-JkyGlyphs @("XXa   XXa", "fXXa XXcd", " fXXXXcd ", "  fXXcd  ", "   XXl   ", "   fed   ")
    $features = @("AI-POWERED TERMINAL", "GLOBAL SUMMON", "WORKS EVERYWHERE", "BUILT FOR DEVELOPERS", "INFINITE POSSIBILITIES")
    for ($row = 0; $row -lt 6; $row++) {
        $line = "  " + (Get-JkyGrad (($row + $shift) % 10) 9) + $script:BLD + $j[$row] + " " +
            (Get-JkyGrad (($row + 2 + $shift) % 10) 9) + $k[$row] + " " +
            (Get-JkyGrad (($row + 4 + $shift) % 10) 9) + $y[$row] + $script:RST
        $used = 29
        if ($row -eq 1) {
            $line += "     $script:BLD$(Get-JkyGrad 2 9)T E R M I N A L$script:RST  $script:VIOLET[$label]$script:RST"
            $used = 29 + 5 + 15 + 2 + $label.Length + 2
        } elseif ($row -eq 3) {
            $line += "     $($script:TEXT)AI terminal. Infinite $($script:VIOLET)possibilities.$script:RST"
            $used = 29 + 5 + 36
        }
        if ($script:Cols -ge 108 -and $row -lt 5) {
            $line += (" " * (80 - $used)) + "$script:FAINT$script:V$script:RST $(Get-JkyGrad $row 5)>$script:RST $script:MUTED$($features[$row])$script:RST"
        }
        if ($script:Vt) { $line += "$([char]27)[K" }
        WL $line
        if ($pause -gt 0) { Wait-JkyBeat $pause }
    }
}

function Write-JkyBanner([string]$label) {
    WL ""
    Write-JkyBannerRows 0 40 $label
    if ($script:Anim) {
        for ($wave = 1; $wave -le 10; $wave++) {
            W "$([char]27)[6A"
            Write-JkyBannerRows $wave 0 $label
            Start-Sleep -Milliseconds 50
        }
        W "$([char]27)[6A"
        Write-JkyBannerRows 0 0 $label
    }
}

# --- what this machine is ----------------------------------------------------

function Get-JkySystem {
    $os = "Windows"
    try { $os = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption.Trim() } catch {
        try { $os = (Get-WmiObject Win32_OperatingSystem).Caption.Trim() } catch {}
    }
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    $note = ""
    switch ($arch) {
        "AMD64" { $arch = "x64" }
        "ARM64" { $arch = "arm64"; $note = "runs the x64 build through Windows' emulation" }
        default { Stop-Jky "JKY Terminal is not built for $arch." "Builds exist for 64-bit Windows." }
    }
    return @{ Os = $os; Arch = $arch; Note = $note }
}

function Write-JkyChecks($sys) {
    Write-JkySection "Checking your system..."
    foreach ($c in @(@("Operating system", $sys.Os), @("Architecture", ($sys.Arch + $(if ($sys.Note) { " - " + $sys.Note } else { "" }))), @("Compatibility", "JKY Terminal runs on macOS, Linux and Windows."))) {
        if ($script:Anim) { for ($i = 0; $i -lt 5; $i++) { Write-JkySpinner ($c[0] + "...") $i; Start-Sleep -Milliseconds 50 }; Clear-JkyLine }
        Write-JkyDone $c[0] $c[1]
    }
}

# --- download ----------------------------------------------------------------

function Get-JkyBase {
    if ($env:JKY_RELEASE_BASE) { return $env:JKY_RELEASE_BASE.TrimEnd("/") }
    if ($script:JkyVersion -eq "latest") { return "https://github.com/$JkyRepo/releases/latest/download" }
    return "https://github.com/$JkyRepo/releases/download/$($script:JkyVersion)"
}

# The release's SHA256SUMS, and whether the server was reached at all: "no
# release" and "no connection" need different advice.
function Get-JkySums($client, [string]$base) {
    try { $r = $client.GetAsync("$base/SHA256SUMS").GetAwaiter().GetResult() }
    catch {
        $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
        return @{ Status = "offline"; Text = $null; Reason = $e.Message }
    }
    $code = [int]$r.StatusCode
    if ($code -eq 404 -or $code -eq 410) { return @{ Status = "missing"; Text = $null; Code = $code } }
    if (-not $r.IsSuccessStatusCode) { return @{ Status = "error"; Text = $null; Code = $code } }
    return @{ Status = "ok"; Text = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
}

function New-JkyClient {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    Add-Type -AssemblyName System.Net.Http
    $c = New-Object System.Net.Http.HttpClient
    $c.Timeout = [TimeSpan]::FromMinutes(30)
    $c.DefaultRequestHeaders.UserAgent.ParseAdd("jky-terminal-installer")
    return $c
}

function Format-JkyBytes([double]$b) {
    if ($b -ge 1MB) { return "{0:N1} MB" -f ($b / 1MB) }
    if ($b -ge 1KB) { return "{0:N0} KB" -f ($b / 1KB) }
    return "{0:N0} B" -f $b
}

function Get-JkyBar([int]$pct, [int]$cells) {
    $full = [int][Math]::Floor($pct * $cells / 100)
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $cells; $i++) {
        if ($i -lt $full) { [void]$sb.Append((Get-JkyGrad $i $cells) + $script:FULL) }
        else { [void]$sb.Append($script:FAINT + $script:EMPTY) }
    }
    return $sb.ToString() + $script:RST
}

function Save-JkyDownload($client, [string]$url, [string]$out, [string]$label) {
    $resp = $client.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $resp.IsSuccessStatusCode) { Stop-Jky "The download failed: $([int]$resp.StatusCode)." $url }
    $total = $resp.Content.Headers.ContentLength
    $in = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $file = [IO.File]::Create($out)
    $buf = New-Object byte[] 262144
    $got = 0L; $frame = 0
    $clock = [Diagnostics.Stopwatch]::StartNew(); $last = -1000
    $cells = 28; if ($script:Cols -lt 100) { $cells = 18 }
    try {
        while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
            $file.Write($buf, 0, $n); $got += $n
            if ($script:Anim -and ($clock.ElapsedMilliseconds - $last) -ge 100) {
                $last = $clock.ElapsedMilliseconds
                $speed = $got / [Math]::Max(0.2, $clock.Elapsed.TotalSeconds)
                Write-JkySpinner ("{0,-21}" -f $label) $frame; $frame++
                if ($total) {
                    $pct = [int][Math]::Min(100, $got * 100 / $total)
                    $left = [int](($total - $got) / [Math]::Max(1, $speed))
                    W ("  " + (Get-JkyBar $pct $cells) + (" $script:BLD$script:TEXT{0,3}%$script:RST  $script:MUTED{1} / {2}$script:RST" -f $pct, (Format-JkyBytes $got), (Format-JkyBytes $total)))
                    if ($script:Cols -ge 100) { W ("  $script:BLUE{0}/s$script:RST  $script:FAINT{1}s$script:RST" -f (Format-JkyBytes $speed), $left) }
                } else {
                    W ("  $script:MUTED{0}$script:RST" -f (Format-JkyBytes $got))
                }
                W "$([char]27)[K"
            }
        }
    } finally { $file.Dispose(); $in.Dispose() }
    if ($script:Anim) {
        Clear-JkyLine
        WL ("     $script:MINT$script:OK$script:RST {0,-26} " -f $label + (Get-JkyBar 100 $cells) + " $script:BLD$script:TEXT" + "100%$script:RST  $script:MUTED$(Format-JkyBytes $got)$script:RST")
    } else {
        Write-JkyDone $label (Format-JkyBytes $got)
    }
}

# --- install -----------------------------------------------------------------

function Get-JkyInstalledExe {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JKY Terminal"
    try {
        $icon = (Get-ItemProperty -Path $key -ErrorAction Stop).DisplayIcon
        if ($icon) { $p = $icon.Trim('"'); if (Test-Path $p) { return $p } }
    } catch {}
    $fallback = Join-Path $env:LOCALAPPDATA "JKY Terminal\jky-terminal.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Get-JkyStartMenuLink { return Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\JKY Terminal.lnk" }

function Write-JkyLauncher([string]$exe) {
    New-Item -ItemType Directory -Force -Path $script:BinDir | Out-Null
    # ASCII only: cmd reads a .cmd file in the console's code page.
    $cmd = @"
@echo off
rem jky - open JKY Terminal from any terminal. Written by the JKY Terminal installer.
setlocal
set "JKY_EXE=$exe"
set "JKY_HOME=$($script:JkyHome)"
if "%~1"=="" goto open
if /i "%~1"=="open" goto open
if /i "%~1"=="shortcut" goto shortcut
if /i "%~1"=="version" goto version
if /i "%~1"=="--version" goto version
if /i "%~1"=="-v" goto version
if /i "%~1"=="uninstall" goto uninstall
if /i "%~1"=="help" goto help
if /i "%~1"=="--help" goto help
if /i "%~1"=="-h" goto help
echo jky: unknown command '%~1' - try jky help 1>&2
exit /b 1
:open
start "" "%JKY_EXE%"
exit /b 0
:shortcut
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%JKY_HOME%\install.ps1" -SetShortcut "%~2"
exit /b %ERRORLEVEL%
:version
type "%JKY_HOME%\VERSION"
exit /b 0
rem Uninstalling deletes this file, and cmd reads a batch file as it goes:
rem (goto) leaves the batch first, so nothing is read from it afterwards.
:uninstall
(goto) 2>nul & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%JKY_HOME%\install.ps1" -Uninstall
:help
echo jky                     open JKY Terminal (or bring it forward)
echo jky shortcut ^<keys^>     change the summon shortcut, e.g. jky shortcut Ctrl+Alt+J - or none
echo jky version             the installed version
echo jky uninstall           remove JKY Terminal; your data is kept
exit /b 0
"@
    [IO.File]::WriteAllText((Join-Path $script:BinDir "jky.cmd"), $cmd.Replace("`r`n", "`n").Replace("`n", "`r`n"), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $script:JkyHome "VERSION"), $script:ReleaseVersion)
    # Kept for `jky shortcut` and `jky uninstall`.
    $self = $PSCommandPath
    if ($self -and (Test-Path $self) -and (Select-String -Path $self -Pattern "JKY_INSTALLER_MARKER" -Quiet)) {
        Copy-Item -Force $self (Join-Path $script:JkyHome "install.ps1")
    } else {
        try { (New-JkyClient).GetStringAsync($JkyScriptUrl).GetAwaiter().GetResult() | Set-Content -Encoding UTF8 (Join-Path $script:JkyHome "install.ps1") } catch {}
    }
}

# Put the launcher's folder on the user PATH for new terminals, and this one.
function Add-JkyPath {
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $user) { $user = "" }
    $parts = $user.Split(";") | Where-Object { $_ }
    if ($parts -notcontains $script:BinDir) {
        [Environment]::SetEnvironmentVariable("Path", ((@($parts) + $script:BinDir) -join ";"), "User")
    }
    if (($env:Path.Split(";")) -notcontains $script:BinDir) { $env:Path = "$env:Path;$($script:BinDir)" }
}

# --- the summon shortcut -----------------------------------------------------

# A shortcut as typed, to its canonical form - the rules in
# crates/jky-keys/src/summon.rs, tested against scripts/install/shortcuts.tsv.
function ConvertTo-JkyShortcut([string]$text) {
    $words = @($text.ToLower() -split "[\s+\-]+" | Where-Object { $_ })
    if ($words.Count -eq 0) { return $null }
    $held = @{ Ctrl = 0; Alt = 0; Shift = 0; Super = 0 }
    $key = $null
    for ($i = 0; $i -lt $words.Count; $i++) {
        $w = $words[$i]
        $m = $null
        switch -regex ($w) {
            "^(ctrl|control|ctl)$" { $m = "Ctrl" }
            "^(alt|option|opt)$" { $m = "Alt" }
            "^shift$" { $m = "Shift" }
            "^(super|win|windows|cmd|command|meta)$" { $m = "Super" }
        }
        if ($m) { $held[$m]++; continue }
        if ($i -ne $words.Count - 1) { return $null }
        if ($w -eq "space") { $key = "Space" }
        elseif ($w -match "^[a-z0-9]$") { $key = $w.ToUpper() }
        elseif ($w -match "^f([1-9]|1[0-9]|2[0-4])$") { $key = "F" + $Matches[1] }
        else { return $null }
    }
    if (-not $key) { return $null }
    foreach ($v in $held.Values) { if ($v -gt 1) { return $null } }
    $mods = $held.Ctrl + $held.Alt + $held.Shift + $held.Super
    if ($mods -eq 0) { return $null }
    if ($mods -eq 1 -and ($held.Ctrl -eq 1 -or $held.Shift -eq 1)) { return $null }
    $out = ""
    foreach ($n in "Ctrl", "Alt", "Shift", "Super") { if ($held[$n] -eq 1) { $out += "$n+" } }
    return $out + $key
}

function Test-JkyOff([string]$text) { return @("", "none", "off", "skip") -contains ($text.Trim().ToLower()) }

function Format-JkyShortcut([string]$c) { return $c.Replace("Super", "Win").Replace("+", " + ") }

# The Start-menu shortcut's own hotkey, which opens JKY even when it is closed.
# Windows allows it only for two or more of Ctrl, Alt and Shift with a letter,
# digit or F-key - never Win, never Space.
function ConvertTo-JkyLinkHotkey([string]$canonical) {
    if ($canonical -match "Super" -or $canonical -match "Space$") { return $null }
    $parts = $canonical.Split("+")
    $mods = $parts[0..($parts.Count - 2)]
    if ($mods.Count -lt 2) { return $null }
    $names = @{ Ctrl = "CTRL"; Alt = "ALT"; Shift = "SHIFT" }
    return (($mods | ForEach-Object { $names[$_] }) -join "+") + "+" + $parts[-1].ToUpper()
}

function Set-JkyLinkHotkey([string]$hotkey) {
    $lnk = Get-JkyStartMenuLink
    if (-not (Test-Path $lnk)) { return $false }
    try {
        $shell = New-Object -ComObject WScript.Shell
        $s = $shell.CreateShortcut($lnk)
        $s.Hotkey = $hotkey
        $s.Save()
        return $true
    } catch { return $false }
}

function Write-JkyChooser([int]$sel, [string[]]$presets) {
    $H = $script:H; $V = $script:V
    WL ("     $script:VIOLET$script:TL$H$script:RST $script:AMBER$script:STAR $script:BLD$script:TEXT" + "Choose a global summon shortcut for JKY Terminal$script:RST $script:VIOLET" + ($H * 8) + "$script:TR$script:RST")
    $rows = @()
    for ($n = 1; $n -le 3; $n++) { $extra = ""; if ($n -eq 1) { $extra = "(Recommended)" }; $rows += , @("[$n]  ", (Format-JkyShortcut $presets[$n - 1]), $extra) }
    $rows += , @("[c]  ", "Type your own", "")
    $rows += , @("[Esc]", "Skip for now", "")
    for ($i = 0; $i -lt 5; $i++) {
        $r = $rows[$i]
        if ($i + 1 -eq $sel) {
            WL ("     $script:VIOLET$V$script:RST $script:BLD$script:CYAN$script:ARROW {0} {1,-22} {2,-28}$script:RST $script:VIOLET$V$script:RST" -f $r[0], $r[1], $r[2])
        } else {
            WL ("     $script:VIOLET$V$script:RST   $script:MUTED{0} {1,-22} $script:FAINT{2,-28}$script:RST $script:VIOLET$V$script:RST" -f $r[0], $r[1], $r[2])
        }
    }
    $arrows = "^v"; $dot = "-"
    if ($script:Rich) { $arrows = [string][char]0x2191 + [char]0x2193; $dot = [string][char]0x00B7 }
    $foot = "$arrows choose $dot Enter confirm $dot 1-3 pick $dot c type $dot Esc skip"
    WL ("     $script:VIOLET$script:BL$H$script:RST $script:FAINT$foot$script:RST $script:VIOLET" + ($H * (58 - $foot.Length)) + "$script:BR$script:RST")
    WL "       $($script:MUTED)It opens JKY Terminal from anywhere on your system.$script:RST"
    WL "       $($script:FAINT)Your choice is saved in JKY, so you are only asked once.$script:RST"
}

function Read-JkyShortcutChoice {
    $presets = @("Ctrl+Alt+J", "Super+J", "Ctrl+Alt+Space")
    $sel = 1
    Hide-JkyCursor
    Write-JkyChooser $sel $presets
    $choice = $null
    while ($null -eq $choice) {
        $k = [Console]::ReadKey($true)
        switch ($k.Key) {
            "UpArrow" { $sel-- }
            "DownArrow" { $sel++ }
            "Escape" { $choice = "none" }
            "Enter" { if ($sel -le 3) { $choice = $presets[$sel - 1] } elseif ($sel -eq 4) { $choice = "custom" } else { $choice = "none" } }
            default {
                switch ([string]$k.KeyChar) {
                    "1" { $sel = 1; $choice = $presets[0] }
                    "2" { $sel = 2; $choice = $presets[1] }
                    "3" { $sel = 3; $choice = $presets[2] }
                    { $_ -eq "c" -or $_ -eq "C" } { $sel = 4; $choice = "custom" }
                    { $_ -eq "s" -or $_ -eq "S" } { $choice = "none" }
                }
            }
        }
        if ($sel -lt 1) { $sel = 5 }
        if ($sel -gt 5) { $sel = 1 }
        if ($script:Vt) { W "$([char]27)[9A" }
        Write-JkyChooser $sel $presets
    }
    Show-JkyCursor
    if ($choice -eq "custom") {
        while ($true) {
            W "     $script:CYAN$script:ARROW$script:RST Type a shortcut $($script:FAINT)(e.g. Ctrl+Alt+K - or none)$($script:RST): "
            $typed = [Console]::ReadLine()
            if ($null -eq $typed -or (Test-JkyOff $typed)) { $choice = "none"; break }
            $c = ConvertTo-JkyShortcut $typed
            if ($c) { $choice = $c; break }
            WL "       $script:AMBER$typed is not a shortcut JKY can use - it needs Ctrl+Alt, Shift, Win or Alt, and one key.$script:RST"
        }
    }
    return $choice
}

# Store the choice in JKY's own settings, through the app, so the app's rules
# decide what is valid. Returns the stored form, or $null with the reason shown.
function Save-JkyShortcut([string]$exe, [string]$wanted) {
    $outFile = Join-Path $script:Work "shortcut.out"; $errFile = Join-Path $script:Work "shortcut.err"
    $p = Start-Process -FilePath $exe -ArgumentList @("--set-shortcut", $wanted) -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    if ($p.ExitCode -ne 0) {
        WL "     $script:AMBER$script:BAD$script:RST $((Get-Content $errFile -Raw -ErrorAction SilentlyContinue))"
        return $null
    }
    # The app's answer is its last line: a library may print a warning first.
    # Stored and nothing said means stored as asked, since what was asked for
    # is already in canonical form.
    $said = @(Get-Content $outFile -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
    $answer = ""
    if ($said.Count -gt 0) { $answer = $said[-1].Trim() }
    if ($answer -ne "none" -and -not (ConvertTo-JkyShortcut $answer)) { $answer = $wanted }
    return $answer
}

function Set-JkySummon([string]$exe, [string]$wanted) {
    if (-not (Test-JkyOff $wanted)) {
        $c = ConvertTo-JkyShortcut $wanted
        if (-not $c) {
            WL "     $script:AMBER$script:BAD$script:RST $wanted is not a shortcut JKY can use: it needs Ctrl+Alt, Shift, Win or Alt, and one key."
            return $false
        }
        $wanted = $c
    } else { $wanted = "none" }
    $stored = Save-JkyShortcut $exe $wanted
    if (-not $stored) { return $false }
    if ($stored -eq "none") {
        [void](Set-JkyLinkHotkey "")
        Write-JkyDone "Summon shortcut" "none - choose one later with: jky shortcut <keys>"
        return $true
    }
    $hotkey = ConvertTo-JkyLinkHotkey $stored
    if ($hotkey -and (Set-JkyLinkHotkey $hotkey)) {
        Write-JkyDone "Summon shortcut" "$(Format-JkyShortcut $stored) - opens JKY even when it is closed"
    } else {
        [void](Set-JkyLinkHotkey "")
        Write-JkyDone "Summon shortcut" "$(Format-JkyShortcut $stored) - brings JKY forward while it is open"
    }
    return $true
}

# --- finishing ---------------------------------------------------------------

function Write-JkyFinale {
    $msg = "JKY Terminal $($script:ReleaseVersion) is installed."
    if ($msg.Length -gt 38 -or -not $script:ReleaseVersion) { $msg = "JKY Terminal is installed." }
    $frames = 1; if ($script:Anim) { $frames = 8 }
    $H = $script:H; $V = $script:V; $M = $script:MINT; $R = $script:RST; $P = $script:VIOLET
    WL ""
    for ($f = 0; $f -lt $frames; $f++) {
        if ($f -gt 0) { W "$([char]27)[9A" }
        $s1 = " "; $s2 = " "; $s3 = " "
        switch ($f % 4) { 0 { $s1 = $script:STAR } 1 { $s2 = $script:STAR } 2 { $s3 = $script:STAR } 3 { $s1 = $script:STAR; $s3 = $script:STAR } }
        if ($f + 1 -eq $frames) { $s1 = $script:STAR; $s2 = $script:STAR; $s3 = $script:STAR }
        $B = "$M$V$R"
        WL "     $M$script:TL$($H * 64)$script:TR$R"
        WL "     $B$(' ' * 64)$B"
        WL ("     $B   $script:BLD$M$script:OK  Installation complete!$R  $script:AMBER$s1$R             $script:MUTED{0,-20}$R$B" -f "Launch with:")
        WL "     $B$(' ' * 44)$P$script:TL$($H * 11)$script:TR$R$script:AMBER$s2$R$(' ' * 6)$B"
        $padded = "{0,-38}" -f $msg
        WL ("     $B      $script:TEXT$padded$R$P$V    $script:BLD$script:CYAN" + "jky" + "$R$P    $V$R" + (" " * 7) + $B)
        WL ("     $B      Type $script:BLD$script:CYAN" + "jky" + "$R in any terminal to open it.  $P$script:BL" + ($H * 11) + "$script:BR$R$script:AMBER$s3$R" + (" " * 6) + $B)
        WL "     $B$(' ' * 64)$B"
        WL "     $M$script:BL$($H * 64)$script:BR$R"
        WL ""
        Wait-JkyBeat 150
    }
}

# --- uninstall ---------------------------------------------------------------

function Invoke-JkyUninstall {
    Write-JkySection "Removing JKY Terminal..."
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JKY Terminal"
    try {
        $entry = Get-ItemProperty -Path $key -ErrorAction Stop
        $u = "$($entry.UninstallString)".Trim('"')
        $dir = "$($entry.InstallLocation)".Trim('"')
        if ($u -and (Test-Path $u)) {
            # An NSIS uninstaller copies itself away and returns at once,
            # unless told with _?= to run in place - only then does waiting
            # for it mean the files are gone. Last, and never quoted.
            $p = Start-Process -FilePath $u -ArgumentList "/S _?=$dir" -PassThru
            $null = $p.Handle
            [void](Wait-JkyProcess $p "Uninstalling")
            # Run in place, it cannot delete itself; the folder is the app's.
            if ($dir -and (Split-Path -Leaf $dir) -eq "JKY Terminal") { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $dir }
        }
    } catch {}
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($user) {
        $kept = ($user.Split(";") | Where-Object { $_ -and $_ -ne $script:BinDir }) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $kept, "User")
    }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $script:JkyHome
    Write-JkyDone "JKY Terminal removed" ""
    WL "       $($script:MUTED)Your settings, history and notes are kept. To remove them too, delete:$script:RST"
    WL "       $script:TEXT$env:APPDATA\dev.jky.terminal$script:RST"
    WL ""
}

# --- main --------------------------------------------------------------------

function Install-Jky {
    $script:JkyVersion = $Version
    if (-not $script:JkyVersion) { $script:JkyVersion = $env:JKY_VERSION }
    if (-not $script:JkyVersion) { $script:JkyVersion = "latest" }
    $want = $Shortcut
    if ($null -eq $want -or $want -eq "") { $want = $env:JKY_SHORTCUT }
    $script:JkyHome = Join-Path $env:LOCALAPPDATA "JKY Terminal Installer"
    $script:BinDir = Join-Path $script:JkyHome "bin"

    Initialize-JkyOutput
    if ($Uninstall) { Invoke-JkyUninstall; return }

    New-Item -ItemType Directory -Force -Path $script:JkyHome | Out-Null
    $script:Work = Join-Path $script:JkyHome (".install." + [Guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $script:Work | Out-Null
    try {
        if ($JkyBound.ContainsKey("SetShortcut")) {
            $exe = Get-JkyInstalledExe
            if (-not $exe) { Stop-Jky "JKY Terminal is not installed." "Install it first: irm https://raw.githubusercontent.com/$JkyRepo/main/install.ps1 | iex" }
            $script:ReleaseVersion = ""
            $wanted = $SetShortcut
            if ((-not $wanted) -and $script:Tty) { $wanted = Read-JkyShortcutChoice }
            if (Set-JkySummon $exe $wanted) { return } else { throw "JKY_INSTALL_FAILED: shortcut" }
        }

        $sys = Get-JkySystem
        $client = New-JkyClient
        $base = Get-JkyBase
        $fetched = Get-JkySums $client $base
        $sums = $fetched.Text
        $asset = $null; $sha = $null; $label = $script:JkyVersion; $script:ReleaseVersion = ""
        if ($sums) {
            foreach ($line in $sums -split "`r?`n") {
                if ($line -match "^([0-9a-fA-F]{64})\s+\*?(.+_x64-setup\.exe)\s*$") { $sha = $Matches[1].ToLower(); $asset = $Matches[2]; break }
            }
            if ($asset -and $asset -match "_(\d+\.\d+\.\d+[^_]*)_") { $script:ReleaseVersion = $Matches[1]; $label = "v" + $script:ReleaseVersion }
        }

        Hide-JkyCursor
        Write-JkyBanner $label
        WL ""
        WL "  $script:BLD$($script:CYAN)Welcome to JKY Terminal!$script:RST"
        WL "  $($script:TEXT)Installing JKY Terminal - AI terminal. Infinite possibilities.$script:RST"
        Write-JkyChecks $sys

        Write-JkySection "Downloading and installing..."
        if ($fetched.Status -eq "missing") { Stop-Jky "No published release was found." "Looked in: $base`nReleases:  https://github.com/$JkyRepo/releases" }
        if ($fetched.Status -eq "error") { Stop-Jky "GitHub answered with an error ($($fetched.Code))." "It is usually brief: run this again in a minute.`nTried: $base" }
        if (-not $sums) {
            $hint = "Check your internet connection (or proxy), then run this again.`nTried:  $base"
            if ($fetched.Reason) { $hint += "`nReason: $($fetched.Reason)" }
            Stop-Jky "Could not connect to download JKY Terminal." $hint
        }
        if (-not $asset) { Stop-Jky "This release has no Windows installer." "See https://github.com/$JkyRepo/releases" }
        $setup = Join-Path $script:Work $asset
        Save-JkyDownload $client "$base/$asset" $setup "Downloading package"
        $actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
        if ($actual -ne $sha) {
            Remove-Item -Force $setup
            Stop-Jky "The download does not match the release's checksum." "Expected $sha, got $actual. Nothing was installed - try again."
        }
        Write-JkyDone "Verifying checksum" "sha256 $script:OK  $($sha.Substring(0, 4))...$($sha.Substring(60, 4))"
        $p = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru
        # Touched now, or Windows PowerShell 5.1 loses the exit code.
        $null = $p.Handle
        $code = Wait-JkyProcess $p "Installing the app"
        if ($code -ne 0) { Stop-Jky "The installer exited with code $code." "Run it by hand to see why: $setup" }
        $exe = Get-JkyInstalledExe
        if (-not $exe) { Stop-Jky "The app was not found after installing." "Expected it in $env:LOCALAPPDATA\JKY Terminal" }
        Write-JkyDone "Installing the app" (Split-Path $exe)

        Write-JkySection "Setting up JKY Terminal..."
        Invoke-JkyStep "Installing ``jky`` command" (Join-Path $script:BinDir "jky.cmd") { Write-JkyLauncher $exe } | Out-Null
        Invoke-JkyStep "Adding it to your PATH" "for new terminals" { Add-JkyPath } | Out-Null

        if ($want) {
            [void](Set-JkySummon $exe $want)
        } elseif ($script:Tty -and -not [Console]::IsInputRedirected) {
            WL ""
            $choice = Read-JkyShortcutChoice
            [void](Set-JkySummon $exe $choice)
        } else {
            Write-JkyDone "Summon shortcut" "not chosen - set one later with: jky shortcut <keys>"
        }

        Write-JkyFinale
        WL "     $($script:AMBER)Open a new terminal to use jky there.$script:RST"
        WL "     $($script:FAINT)Same terminal. Higher possibilities.$script:RST"
        WL ""
    } finally {
        Show-JkyCursor
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $script:Work
        try { if ($script:OldEncoding) { [Console]::OutputEncoding = $script:OldEncoding } } catch {}
    }
}

if (-not $Lib -and -not $env:JKY_INSTALL_LIB) {
    try {
        Install-Jky
    } catch {
        if ("$_" -notmatch "JKY_INSTALL_FAILED") { Write-Host "  $_" -ForegroundColor Red }
        if ($PSCommandPath) { exit 1 }
    }
}
