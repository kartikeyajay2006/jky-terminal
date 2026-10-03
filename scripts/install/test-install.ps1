# Tests for install.ps1, run in CI on Windows under Windows PowerShell 5.1 and
# PowerShell 7:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install\test-install.ps1
#   pwsh -NoProfile -File scripts\install\test-install.ps1
#
# 1. The shortcut rules agree with the app's, case for case.
# 2. A whole install from a release served on localhost, through the same
#    `irm | iex` a person pastes: checksum checked, a stand-in for Tauri's
#    NSIS installer run silently, `jky` written and working, the shortcut
#    stored through the app and set on the Start-menu shortcut.
# 3. A download whose checksum is wrong installs nothing.
# 4. `jky uninstall` removes what was installed and keeps the user's data.
#
# LOCALAPPDATA and APPDATA point at a scratch folder for the whole run. The
# user PATH and one HKCU uninstall key are real, and are put back at the end.

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Script = Join-Path $Root "install.ps1"
$failures = 0
function Check([string]$what, $got, $want) {
    if ("$got" -ceq "$want") { Write-Host "  ok   $what" }
    else { Write-Host "  FAIL $what`n       want: $want`n       got:  $got"; $script:failures++ }
}

Write-Host "shortcut rules"
$env:JKY_INSTALL_LIB = "1"
. $Script -Lib
Remove-Item Env:JKY_INSTALL_LIB
foreach ($line in Get-Content (Join-Path $Root "scripts\install\shortcuts.tsv")) {
    if ($line.StartsWith("#")) { continue }
    $parts = $line.Split("`t")
    $got = ConvertTo-JkyShortcut $parts[0]
    if (-not $got) { $got = "ERROR" }
    Check "[$($parts[0])]" $got $parts[1]
}
Check "Start-menu hotkey for Ctrl+Alt+J" (ConvertTo-JkyLinkHotkey "Ctrl+Alt+J") "CTRL+ALT+J"
Check "no Start-menu hotkey for Win+J" ([string](ConvertTo-JkyLinkHotkey "Super+J")) ""

# --- a fake release, served on localhost -----------------------------------

$Work = Join-Path ([IO.Path]::GetTempPath()) ("jky-install-test-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$Release = Join-Path $Work "release"
New-Item -ItemType Directory -Force -Path $Release, (Join-Path $Work "local"), (Join-Path $Work "roaming") | Out-Null
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$Log = Join-Path $Work "app-calls.txt"

# The stand-in app records how it was run and answers --set-shortcut the way
# the real one does.
Set-Content -Encoding ASCII (Join-Path $Work "app.cs") @'
using System; using System.IO;
class App { static int Main(string[] a) {
    File.AppendAllText(Environment.GetEnvironmentVariable("JKY_TEST_LOG"), string.Join(" ", a) + "\n");
    if (a.Length >= 1 && a[0] == "--set-shortcut") { Console.WriteLine(a.Length > 1 ? a[1] : "none"); }
    return 0; } }
'@
# The stand-in for Tauri's NSIS installer: the same folder, the same
# executable name, the same HKCU uninstall key.
Set-Content -Encoding ASCII (Join-Path $Work "setup.cs") @'
using System; using System.IO; using Microsoft.Win32;
class Setup { static int Main(string[] a) {
    string dir = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"), "JKY Terminal");
    Directory.CreateDirectory(dir);
    string exe = Path.Combine(dir, "jky-terminal.exe");
    File.Copy(Environment.GetEnvironmentVariable("JKY_TEST_APP"), exe, true);
    File.Copy(Environment.GetEnvironmentVariable("JKY_TEST_UNINSTALLER"), Path.Combine(dir, "uninstall.exe"), true);
    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JKY Terminal")) {
        k.SetValue("DisplayName", "JKY Terminal");
        k.SetValue("DisplayIcon", "\"" + exe + "\"");
        k.SetValue("InstallLocation", "\"" + dir + "\"");
        k.SetValue("UninstallString", "\"" + Path.Combine(dir, "uninstall.exe") + "\"");
    }
    return 0; } }
'@
Set-Content -Encoding ASCII (Join-Path $Work "uninstall.cs") @'
using System; using System.IO; using Microsoft.Win32;
class Uninstall { static int Main(string[] a) {
    string dir = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"), "JKY Terminal");
    File.Delete(Path.Combine(dir, "jky-terminal.exe"));
    Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JKY Terminal", false);
    return 0; } }
'@
foreach ($n in "app", "setup", "uninstall") {
    & $csc /nologo /target:exe "/out:$(Join-Path $Work "$n.exe")" (Join-Path $Work "$n.cs") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not compile $n" }
}
$Asset = "JKY.Terminal_9.9.9_x64-setup.exe"
Copy-Item (Join-Path $Work "setup.exe") (Join-Path $Release $Asset)
$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $Release $Asset)).Hash.ToLower()
Set-Content -Encoding ASCII (Join-Path $Release "SHA256SUMS") "$hash  $Asset"
Copy-Item $Script (Join-Path $Release "install.ps1")

$port = 20000 + (Get-Random -Maximum 20000)
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command python3).Source }
$server = Start-Process -FilePath $python -ArgumentList @("-m", "http.server", "$port", "--bind", "127.0.0.1", "--directory", $Release) -PassThru -WindowStyle Hidden
for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/SHA256SUMS" | Out-Null; break } catch { Start-Sleep -Milliseconds 300 }
}

