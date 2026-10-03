#!/bin/sh
# Tests for install.sh, run in CI on Linux and macOS and by hand:
#
#   sh scripts/install/test-install.sh            # whatever sh is here
#   dash scripts/install/test-install.sh          # Ubuntu's sh
#
# 1. The shortcut rules agree with the app's, case for case.
# 2. A whole install, from a release served on localhost: checksum checked,
#    app installed, `jky` written and working, the shortcut stored through
#    the app and bound with GNOME (a recording stand-in for gsettings).
# 3. A download whose checksum is wrong installs nothing.
# 4. Uninstall removes what was installed and keeps the user's data.
#
# Nothing touches the real home directory: HOME points at a scratch folder.

set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT="$ROOT/install.sh"
CASES="$ROOT/scripts/install/shortcuts.tsv"
failures=0
check() {
    if [ "$2" = "$3" ]; then
        printf '  ok   %s\n' "$1"
    else
        printf '  FAIL %s\n       want: %s\n       got:  %s\n' "$1" "$3" "$2"
        failures=$((failures + 1))
    fi
}

echo "portable to every sh"
# macOS's sh is bash 3.2, which in some locales reads `$MINT│` as one
# variable named `MINT│`. Every expansion followed by a non-ASCII character
# needs braces: `${MINT}│`.
check "no \$NAME runs into a non-ASCII character" \
    "$(LC_ALL=C grep -n "\\\$[A-Za-z_][A-Za-z0-9_]*$(printf '[\200-\377]')" "$SCRIPT")" ""

echo "shortcut rules"
while IFS= read -r line; do
    case "$line" in "#"*) continue ;; esac
    input=$(printf '%s' "$line" | cut -f1)
    expected=$(printf '%s' "$line" | cut -f2)
    got=$(JKY_INSTALL_LIB=1 sh -c '. "$1"; jky_normalize "$2"' _ "$SCRIPT" "$input") || got=ERROR
    check "[$input]" "$got" "$expected"
done <"$CASES"

echo "GNOME accelerators"
for pair in "Super+J=<Super>j" "Ctrl+Alt+Space=<Control><Alt>space" "Shift+Super+T=<Shift><Super>t" "Alt+F12=<Alt>F12"; do
    got=$(JKY_INSTALL_LIB=1 sh -c '. "$1"; jky_gnome_accel "$2"' _ "$SCRIPT" "${pair%%=*}")
    check "${pair%%=*}" "$got" "${pair#*=}"
done

# ─── a fake release, served on localhost ────────────────────────────────────

WORK=$(mktemp -d)
trap 'kill "$SERVER" 2>/dev/null; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/release" "$WORK/home"
OS=$(uname -s)

# The stand-in app records how it was run, and answers --set-shortcut the way
# the real one does (canonical form on stdout, exit 2 for a refusal).
cat >"$WORK/app-main" <<'EOF'
#!/bin/sh
echo "$*" >>"$HOME/app-calls"
if [ "${1:-}" = "--set-shortcut" ]; then
    # A real app can be quiet, or a desktop library can talk before it does.
    if [ -f "$HOME/app-silent" ]; then exit 0; fi
    if [ -f "$HOME/app-noisy" ]; then echo "Gtk-Message: Failed to load module"; fi
    case "$2" in
        none | "") echo none ;;
        ctrl+j) echo "Ctrl on its own would take that key" >&2; exit 2 ;;
        *) echo "$2" ;;
    esac
fi
EOF
chmod +x "$WORK/app-main"

if [ "$OS" = Linux ]; then
    ASSET="JKY.Terminal_9.9.9_amd64.AppImage"
    # An AppImage is an executable that can extract itself; this one can do
    # exactly that and nothing else.
    cat >"$WORK/release/$ASSET" <<EOF
#!/bin/sh
if [ "\${1:-}" = "--appimage-extract" ]; then
    mkdir -p squashfs-root/usr/bin
    cp '$WORK/app-main' squashfs-root/AppRun
    cp '$WORK/app-main' squashfs-root/usr/bin/jky-terminal
    printf 'png' > squashfs-root/jky-terminal.png
    exit 0
fi
exit 1
EOF
else
    ARCH=$(uname -m)
    if [ "$ARCH" = arm64 ]; then ASSET="JKY.Terminal_9.9.9_aarch64.dmg"; else ASSET="JKY.Terminal_9.9.9_x64.dmg"; fi
    mkdir -p "$WORK/dmg/JKY Terminal.app/Contents/MacOS"
    cp "$WORK/app-main" "$WORK/dmg/JKY Terminal.app/Contents/MacOS/jky-terminal"
    cat >"$WORK/dmg/JKY Terminal.app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>jky-terminal</string></dict></plist>
EOF
    hdiutil create -quiet -fs HFS+ -volname "JKY Terminal" -srcfolder "$WORK/dmg" "$WORK/release/$ASSET"
fi
(cd "$WORK/release" && if command -v sha256sum >/dev/null; then sha256sum "$ASSET"; else shasum -a 256 "$ASSET"; fi) >"$WORK/release/SHA256SUMS"
cp "$SCRIPT" "$WORK/release/install.sh"

PORT=$((20000 + $$ % 20000))
(cd "$WORK/release" && exec python3 -m http.server "$PORT" --bind 127.0.0.1) >/dev/null 2>&1 &
SERVER=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fs "http://127.0.0.1:$PORT/SHA256SUMS" >/dev/null 2>&1 && break
    sleep 0.3
done

# gsettings, recorded rather than applied, with GNOME's media-keys schema.
mkdir -p "$WORK/fakebin"
cat >"$WORK/fakebin/gsettings" <<'EOF'
#!/bin/sh
echo "$*" >>"$HOME/gsettings-calls"
case "$1" in
    list-keys) echo custom-keybindings ;;
    get) cat "$HOME/gsettings-list" 2>/dev/null || echo "@as []" ;;
    set) if [ "$3" = custom-keybindings ]; then echo "$4" >"$HOME/gsettings-list"; fi ;;
esac
EOF
chmod +x "$WORK/fakebin/gsettings"
# ldd, reporting a graphics library missing when asked to: a server, or a
# minimal install, can lack what every desktop has.
cat >"$WORK/fakebin/ldd" <<'EOF'
#!/bin/sh
if [ -f "$HOME/missing-libs" ]; then printf '\tlibEGL.so.1 => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n'; fi
EOF
chmod +x "$WORK/fakebin/ldd"
# ldconfig's view of the graphics libraries WebKit loads at run time, which
# ldd cannot see — present, unless asked to be missing.
cat >"$WORK/fakebin/ldconfig" <<'EOF'
#!/bin/sh
printf '\tlibc.so.6 (libc6,x86-64) => /usr/lib/libc.so.6\n'
if [ ! -f "$HOME/missing-gles" ]; then
    printf '\tlibGLESv2.so.2 (libc6,x86-64) => /usr/lib/libGLESv2.so.2\n\tlibGL.so.1 (libc6,x86-64) => /usr/lib/libGL.so.1\n'
fi
EOF
chmod +x "$WORK/fakebin/ldconfig"

# Every run starts from an empty environment: only a scratch HOME, a PATH
# with the stand-ins first, and nothing of the real user's — no XDG folders,
# no real home — so no test can reach a real file.
BASEPATH="$WORK/fakebin:/usr/bin:/bin:/usr/sbin:/sbin"
in_scratch() {
    h=$1
    shift
    env -i HOME="$h" PATH="$BASEPATH" SHELL=/bin/bash LANG=C.UTF-8 "$@"
}
run_installer() {
    in_scratch "$WORK/home" JKY_RELEASE_BASE="http://127.0.0.1:$PORT" sh "$SCRIPT" "$@"
}
# Exactly what a person pastes: the script arrives on stdin and has no file of
# its own, so the copy kept for `jky shortcut` and `jky uninstall` is fetched.
run_piped() {
    curl -fsSL "http://127.0.0.1:$PORT/install.sh" |
        in_scratch "$WORK/home" JKY_RELEASE_BASE="http://127.0.0.1:$PORT" \
            JKY_SCRIPT_URL="http://127.0.0.1:$PORT/install.sh" sh -s -- "$@"
}
jky() {
    in_scratch "$WORK/home" "$WORK/home/.local/bin/jky" "$@"
}

if [ "$OS" = Linux ]; then
    INSTALLED_HOME="$WORK/home/.local/share/jky-terminal"
    RC="$WORK/home/.bashrc"
else
    INSTALLED_HOME="$WORK/home/Library/Application Support/JKY Terminal Installer"
    # A login shell on a Mac reads .bash_profile, not .bashrc.
    RC="$WORK/home/.bash_profile"
fi
# Dotfiles are often symlinks into a repository; they must stay that way.
mkdir -p "$WORK/dotfiles"
echo "# mine" >"$WORK/dotfiles/rc"
ln -s "$WORK/dotfiles/rc" "$RC"