$savedPath = [Environment]::GetEnvironmentVariable("Path", "User")
$savedLocal = $env:LOCALAPPDATA; $savedRoaming = $env:APPDATA
function Use-Scratch([string]$name) {
    $env:LOCALAPPDATA = Join-Path $Work "$name\local"; $env:APPDATA = Join-Path $Work "$name\roaming"
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") | Out-Null
}
$env:JKY_TEST_APP = Join-Path $Work "app.exe"
$env:JKY_TEST_UNINSTALLER = Join-Path $Work "uninstall.exe"
$env:JKY_TEST_LOG = $Log
$env:JKY_RELEASE_BASE = "http://127.0.0.1:$port"
# The copy kept for `jky shortcut` and `jky uninstall` is this one, not main's.
$env:JKY_SCRIPT_URL = "http://127.0.0.1:$port/install.ps1"
$hosts = @()
if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { $hosts += "powershell.exe" }
if (Get-Command pwsh -ErrorAction SilentlyContinue) { $hosts += "pwsh" }

try {
    foreach ($shell in $hosts) {
        Write-Host "a whole install, pasted into $shell"
        Use-Scratch $shell
        Remove-Item -Force -ErrorAction SilentlyContinue $Log
        # What NSIS leaves in the Start menu, so the hotkey has somewhere to go.
        $lnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\JKY Terminal.lnk"
        $ws = New-Object -ComObject WScript.Shell
        $s = $ws.CreateShortcut($lnk); $s.TargetPath = $env:JKY_TEST_APP; $s.Save()

        $env:JKY_SHORTCUT = "ctrl alt j"
        $out = & $shell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "irm http://127.0.0.1:$port/install.ps1 | iex; Write-Output 'STILL-HERE'" 2>&1 | Out-String
        Remove-Item Env:JKY_SHORTCUT
        Check "the session survives the installer (iex never exits it)" ($out -match "STILL-HERE") $true
        Check "it says it is complete" ($out -match "Installation complete") $true
        $bin = Join-Path $env:LOCALAPPDATA "JKY Terminal Installer\bin"
        Check "the app is installed" (Test-Path (Join-Path $env:LOCALAPPDATA "JKY Terminal\jky-terminal.exe")) $true
        Check "jky.cmd is written" (Test-Path (Join-Path $bin "jky.cmd")) $true
        Check "the shortcut is stored through the app" ((Get-Content $Log -Raw) -match "--set-shortcut Ctrl\+Alt\+J") $true
        $hk = $ws.CreateShortcut($lnk).Hotkey
        Check "the Start-menu shortcut carries the hotkey" ($hk -match "Ctrl" -and $hk -match "Alt" -and $hk -match "J") $true
        Check "the user PATH gains the jky folder" (([Environment]::GetEnvironmentVariable("Path", "User")).Split(";") -contains $bin) $true
        Check "jky version" ((& cmd /c "`"$bin\jky.cmd`" version").Trim()) "9.9.9"
        & cmd /c "`"$bin\jky.cmd`" shortcut Win+J" | Out-Null
        Check "jky shortcut stores a new one" ((Get-Content $Log -Raw) -match "--set-shortcut Super\+J") $true
        Check "Win+J clears the Start-menu hotkey it cannot hold" ([string]$ws.CreateShortcut($lnk).Hotkey) ""

        Write-Host "uninstall, in $shell"
        New-Item -ItemType Directory -Force -Path (Join-Path $env:APPDATA "dev.jky.terminal") | Out-Null
        $said = & cmd /c "`"$bin\jky.cmd`" uninstall" 2>&1 | Out-String
        Check "it finishes cleanly, though it deletes itself" ($said -match "cannot find|cannot be found") $false
        Check "the app is removed" (Test-Path (Join-Path $env:LOCALAPPDATA "JKY Terminal\jky-terminal.exe")) $false
        Check "jky is removed" (Test-Path $bin) $false
        Check "the PATH entry is removed" (([Environment]::GetEnvironmentVariable("Path", "User")).Split(";") -contains $bin) $false
        Check "your data is kept" (Test-Path (Join-Path $env:APPDATA "dev.jky.terminal")) $true
    }

    Write-Host "a tampered download"
    Use-Scratch "tampered"
    Add-Content -Path (Join-Path $Release $Asset) -Value "tampered"
    $out = & $hosts[0] -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Script 2>&1 | Out-String
    Check "the installer refuses it" $LASTEXITCODE 1
    Check "it says why" ($out -match "checksum") $true
    Check "nothing is installed" (Test-Path (Join-Path $env:LOCALAPPDATA "JKY Terminal")) $false
} finally {
    [Environment]::SetEnvironmentVariable("Path", $savedPath, "User")
    $env:LOCALAPPDATA = $savedLocal; $env:APPDATA = $savedRoaming
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JKY Terminal"
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Work
}

Write-Host ""
if ($failures -gt 0) { Write-Host "$failures check(s) failed"; exit 1 }
Write-Host "all checks passed"
# The tampered install left $LASTEXITCODE at 1, and a CI runner reports that.
exit 0