echo "a whole install, piped from curl as a person pastes it"
run_piped --shortcut "cmd+j" >"$WORK/first.out" 2>&1
check "the installer succeeds" "$?" "0"
output=$(cat "$WORK/first.out")
if [ "$OS" = Linux ]; then
    check "the app is extracted" "$(test -x "$WORK/home/.local/share/jky-terminal/app/AppRun" && echo yes)" "yes"
    check "an apps-menu entry is written" \
        "$(grep -c 'Exec="'"$WORK/home/.local/bin/jky"'"' "$WORK/home/.local/share/applications/jky-terminal.desktop")" "1"
    check "the shortcut is bound with GNOME" "$(grep -c 'binding <Super>j' "$WORK/home/gsettings-calls")" "1"
    check "the GNOME binding runs jky" "$(grep -c "command $WORK/home/.local/bin/jky" "$WORK/home/gsettings-calls")" "1"
    check "the binding is listed once" "$(cat "$WORK/home/gsettings-list")" \
        "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/jky-terminal/']"
else
    check "the app is installed" "$(test -x "$WORK/home/Applications/JKY Terminal.app/Contents/MacOS/jky-terminal" && echo yes)" "yes"
fi
check "the shortcut is stored through the app" "$(grep -c -- '--set-shortcut Super+J' "$WORK/home/app-calls")" "1"
check "jky is installed" "$(test -x "$WORK/home/.local/bin/jky" && echo yes)" "yes"
check "jky knows its version" "$(jky version)" "9.9.9"
check "jky is put on PATH for new terminals" "$(grep -c 'Added by the JKY Terminal installer' "$RC" 2>/dev/null)" "1"
check "the output says it is complete" "$(printf '%s' "$output" | grep -c 'Installation complete')" "1"
check "a copy is kept for jky shortcut and uninstall" "$(grep -q JKY_INSTALLER_MARKER "$INSTALLED_HOME/install.sh" 2>/dev/null && echo kept)" "kept"
check "plain output when not a terminal" "$(printf '%s' "$output" | grep -c "$(printf '\033')")" "0"

echo "installing again, from a saved copy"
run_installer --shortcut none </dev/null >"$WORK/second.out" 2>&1
check "a second install succeeds" "$?" "0"
check "PATH is added once, not twice" "$(grep -c 'Added by the JKY Terminal installer' "$RC" 2>/dev/null)" "1"
check "no stray shell errors" "$(grep -c -E '/dev/tty|unbound variable|not found|No such' "$WORK/first.out" "$WORK/second.out" 2>/dev/null | awk -F: '{n += $NF} END {print n}')" "0"
if [ "$OS" = Linux ]; then
    check "choosing none removes the GNOME binding" "$(cat "$WORK/home/gsettings-list")" "@as []"
fi

echo "jky opens the app, and changes the shortcut"
jky >/dev/null 2>&1
sleep 1
if [ "$OS" = Linux ]; then
    check "jky starts the app" "$(tail -1 "$WORK/home/app-calls")" ""
fi
jky shortcut "ctrl+alt+k" </dev/null >/dev/null 2>&1
check "jky shortcut stores the new one" "$(grep -c -- '--set-shortcut Ctrl+Alt+K' "$WORK/home/app-calls")" "1"

echo "an app that talks first, or says nothing"
touch "$WORK/home/app-noisy"
jky shortcut "ctrl+alt+n" </dev/null >"$WORK/noisy" 2>&1
rm -f "$WORK/home/app-noisy"
check "the shortcut is its last line" "$(grep -c 'Summon shortcut .*+ N ' "$WORK/noisy")" "1"
check "the library's chatter is not shown as the shortcut" "$(grep -c 'Gtk-Message' "$WORK/noisy")" "0"
touch "$WORK/home/app-silent"
jky shortcut "ctrl+alt+m" </dev/null >"$WORK/silent" 2>&1
check "silence after success is what was asked for" "$?" "0"
rm -f "$WORK/home/app-silent"
check "and it says so" "$(grep -c 'Summon shortcut .*+ M ' "$WORK/silent")" "1"

echo "a refused shortcut"
jky shortcut "ctrl+j" </dev/null >"$WORK/refused" 2>&1
check "it is refused, with the reason" "$(grep -c 'not a shortcut JKY can use' "$WORK/refused")" "1"
check "nothing new was stored" "$(grep -c -- '--set-shortcut ctrl' "$WORK/home/app-calls")" "0"

if [ "$OS" = Linux ]; then
    echo "a system without the libraries a desktop has"
    rm -rf "$WORK/home4"
    mkdir -p "$WORK/home4"
    touch "$WORK/home4/missing-libs"
    in_scratch "$WORK/home4" JKY_RELEASE_BASE="http://127.0.0.1:$PORT" sh "$SCRIPT" --shortcut none </dev/null >"$WORK/nolibs" 2>&1
    check "the installer stops" "$?" "1"
    check "it says libraries are missing" "$(grep -c 'needs libraries this system does not have' "$WORK/nolibs")" "1"
    check "it names them" "$(grep -c 'Missing: libEGL.so.1$' "$WORK/nolibs")" "1"
    check "it never claims to be complete" "$(grep -c 'Installation complete' "$WORK/nolibs")" "0"
    rm -f "$WORK/home4/missing-libs"
    touch "$WORK/home4/missing-gles"
    in_scratch "$WORK/home4" JKY_RELEASE_BASE="http://127.0.0.1:$PORT" sh "$SCRIPT" --shortcut none </dev/null >"$WORK/nogles" 2>&1
    check "a library loaded at run time counts too" "$?:$(grep -c 'Missing: libGL.so.1 libGLESv2.so.2$' "$WORK/nogles")" "1:1"
    check "it leaves nothing half-installed" \
        "$(test -e "$WORK/home4/.local/share/jky-terminal/app" || test -e "$WORK/home4/.local/bin/jky" && echo left || echo nothing)" "nothing"
fi

echo "a tampered download"
printf 'tampered' >>"$WORK/release/$ASSET"
rm -rf "$WORK/home2"
mkdir -p "$WORK/home2"
in_scratch "$WORK/home2" JKY_RELEASE_BASE="http://127.0.0.1:$PORT" sh "$SCRIPT" --shortcut none </dev/null >"$WORK/tampered" 2>&1
check "the installer refuses it" "$?" "1"
check "it says why" "$(grep -c 'checksum' "$WORK/tampered")" "1"
check "nothing is installed" "$(test -e "$WORK/home2/.local/bin/jky" && echo installed || echo nothing)" "nothing"

echo "no release, and no connection"
rm -rf "$WORK/home3"
mkdir -p "$WORK/home3"
in_scratch "$WORK/home3" JKY_RELEASE_BASE="http://127.0.0.1:$PORT/nothing-here" sh "$SCRIPT" </dev/null >"$WORK/missing" 2>&1
check "a missing release stops the installer" "$?" "1"
check "it says no release is published" "$(grep -c 'No published release was found' "$WORK/missing")" "1"
check "where it looked is a line of its own" "$(grep -c "Looked in: http://127.0.0.1:$PORT/nothing-here\$" "$WORK/missing")" "1"
check "the releases page is a line of its own" "$(grep -c '^ *Releases: *https://github.com/kartikeyajay2006/jky-terminal/releases$' "$WORK/missing")" "1"
in_scratch "$WORK/home3" JKY_RELEASE_BASE="http://127.0.0.1:9" sh "$SCRIPT" </dev/null >"$WORK/offline" 2>&1
check "no connection stops the installer" "$?" "1"
check "it says it could not connect, not that there is no release" \
    "$(grep -c 'Could not connect' "$WORK/offline"):$(grep -c 'No published release' "$WORK/offline")" "1:0"
check "and nothing was installed" "$(test -e "$WORK/home3/.local/bin/jky" && echo installed || echo nothing)" "nothing"

echo "uninstall"
mkdir -p "$WORK/home/.config/dev.jky.terminal" "$WORK/home/Library/Application Support/dev.jky.terminal"
jky uninstall >/dev/null 2>&1
check "jky is removed" "$(test -e "$WORK/home/.local/bin/jky" && echo still || echo gone)" "gone"
check "the PATH line is removed" "$(grep -c 'Added by the JKY Terminal installer' "$RC" 2>/dev/null)" "0"
check "the shell's own file is still a symlink" "$(test -L "$RC" && cat "$RC")" "# mine"
if [ "$OS" = Linux ]; then
    check "the app is removed" "$(test -e "$WORK/home/.local/share/jky-terminal" && echo still || echo gone)" "gone"
    check "your data is kept" "$(test -d "$WORK/home/.config/dev.jky.terminal" && echo kept)" "kept"
else
    check "the app is removed" "$(test -e "$WORK/home/Applications/JKY Terminal.app" && echo still || echo gone)" "gone"
fi

echo
if [ "$failures" -gt 0 ]; then
    for f in first second; do
        if [ -f "$WORK/$f.out" ]; then printf '\n--- the %s install said:\n' "$f"; cat "$WORK/$f.out"; fi
    done
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
