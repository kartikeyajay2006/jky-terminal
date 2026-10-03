#!/bin/sh
# JKY Terminal installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/kartikeyajay2006/jky-terminal/main/install.sh | sh
#
# Downloads the latest release for this machine, checks it against the
# release's SHA256SUMS, installs it for this user — no root, no sudo — and
# adds a `jky` command that opens JKY Terminal from any terminal. It then
# offers a shortcut that summons JKY from anywhere, and stores the choice in
# JKY's own settings so it is never asked again.
#
# Options, after `sh -s --` when piped:
#   --version vX.Y.Z      install that release rather than the latest
#   --shortcut "Super+J"  choose the shortcut without being asked ("none" for none)
#   --no-animation        plain output
#   --uninstall           remove JKY Terminal (your data is kept)
#   --help
#
# The same through the environment: JKY_VERSION, JKY_SHORTCUT,
# JKY_NO_ANIMATION=1, NO_COLOR. Where it installs: JKY_INSTALL_DIR (the app)
# and JKY_BIN_DIR (the `jky` command, ~/.local/bin by default).
#
# Everything is inside functions and `main` runs on the last line, so a
# download cut off half way runs nothing at all.
#
# JKY_INSTALLER_MARKER

set -u

JKY_REPO="kartikeyajay2006/jky-terminal"
JKY_SCRIPT_URL=${JKY_SCRIPT_URL:-"https://raw.githubusercontent.com/${JKY_REPO}/main/install.sh"}

# ─── output ──────────────────────────────────────────────────────────────────

jky_setup_output() {
    JKY_TTY=0
    if [ -t 1 ]; then JKY_TTY=1; fi
    JKY_COLOR=$JKY_TTY
    if [ -n "${NO_COLOR:-}" ] || [ "${TERM:-}" = "dumb" ]; then JKY_COLOR=0; fi
    JKY_ANIM=$JKY_COLOR
    if [ -n "${JKY_NO_ANIMATION:-}" ]; then JKY_ANIM=0; fi
    case "${COLORTERM:-}" in truecolor | 24bit) JKY_TRUE=1 ;; *) JKY_TRUE=0 ;; esac
    JKY_ESC=$(printf '\033')
    JKY_EL=""
    if [ "$JKY_TTY" = 1 ]; then JKY_EL="${JKY_ESC}[K"; fi
    JKY_COLS=$(jky_columns)
    # Box-drawing and block characters need a UTF-8 terminal.
    case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
        *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) JKY_UTF8=1 ;;
        *) if [ "$(uname -s)" = Darwin ]; then JKY_UTF8=1; else JKY_UTF8=0; fi ;;
    esac
    if [ "$JKY_COLOR" = 1 ]; then
        RST="${JKY_ESC}[0m"
        BLD="${JKY_ESC}[1m"
        CYAN=$(jky_rgb 0 229 255)
        BLUE=$(jky_rgb 56 189 248)
        VIOLET=$(jky_rgb 189 147 249)
        MINT=$(jky_rgb 61 220 151)
        AMBER=$(jky_rgb 255 179 64)
        RED=$(jky_rgb 255 77 106)
        TEXT=$(jky_rgb 232 232 240)
        MUTED=$(jky_rgb 154 154 178)
        FAINT=$(jky_rgb 90 90 112)
    else
        RST="" BLD="" CYAN="" BLUE="" VIOLET="" MINT="" AMBER="" RED="" TEXT="" MUTED="" FAINT=""
    fi
    if [ "$JKY_UTF8" = 1 ]; then
        OK="✓" BAD="✗" DOT="◆" ARROW="❯" FULL="█" EMPTY="░" STAR="✦"
    else
        OK="+" BAD="x" DOT="*" ARROW=">" FULL="#" EMPTY="." STAR="*"
    fi
}

jky_columns() {
    c=$(stty size 2>/dev/null </dev/tty | awk '{print $2}')
    if [ -z "$c" ]; then c=$(tput cols 2>/dev/null || echo 80); fi
    case "$c" in '' | *[!0-9]*) c=80 ;; esac
    echo "$c"
}

# A colour, as 24-bit where the terminal says it can, 256-colour otherwise.
jky_rgb() {
    if [ "$JKY_TRUE" = 1 ]; then
        printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"
    else
        printf '\033[38;5;%dm' $((16 + 36 * ($1 * 5 / 255) + 6 * ($2 * 5 / 255) + $3 * 5 / 255))
    fi
}

# Cyan → violet, step $1 of $2: the gradient everything is drawn in.
jky_grad() {
    if [ "$JKY_COLOR" != 1 ]; then return; fi
    jky_rgb $((189 * $1 / $2)) $((229 - 82 * $1 / $2)) $((255 - 6 * $1 / $2))
}

jky_pause() { if [ "$JKY_ANIM" = 1 ]; then sleep "$1"; fi; }
jky_hide_cursor() { if [ "$JKY_TTY" = 1 ]; then printf '\033[?25l'; fi; }
jky_show_cursor() { if [ "$JKY_TTY" = 1 ]; then printf '\033[?25h'; fi; }
jky_clear_line() { if [ "$JKY_TTY" = 1 ]; then printf '\r\033[K'; else printf '\n'; fi; }

jky_section() { printf '\n  %s%s%s  %s%s%s\n' "$CYAN" "$DOT" "$RST" "$BLD$TEXT" "$1" "$RST"; }
jky_done() { printf '     %s%s%s %-26s %s%s%s\n' "$MINT" "$OK" "$RST" "$1" "$MUTED" "$2" "$RST"; }
jky_fail() {
    jky_show_cursor
    printf '\n     %s%s %s%s\n' "$RED" "$BAD" "$1" "$RST" >&2
    # The hint may be several lines; each is indented, so a long link is a
    # line of its own and never wraps into the next sentence.
    if [ -n "${2:-}" ]; then
        printf '%s\n' "$2" | while IFS= read -r hint; do printf '       %s%s%s\n' "$MUTED" "$hint" "$RST"; done >&2
    fi
    printf '\n' >&2
    exit 1
}

# Run a step with a spinner beside its name, then mark it done.
#   jky_step "Label" "detail when done" command args...
jky_step() {
    step_label=$1 step_detail=$2
    shift 2
    if [ "$JKY_ANIM" = 1 ]; then
        "$@" >"$JKY_WORK/step.log" 2>&1 &
        step_pid=$!
        step_i=0
        while kill -0 "$step_pid" 2>/dev/null; do
            jky_spinner_frame "$step_label" "$step_i"
            step_i=$((step_i + 1))
            sleep 0.08
        done
        wait "$step_pid"
        step_status=$?
        jky_clear_line
    else
        "$@" >"$JKY_WORK/step.log" 2>&1
        step_status=$?
    fi
    if [ "$step_status" != 0 ]; then
        jky_fail "$step_label failed" "$(tail -3 "$JKY_WORK/step.log" 2>/dev/null)"
    fi
    jky_done "$step_label" "$step_detail"
}

jky_spinner_frame() {
    if [ "$JKY_UTF8" = 1 ]; then
        case $(($2 % 10)) in
            0) f="⠋" ;; 1) f="⠙" ;; 2) f="⠹" ;; 3) f="⠸" ;; 4) f="⠼" ;;
            5) f="⠴" ;; 6) f="⠦" ;; 7) f="⠧" ;; 8) f="⠇" ;; *) f="⠏" ;;
        esac
    else
        case $(($2 % 4)) in 0) f="|" ;; 1) f="/" ;; 2) f="-" ;; *) f="\\" ;; esac
    fi
    printf '\r     %s%s%s %s%s%s' "$(jky_grad $(($2 % 12)) 12)" "$f" "$RST" "$TEXT" "$1" "$RST"
}

# ─── the banner ──────────────────────────────────────────────────────────────

jky_banner() {
    version_label=$1
    if [ "$JKY_UTF8" != 1 ]; then
        printf '\n  %sJKY TERMINAL%s  %s%s%s\n  AI terminal. Infinite possibilities.\n' "$BLD$CYAN" "$RST" "$MUTED" "$version_label" "$RST"
        return
    fi
    printf '\n'
    jky_banner_rows 0 0.04
    # Once revealed, a wave of colour runs through the letters and settles.
    if [ "$JKY_ANIM" = 1 ]; then
        wave=1
        while [ $wave -le 10 ]; do
            printf '\033[6A'
            jky_banner_rows "$wave" 0
            sleep 0.05
            wave=$((wave + 1))
        done
        printf '\033[6A'
        jky_banner_rows 0 0
    fi
}

# The six rows of the banner. $1 shifts the gradient (the wave), $2 is the
# pause after each row (the reveal).
jky_banner_rows() {
    shift_by=$1
    row_pause=$2
    # J, K and Y, row by row: each letter its own step along the gradient,
    # each row a step further, so the block reads cyan to violet diagonally.
    set -- \
        "     ██╗" "██╗  ██╗" "██╗   ██╗" \
        "     ██║" "██║ ██╔╝" "╚██╗ ██╔╝" \
        "     ██║" "█████╔╝ " " ╚████╔╝ " \
        "██   ██║" "██╔═██╗ " "  ╚██╔╝  " \
        "╚█████╔╝" "██║  ██╗" "   ██║   " \
        " ╚════╝ " "╚═╝  ╚═╝" "   ╚═╝   "
    wide=0
    if [ "$JKY_COLS" -ge 108 ]; then wide=1; fi
    row=0
    while [ "$row" -lt 6 ]; do
        j=$1 k=$2 y=$3
        shift 3
        printf '  %s%s %s%s %s%s%s' \
            "$(jky_grad $(((row + shift_by) % 10)) 9)$BLD" "$j" "$(jky_grad $(((row + 2 + shift_by) % 10)) 9)" "$k" \
            "$(jky_grad $(((row + 4 + shift_by) % 10)) 9)" "$y" "$RST"
        # Every row is 29 columns of letters, plus what follows them.
        used=29
        case $row in
            1)
                printf '     %s%sT E R M I N A L%s  %s[%s]%s' "$BLD" "$(jky_grad 2 9)" "$RST" "$VIOLET" "$version_label" "$RST"
                used=$((29 + 5 + 15 + 2 + ${#version_label} + 2)) ;;
            3)
                printf '     %sAI terminal. Infinite %spossibilities.%s' "$TEXT" "$VIOLET" "$RST"
                used=$((29 + 5 + 36)) ;;
        esac
        if [ "$wide" = 1 ] && [ "$row" -lt 5 ]; then
            case $row in
                0) feature="AI-POWERED TERMINAL" ;;
                1) feature="GLOBAL SUMMON" ;;
                2) feature="WORKS EVERYWHERE" ;;
                3) feature="BUILT FOR DEVELOPERS" ;;
                *) feature="INFINITE POSSIBILITIES" ;;
            esac
            printf '%*s%s│%s %s>%s %s%s%s' $((80 - used)) "" "$FAINT" "$RST" "$(jky_grad "$row" 5)" "$RST" "$MUTED" "$feature" "$RST"
        fi
        printf '%s\n' "$JKY_EL"
        if [ "$row_pause" != 0 ]; then jky_pause "$row_pause"; fi
        row=$((row + 1))
    done
}

# ─── what this machine is ────────────────────────────────────────────────────

jky_detect() {
    JKY_OS=$(uname -s)
    JKY_ARCH=$(uname -m)
    case "$JKY_OS" in
        Linux)
            JKY_PLATFORM=linux
            # shellcheck source=/dev/null
            JKY_OS_NAME=$( (. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}") || echo Linux)
            ;;
        Darwin)
            JKY_PLATFORM=mac
            mac_version=$(sw_vers -productVersion 2>/dev/null || echo "")
            case "$mac_version" in
                26*) mac_name=Tahoe ;; 15*) mac_name=Sequoia ;; 14*) mac_name=Sonoma ;;
                13*) mac_name=Ventura ;; 12*) mac_name=Monterey ;; 11*) mac_name="Big Sur" ;;
                10.15*) mac_name=Catalina ;; *) mac_name="" ;;
            esac
            JKY_OS_NAME="macOS $mac_version${mac_name:+ ($mac_name)}"
            ;;
        *) jky_fail "This installer is for macOS and Linux." \
            "On Windows, run in PowerShell:  irm https://raw.githubusercontent.com/${JKY_REPO}/main/install.ps1 | iex" ;;
    esac
    case "$JKY_ARCH" in
        x86_64 | amd64) JKY_ARCH=x86_64 ;;
        arm64 | aarch64) JKY_ARCH=arm64 ;;
        *) jky_fail "JKY Terminal is not built for $JKY_ARCH." "Builds exist for x86_64 and Apple Silicon." ;;
    esac
    if [ "$JKY_PLATFORM" = linux ] && [ "$JKY_ARCH" = arm64 ]; then
        jky_fail "JKY Terminal is not built for Linux on ARM yet." \
            "Build it from source: https://github.com/${JKY_REPO}/blob/main/docs/getting-started.md"
    fi
    if [ "$JKY_PLATFORM" = mac ]; then
        mac_major=$(echo "${mac_version:-0}" | cut -d. -f1)
        mac_minor=$(echo "${mac_version:-0}" | cut -d. -f2)
        if [ "${mac_major:-0}" -lt 10 ] || { [ "${mac_major:-0}" -eq 10 ] && [ "${mac_minor:-0}" -lt 15 ]; }; then
            jky_fail "JKY Terminal needs macOS 10.15 or newer." "This Mac runs $JKY_OS_NAME."
        fi
    fi
    if command -v curl >/dev/null 2>&1; then JKY_FETCH=curl
    elif command -v wget >/dev/null 2>&1; then JKY_FETCH=wget
    else jky_fail "Neither curl nor wget is installed." "Install one, then run this again."
    fi
    if command -v sha256sum >/dev/null 2>&1; then JKY_SHA="sha256sum"
    elif command -v shasum >/dev/null 2>&1; then JKY_SHA="shasum -a 256"
    else jky_fail "No SHA-256 tool (sha256sum or shasum) is installed." "It is needed to check the download."
    fi
}

jky_check_system() {
    jky_section "Checking your system..."
    jky_check_line "Operating system" "$JKY_OS_NAME"
    jky_check_line "Architecture" "$JKY_ARCH"
    jky_check_line "Compatibility" "JKY Terminal runs on macOS, Linux and Windows."
}

jky_check_line() {
    if [ "$JKY_ANIM" = 1 ]; then
        i=0
        while [ $i -lt 5 ]; do
            jky_spinner_frame "$1..." "$i"
            sleep 0.05
            i=$((i + 1))
        done
        jky_clear_line
    fi
    jky_done "$1" "$2"
}

# ─── download ────────────────────────────────────────────────────────────────

jky_base_url() {
    if [ -n "${JKY_RELEASE_BASE:-}" ]; then
        echo "${JKY_RELEASE_BASE%/}"
    elif [ "$JKY_VERSION" = latest ]; then
        echo "https://github.com/${JKY_REPO}/releases/latest/download"
    else
        echo "https://github.com/${JKY_REPO}/releases/download/${JKY_VERSION}"
    fi
}

jky_get() {
    if [ "$JKY_FETCH" = curl ]; then curl -fsSL --retry 2 "$1" -o "$2"; else wget -q -O "$2" "$1"; fi
}

jky_size_of() {
    if [ "$JKY_FETCH" = curl ]; then
        curl -fsIL "$1" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:" {n=$2} END {print n+0}'
    else
        echo 0
    fi
}

# The asset for this machine, named as SHA256SUMS lists it, with its digest.
jky_pick_asset() {
    case "$JKY_PLATFORM-$JKY_ARCH" in
        linux-x86_64) pattern='_amd64\.AppImage$' ;;
        mac-arm64) pattern='_aarch64\.dmg$' ;;
        mac-x86_64) pattern='_x64\.dmg$' ;;
    esac
    line=$(grep -E "$pattern" "$JKY_WORK/SHA256SUMS" | head -1)
    if [ -z "$line" ]; then
        jky_fail "This release has no build for $JKY_OS_NAME on $JKY_ARCH." "See https://github.com/${JKY_REPO}/releases"
    fi
    JKY_ASSET_SHA=$(echo "$line" | awk '{print tolower($1)}')
    JKY_ASSET=$(echo "$line" | sed -E 's/^[0-9a-fA-F]+[ *]+//')
    JKY_RELEASE_VERSION=$(echo "$JKY_ASSET" | sed -nE 's/.*_([0-9]+\.[0-9]+\.[0-9]+[^_]*)_.*/\1/p')
}

jky_human() {
    awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MB", b / 1048576; else if (b >= 1024) printf "%.0f KB", b / 1024; else printf "%d B", b }'
}

jky_bar() {
    # $1 percent, $2 cells. The filled part runs along the gradient.
    bar_full=$(($1 * $2 / 100))
    bar_i=0
    while [ $bar_i -lt "$2" ]; do
        if [ $bar_i -lt $bar_full ]; then
            printf '%s%s' "$(jky_grad $bar_i "$2")" "$FULL"
        else
            printf '%s%s' "$FAINT" "$EMPTY"
        fi
        bar_i=$((bar_i + 1))
    done
    printf '%s' "$RST"
}

jky_download() {
    url=$1 out=$2 label=$3
    total=$(jky_size_of "$url")
    if [ "$JKY_FETCH" = curl ]; then
        curl -fsSL --retry 2 "$url" -o "$out" 2>"$JKY_WORK/fetch.err" &
    else
        wget -q -O "$out" "$url" 2>"$JKY_WORK/fetch.err" &
    fi
    fetch_pid=$!
    started=$(date +%s)
    frame=0
    cells=28
    if [ "$JKY_COLS" -lt 100 ]; then cells=18; fi
    while kill -0 "$fetch_pid" 2>/dev/null; do
        if [ "$JKY_ANIM" = 1 ]; then
            got=0
            if [ -f "$out" ]; then got=$(wc -c <"$out" | tr -d ' '); fi
            elapsed=$(($(date +%s) - started))
            if [ "$elapsed" -lt 1 ]; then elapsed=1; fi
            speed=$((got / elapsed))
            if [ "$total" -gt 0 ]; then
                pct=$((got * 100 / total))
                if [ "$pct" -gt 100 ]; then pct=100; fi
                left=0
                if [ "$speed" -gt 0 ]; then left=$(((total - got) / speed)); fi
                jky_spinner_frame "$label" "$frame"
                printf '  '
                jky_bar "$pct" "$cells"
                printf ' %s%3d%%%s  %s%s / %s%s' "$BLD$TEXT" "$pct" "$RST" \
                    "$MUTED" "$(jky_human "$got")" "$(jky_human "$total")" "$RST"
                # Speed and time left only where they fit: a line that wraps
                # can no longer be redrawn in place.
                if [ "$JKY_COLS" -ge 100 ]; then
                    printf '  %s%s/s%s  %s%ss%s' "$BLUE" "$(jky_human "$speed")" "$RST" "$FAINT" "$left" "$RST"
                fi
            else
                jky_spinner_frame "$label" "$frame"
                printf '  %s%s%s' "$MUTED" "$(jky_human "$got")" "$RST"
            fi
            printf '\033[K'
            frame=$((frame + 1))
        fi
        sleep 0.1
    done
    wait "$fetch_pid" || {
        jky_clear_line
        jky_fail "The download failed." "$url$(printf '\n       ')$(cat "$JKY_WORK/fetch.err" 2>/dev/null)"
    }
    size=$(wc -c <"$out" | tr -d ' ')
    if [ "$JKY_ANIM" = 1 ]; then
        jky_clear_line
        printf '     %s%s%s %-26s ' "$MINT" "$OK" "$RST" "$label"
        jky_bar 100 "$cells"
        printf ' %s100%%%s  %s%s%s\n' "$BLD$TEXT" "$RST" "$MUTED" "$(jky_human "$size")" "$RST"
    else
        jky_done "$label" "$(jky_human "$size")"
    fi
}

jky_verify() {
    actual=$($JKY_SHA "$1" | awk '{print tolower($1)}')
    if [ "$actual" != "$2" ]; then
        rm -f "$1"
        jky_fail "The download does not match the release's checksum." \
            "Expected $2, got $actual. Nothing was installed — try again."
    fi
    short_a=$(echo "$2" | cut -c1-4)
    short_b=$(echo "$2" | cut -c61-64)
    jky_done "Verifying checksum" "sha256 $OK  $short_a...$short_b"
}

# ─── install ─────────────────────────────────────────────────────────────────

jky_paths() {
    JKY_BIN_DIR=${JKY_BIN_DIR:-$HOME/.local/bin}
    if [ "$JKY_PLATFORM" = linux ]; then
        JKY_HOME=${JKY_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/jky-terminal}
        JKY_APP="$JKY_HOME/app"
        JKY_EXE="$JKY_APP/AppRun"
    else
        JKY_APPS=${JKY_INSTALL_DIR:-$HOME/Applications}
        JKY_HOME="$HOME/Library/Application Support/JKY Terminal Installer"
        JKY_APP="$JKY_APPS/JKY Terminal.app"
        JKY_EXE=""
    fi
}

jky_install_linux() {
    # Extracted, not run as an AppImage: extraction needs no FUSE, which many
    # current distributions no longer ship.
    rm -rf "$JKY_HOME/app.new" "$JKY_WORK/squashfs-root"
    chmod +x "$JKY_WORK/$JKY_ASSET"
    (cd "$JKY_WORK" && "./$JKY_ASSET" --appimage-extract >/dev/null) || return 1
    mv "$JKY_WORK/squashfs-root" "$JKY_HOME/app.new" || return 1
    rm -rf "$JKY_APP"
    mv "$JKY_HOME/app.new" "$JKY_APP"
    rm -f "$JKY_WORK/$JKY_ASSET"
}

# The libraries an AppImage leaves to the system — the graphics stack, X11,
# fonts — that this one lacks. A desktop always has them; a server or a
# minimal install may not, and then the app cannot start.
jky_missing_libs() {
    {
        if command -v ldd >/dev/null 2>&1; then
            for f in "$JKY_APP"/usr/bin/* "$JKY_APP"/usr/libexec/webkit2gtk-*/WebKit*Process; do
                if [ -f "$f" ]; then ldd "$f" 2>/dev/null; fi
            done | awk '$2 == "=>" && $3 == "not" {print $1}'
        fi
        jky_missing_loaded_libs
    } | LC_ALL=C sort -u
}

# WebKit loads these while it runs rather than linking them, so ldd cannot
# see them — and without them it aborts as it starts.
jky_missing_loaded_libs() {
    ldconfig=$(command -v ldconfig 2>/dev/null)
    for d in /sbin /usr/sbin; do
        if [ -z "$ldconfig" ] && [ -x "$d/ldconfig" ]; then ldconfig="$d/ldconfig"; fi
    done
    if [ -z "$ldconfig" ]; then return 0; fi
    known=$("$ldconfig" -p 2>/dev/null)
    if [ -z "$known" ]; then return 0; fi
    for lib in libGLESv2.so.2 libGL.so.1; do
        case "$known" in *"$lib (libc6,x86-64)"*) ;; *) echo "$lib" ;; esac
    done
}

jky_check_libs() {
    missing=$(jky_missing_libs | tr '\n' ' ' | sed 's/ $//')
    if [ -z "$missing" ]; then return 0; fi
    # Nothing is left half-installed: the app could not have started.
    rm -rf "$JKY_APP"
    if command -v apt-get >/dev/null 2>&1; then how="sudo apt install libegl1 libgl1 libgles2 libgbm1"
    elif command -v dnf >/dev/null 2>&1; then how="sudo dnf install mesa-libEGL mesa-libGL libglvnd-gles mesa-libgbm"
    elif command -v pacman >/dev/null 2>&1; then how="sudo pacman -S mesa libglvnd"
    elif command -v zypper >/dev/null 2>&1; then how="sudo zypper install Mesa-libEGL1 Mesa-libGL1 Mesa-libGLESv2-2 libgbm1"
    else how="your package manager"
    fi
    jky_fail "JKY Terminal needs libraries this system does not have." \
        "Missing: $missing
On a desktop they come with the graphics drivers. Install them, then run this again:
  $how"
}

jky_desktop_entry() {
    apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    mkdir -p "$apps"
    icon=$(find "$JKY_APP" -maxdepth 1 -name '*.png' 2>/dev/null | head -1)
    cat >"$apps/jky-terminal.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=JKY Terminal
Comment=AI terminal. Infinite possibilities.
Exec="$JKY_BIN_DIR/jky"
Icon=${icon:-utilities-terminal}
Terminal=false
Categories=Development;System;TerminalEmulator;
StartupWMClass=jky-terminal
EOF
    if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$apps" >/dev/null 2>&1 || true; fi
}

jky_install_mac() {
    mnt="$JKY_WORK/mount"
    mkdir -p "$mnt" "$JKY_APPS"
    # The release's disk image carries the licence as an agreement, and an
    # image with one will not mount until someone clicks Agree. A converted
    # copy carries no agreement — the way Homebrew opens such images.
    hdiutil convert -quiet "$JKY_WORK/$JKY_ASSET" -format UDTO -o "$JKY_WORK/image" ||
        { echo "the disk image could not be read" >&2; return 1; }
    hdiutil attach -nobrowse -readonly -noautoopen -quiet -mountpoint "$mnt" "$JKY_WORK/image.cdr" ||
        { echo "the disk image could not be opened" >&2; return 1; }
    found=$(find "$mnt" -maxdepth 1 -name '*.app' | head -1)
    if [ -z "$found" ]; then
        hdiutil detach "$mnt" -quiet
        echo "the disk image has no app in it" >&2
        return 1
    fi
    rm -rf "$JKY_APP.new"
    ditto "$found" "$JKY_APP.new" || { hdiutil detach "$mnt" -quiet; echo "the app could not be copied" >&2; return 1; }
    hdiutil detach "$mnt" -quiet || true
    rm -rf "$JKY_APP"
    mv "$JKY_APP.new" "$JKY_APP"
    xattr -dr com.apple.quarantine "$JKY_APP" 2>/dev/null || true
    rm -f "$JKY_WORK/$JKY_ASSET" "$JKY_WORK/image.cdr"
}

jky_mac_exe() {
    name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$JKY_APP/Contents/Info.plist" 2>/dev/null || echo jky-terminal)
    echo "$JKY_APP/Contents/MacOS/$name"
}

jky_write_launcher() {
    mkdir -p "$JKY_BIN_DIR" "$JKY_HOME"
    if [ "$JKY_PLATFORM" = mac ]; then
        open_line="open \"\$JKY_APP\""
    else
        open_line="nohup \"\$JKY_EXE\" >/dev/null 2>&1 &"
    fi
    cat >"$JKY_BIN_DIR/jky" <<EOF
#!/bin/sh
# jky — open JKY Terminal from any terminal. Written by the JKY Terminal installer.
JKY_APP='$(jky_quote "$JKY_APP")'
JKY_EXE='$(jky_quote "$JKY_EXE")'
JKY_HOME='$(jky_quote "$JKY_HOME")'
case "\${1:-}" in
    "" | open) $open_line ;;
    shortcut) sh "\$JKY_HOME/install.sh" --set-shortcut "\${2:-}" ;;
    version | --version | -v) cat "\$JKY_HOME/VERSION" 2>/dev/null || echo unknown ;;
    uninstall) sh "\$JKY_HOME/install.sh" --uninstall ;;
    help | --help | -h)
        echo "jky                     open JKY Terminal (or bring it forward)"
        echo "jky shortcut <keys>     change the summon shortcut, e.g. jky shortcut Ctrl+Alt+J — or none"
        echo "jky version             the installed version"
        echo "jky uninstall           remove JKY Terminal; your data is kept" ;;
    *) echo "jky: unknown command '\$1' — try jky help" >&2; exit 1 ;;
esac
EOF
    chmod +x "$JKY_BIN_DIR/jky"
    echo "$JKY_RELEASE_VERSION" >"$JKY_HOME/VERSION"
    # Kept for `jky shortcut` and `jky uninstall`.
    if [ -f "$0" ] && grep -q JKY_INSTALLER_MARKER "$0" 2>/dev/null; then
        cp "$0" "$JKY_HOME/install.sh"
    else
        jky_get "$JKY_SCRIPT_URL" "$JKY_HOME/install.sh" || true
    fi
}

jky_quote() { printf '%s' "$1" | sed "s/'/'\\\\''/g"; }

# Put the launcher's folder on PATH for future terminals, if it is not.
jky_path() {
    case ":$PATH:" in *":$JKY_BIN_DIR:"*) JKY_PATH_NOTE="" ; return ;; esac
    line="export PATH=\"$JKY_BIN_DIR:\$PATH\"  # Added by the JKY Terminal installer"
    shell_name=$(basename "${SHELL:-sh}")
    case "$shell_name" in
        zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
        bash) if [ "$JKY_PLATFORM" = mac ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
        fish)
            rc="$HOME/.config/fish/conf.d/jky.fish"
            line="fish_add_path \"$JKY_BIN_DIR\"  # Added by the JKY Terminal installer"
            mkdir -p "$(dirname "$rc")" ;;
        *) rc="$HOME/.profile" ;;
    esac
    if ! grep -q "Added by the JKY Terminal installer" "$rc" 2>/dev/null; then
        printf '\n%s\n' "$line" >>"$rc"
    fi
    JKY_PATH_NOTE="Open a new terminal first, or run:  export PATH=\"$JKY_BIN_DIR:\$PATH\""
}

# ─── the summon shortcut ─────────────────────────────────────────────────────

# A shortcut as typed, to its canonical form — the rules in
# crates/jky-keys/src/summon.rs, tested against scripts/install/shortcuts.tsv.
# Prints the canonical form, or nothing and returns 1.
jky_normalize() {
    words=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr '+-' '  ')
    n_ctrl=0 n_alt=0 n_shift=0 n_super=0 key="" count=0
    for w in $words; do count=$((count + 1)); done
    i=0
    for w in $words; do
        i=$((i + 1))
        case "$w" in
            ctrl | control | ctl) n_ctrl=$((n_ctrl + 1)) ;;
            alt | option | opt) n_alt=$((n_alt + 1)) ;;
            shift) n_shift=$((n_shift + 1)) ;;
            super | win | windows | cmd | command | meta) n_super=$((n_super + 1)) ;;
            *)
                if [ "$i" != "$count" ]; then return 1; fi
                case "$w" in
                    space) key=Space ;;
                    [a-z0-9]) key=$(printf '%s' "$w" | tr '[:lower:]' '[:upper:]') ;;
                    f[1-9] | f1[0-9] | f2[0-4]) key=$(printf '%s' "$w" | tr 'f' 'F') ;;
                    *) return 1 ;;
                esac ;;
        esac
    done
    if [ -z "$key" ]; then return 1; fi
    for c in $n_ctrl $n_alt $n_shift $n_super; do if [ "$c" -gt 1 ]; then return 1; fi; done
    mods=$((n_ctrl + n_alt + n_shift + n_super))
    if [ "$mods" = 0 ]; then return 1; fi
    if [ "$mods" = 1 ] && { [ "$n_ctrl" = 1 ] || [ "$n_shift" = 1 ]; }; then return 1; fi
    out=""
    if [ "$n_ctrl" = 1 ]; then out="Ctrl+"; fi
    if [ "$n_alt" = 1 ]; then out="${out}Alt+"; fi
    if [ "$n_shift" = 1 ]; then out="${out}Shift+"; fi
    if [ "$n_super" = 1 ]; then out="${out}Super+"; fi
    printf '%s%s\n' "$out" "$key"
}

jky_is_off() {
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' ')" in "" | none | off | skip) return 0 ;; esac
    return 1
}

# How a canonical shortcut reads to a person on this platform.
jky_pretty() {
    if [ "${JKY_PLATFORM:-}" = mac ]; then
        printf '%s' "$1" | sed -e 's/Ctrl/Control/' -e 's/Alt/Option/' -e 's/Super/Cmd/' -e 's/+/ + /g'
    else
        printf '%s' "$1" | sed -e 's/+/ + /g'
    fi
}

jky_presets() {
    case "$JKY_PLATFORM" in
        mac) echo "Ctrl+Alt+J Ctrl+Alt+Space Shift+Super+J" ;;
        *) echo "Super+J Ctrl+Alt+J Ctrl+Alt+Space" ;;
    esac
}

jky_choose_shortcut() {
    presets=$(jky_presets)
    p1=${presets%% *}
    rest=${presets#* }
    p2=${rest%% *}
    p3=${rest#* }
    sel=1
    jky_hide_cursor
    jky_draw_chooser "$sel" "$p1" "$p2" "$p3"
    JKY_OLD_TTY=$(stty -g </dev/tty)
    choice=""
    while [ -z "$choice" ]; do
        stty -icanon -echo min 1 time 0 </dev/tty
        k=$(dd bs=1 count=1 </dev/tty 2>/dev/null)
        if [ "$k" = "$JKY_ESC" ]; then
            stty -icanon -echo min 0 time 1 </dev/tty
            rest=$(dd bs=2 count=1 </dev/tty 2>/dev/null)
            case "$rest" in
                '[A' | 'OA') sel=$((sel - 1)) ;;
                '[B' | 'OB') sel=$((sel + 1)) ;;
                '') choice=none ;;
            esac
        else
            case "$k" in
                1) sel=1 choice=$p1 ;;
                2) sel=2 choice=$p2 ;;
                3) sel=3 choice=$p3 ;;
                c | C) sel=4 choice=custom ;;
                s | S | q | Q) choice=none ;;
                k | K) sel=$((sel - 1)) ;;
                j | J) sel=$((sel + 1)) ;;
                '')
                    case $sel in 1) choice=$p1 ;; 2) choice=$p2 ;; 3) choice=$p3 ;; 4) choice=custom ;; *) choice=none ;; esac ;;
            esac
        fi
        if [ "$sel" -lt 1 ]; then sel=5; fi
        if [ "$sel" -gt 5 ]; then sel=1; fi
        printf '\033[9A'
        jky_draw_chooser "$sel" "$p1" "$p2" "$p3"
    done
    stty "$JKY_OLD_TTY" </dev/tty
    JKY_OLD_TTY=""
    if [ "$choice" = custom ]; then
        jky_show_cursor
        while :; do
            printf '     %s%s%s Type a shortcut %s(e.g. Ctrl+Alt+K — or none)%s: ' "$CYAN" "$ARROW" "$RST" "$FAINT" "$RST"
            IFS= read -r typed </dev/tty || typed=none
            if jky_is_off "$typed"; then choice=none; break; fi
            if choice=$(jky_normalize "$typed"); then break; fi
            printf '       %s%s is not a shortcut JKY can use — it needs Ctrl, Alt or Super plus one key.%s\n' "$AMBER" "$typed" "$RST"
        done
    fi
    jky_show_cursor
    JKY_CHOSEN=$choice
}

jky_draw_chooser() {
    sel=$1
    shift
    # 63 columns wide: header, five rows and footer all land on it.
    printf '     %s╭─%s %s%s %sChoose a global summon shortcut for JKY Terminal%s %s────────╮%s\n' \
        "$VIOLET" "$RST" "$AMBER" "$STAR" "$BLD$TEXT" "$RST" "$VIOLET" "$RST"
    n=1
    for p in "$@" custom none; do
        case "$p" in
            custom) key="[c]  " label="Type your own" extra="" ;;
            none) key="[Esc]" label="Skip for now" extra="" ;;
            *) key="[$n]  " label=$(jky_pretty "$p") extra=""
               if [ $n = 1 ]; then extra="(Recommended)"; fi ;;
        esac
        if [ $n = "$sel" ]; then
            printf '     %s│%s %s%s %s %-22s %-28s%s %s│%s\n' "$VIOLET" "$RST" "$BLD$CYAN" "$ARROW" "$key" "$label" "$extra" "$RST" "$VIOLET" "$RST"
        else
            printf '     %s│%s   %s%s %-22s %s%-28s%s %s│%s\n' "$VIOLET" "$RST" "$MUTED" "$key" "$label" "$FAINT" "$extra" "$RST" "$VIOLET" "$RST"
        fi
        n=$((n + 1))
    done
    printf '     %s╰─%s %s↑↓ choose · Enter confirm · 1-3 pick · c type · Esc skip%s %s──╯%s\n' "$VIOLET" "$RST" "$FAINT" "$RST" "$VIOLET" "$RST"
    if [ "${JKY_PLATFORM:-}" = mac ]; then
        printf '       %sIt brings JKY forward from any app while JKY is open.%s\n' "$MUTED" "$RST"
    else
        printf '       %sIt opens JKY Terminal from anywhere on your system.%s\n' "$MUTED" "$RST"
    fi
    printf '       %sYour choice is saved in JKY, so you are only asked once.%s\n' "$FAINT" "$RST"
}

# Store the shortcut in JKY's own settings, through the app itself, so the
# app's rules decide what is valid. Prints the stored form.
jky_store_shortcut() {
    if [ "$JKY_PLATFORM" = mac ]; then exe=$(jky_mac_exe); else exe=$JKY_EXE; fi
    answer=$("$exe" --set-shortcut "$1" 2>"$JKY_WORK/shortcut.err") || return 1
    # The app's answer is its last line: a desktop library may print a
    # warning first. Stored and nothing said means stored as asked, since
    # what was asked for is already in canonical form.
    answer=$(printf '%s\n' "$answer" | sed '/^[[:space:]]*$/d' | tail -1)
    if [ "$answer" != none ] && ! jky_normalize "$answer" >/dev/null 2>&1; then answer=$1; fi
    printf '%s\n' "$answer"
}

# GNOME: a custom keybinding that runs `jky`, so the shortcut opens JKY even
# when it is not running — and works on Wayland, where apps cannot hold one.
jky_gnome_binding() {
    canonical=$1
    command -v gsettings >/dev/null 2>&1 || return 1
    schema=org.gnome.settings-daemon.plugins.media-keys
    gsettings list-keys "$schema" >/dev/null 2>&1 || return 1
    path=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/jky-terminal/
    current=$(gsettings get "$schema" custom-keybindings)
    if [ "$canonical" = none ]; then
        updated=$(printf '%s' "$current" | sed -e "s|, '$path'||" -e "s|'$path', ||" -e "s|'$path'||")
        case "$updated" in "[]" | "@as []") updated="@as []" ;; esac
        gsettings set "$schema" custom-keybindings "$updated"
        return 0
    fi
    accel=$(jky_gnome_accel "$canonical")
    case "$current" in
        *"'$path'"*) ;;
        "@as []" | "[]") gsettings set "$schema" custom-keybindings "['$path']" ;;
        *) gsettings set "$schema" custom-keybindings "$(printf '%s' "$current" | sed "s|]$|, '$path']|")" ;;
    esac
    gsettings set "$schema.custom-keybinding:$path" name "JKY Terminal"
    gsettings set "$schema.custom-keybinding:$path" command "$JKY_BIN_DIR/jky"
    gsettings set "$schema.custom-keybinding:$path" binding "$accel"
}

# `Ctrl+Alt+J` as GNOME spells it: `<Control><Alt>j`.
jky_gnome_accel() {
    g_key=${1##*+}
    g_mods=${1%"$g_key"}
    case "$g_key" in
        Space) g_key=space ;;
        [A-Z]) g_key=$(printf '%s' "$g_key" | tr '[:upper:]' '[:lower:]') ;;
    esac
    printf '%s%s\n' "$(printf '%s' "$g_mods" | sed -e 's/Ctrl+/<Control>/' -e 's/Alt+/<Alt>/' -e 's/Shift+/<Shift>/' -e 's/Super+/<Super>/')" "$g_key"
}

# Apply a choice: store it in JKY, and on GNOME bind it at the desktop too.
jky_apply_shortcut() {
    wanted=$1
    # Checked here first, by the same rules as the app, so the GNOME binding
    # is built from the canonical form; the app then checks it again.
    if [ "$wanted" != none ]; then
        if ! canonical=$(jky_normalize "$wanted"); then
            printf '     %s%s%s %s is not a shortcut JKY can use: it needs Ctrl+Alt, Shift, Super or Alt, and one key.\n' \
                "$AMBER" "$BAD" "$RST" "$wanted"
            return 1
        fi
        wanted=$canonical
    fi
    if ! stored=$(jky_store_shortcut "$wanted"); then
        printf '     %s%s%s %s\n' "$AMBER" "$BAD" "$RST" "$(cat "$JKY_WORK/shortcut.err" 2>/dev/null)"
        return 1
    fi
    if [ "$stored" = none ]; then
        jky_gnome_binding none >/dev/null 2>&1 || true
        jky_done "Summon shortcut" "none — choose one later with: jky shortcut <keys>"
        return 0
    fi
    if [ "$JKY_PLATFORM" = linux ] && jky_gnome_binding "$stored" >/dev/null 2>&1; then
        jky_done "Summon shortcut" "$(jky_pretty "$stored") — registered with GNOME"
    elif [ "$JKY_PLATFORM" = linux ]; then
        jky_done "Summon shortcut" "$(jky_pretty "$stored") — works while JKY is open"
        JKY_SHORTCUT_NOTE="To open JKY with it when JKY is closed, add a shortcut in your desktop's keyboard settings that runs: $JKY_BIN_DIR/jky"
    else
        jky_done "Summon shortcut" "$(jky_pretty "$stored") — brings JKY forward while it is open"
    fi
}

# ─── finishing ───────────────────────────────────────────────────────────────

jky_finale() {
    done_msg="JKY Terminal $JKY_RELEASE_VERSION is installed."
    if [ ${#done_msg} -gt 38 ] || [ -z "$JKY_RELEASE_VERSION" ]; then done_msg="JKY Terminal is installed."; fi
    if [ "$JKY_UTF8" != 1 ]; then
        printf '\n     Installation complete! %s\n     Type jky in any terminal to open it.\n' "$done_msg"
        return
    fi
    frames=1
    if [ "$JKY_ANIM" = 1 ]; then frames=8; fi
    printf '\n'
    f=0
    while [ $f -lt $frames ]; do
        if [ $f -gt 0 ]; then printf '\033[9A'; fi
        # Three sparkles, taking turns.
        s1=" " s2=" " s3=" "
        case $((f % 4)) in 0) s1=$STAR ;; 1) s2=$STAR ;; 2) s3=$STAR ;; *) s1=$STAR s3=$STAR ;; esac
        if [ $((f + 1)) = $frames ]; then s1=$STAR s2=$STAR s3=$STAR; fi
        B="${MINT}│${RST}"
        printf '     %s╭────────────────────────────────────────────────────────────────╮%s\n' "$MINT" "$RST"
        printf '     %s%64s%s\n' "$B" "" "$B"
        printf '     %s   %s%s  Installation complete!%s  %s%s%s             %s%-20s%s%s\n' \
            "$B" "$BLD$MINT" "$OK" "$RST" "$AMBER" "$s1" "$RST" "$MUTED" "Launch with:" "$RST" "$B"
        printf '     %s%44s%s╭───────────╮%s%s%s%s%6s%s\n' "$B" "" "$VIOLET" "$RST" "$AMBER" "$s2" "$RST" "" "$B"
        printf '     %s      %s%-38s%s%s│    %sjky%s    │%s%7s%s\n' \
            "$B" "$TEXT" "$done_msg" "$RST" "$VIOLET" "$BLD$CYAN" "$RST$VIOLET" "$RST" "" "$B"
        printf '     %s      Type %sjky%s in any terminal to open it.  %s╰───────────╯%s%s%6s%s\n' \
            "$B" "$BLD$CYAN" "$RST" "$VIOLET" "$RST" "$AMBER$s3$RST" "" "$B"
        printf '     %s%64s%s\n' "$B" "" "$B"
        printf '     %s╰────────────────────────────────────────────────────────────────╯%s\n' "$MINT" "$RST"
        printf '\n'
        jky_pause 0.15
        f=$((f + 1))
    done
}

# ─── uninstall ───────────────────────────────────────────────────────────────

jky_uninstall() {
    jky_detect
    jky_paths
    jky_section "Removing JKY Terminal..."
    if [ "$JKY_PLATFORM" = linux ]; then
        jky_gnome_binding none >/dev/null 2>&1 || true
        rm -rf "$JKY_HOME"
        rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/jky-terminal.desktop"
    else
        rm -rf "$JKY_APP" "$JKY_HOME"
    fi
    rm -f "$JKY_BIN_DIR/jky"
    for rc in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
        if [ -f "$rc" ] && grep -q "Added by the JKY Terminal installer" "$rc"; then
            # Written back in place, so a symlinked dotfile stays a symlink.
            grep -v "Added by the JKY Terminal installer" "$rc" >"$rc.jky-tmp"
            cat "$rc.jky-tmp" >"$rc" && rm -f "$rc.jky-tmp"
        fi
    done
    rm -f "$HOME/.config/fish/conf.d/jky.fish"
    jky_done "JKY Terminal removed" ""
    printf '       %sYour settings, history and notes are kept. To remove them too, delete:%s\n' "$MUTED" "$RST"
    if [ "$JKY_PLATFORM" = mac ]; then
        printf '       %s~/Library/Application Support/dev.jky.terminal%s\n\n' "$TEXT" "$RST"
    else
        printf '       %s%s/dev.jky.terminal%s\n\n' "$TEXT" "${XDG_CONFIG_HOME:-~/.config}" "$RST"
    fi
}

# ─── main ────────────────────────────────────────────────────────────────────

# Whatever happens — finished, failed or Ctrl+C — the terminal is given back
# as it was found, and the working folder goes.
jky_cleanup() {
    if [ -n "${JKY_OLD_TTY:-}" ]; then stty "$JKY_OLD_TTY" 2>/dev/null </dev/tty; fi
    rm -rf "${JKY_WORK:-/nonexistent-jky}"
    jky_show_cursor
}

jky_usage() {
    if [ -f "$0" ] && grep -q JKY_INSTALLER_MARKER "$0" 2>/dev/null; then
        sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
    else
        echo "JKY Terminal installer. Options: --version vX.Y.Z  --shortcut <keys|none>  --no-animation  --uninstall"
        echo "See https://github.com/${JKY_REPO}#install"
    fi
}

main() {
    JKY_VERSION=${JKY_VERSION:-latest}
    JKY_WANT=${JKY_SHORTCUT:-}
    JKY_MODE=install
    while [ $# -gt 0 ]; do
        case "$1" in
            --version) JKY_VERSION=${2:-latest}; shift ;;
            --shortcut) JKY_WANT=${2:-none}; shift ;;
            --no-shortcut) JKY_WANT=none ;;
            --no-animation) JKY_NO_ANIMATION=1 ;;
            --uninstall) JKY_MODE=uninstall ;;
            --set-shortcut) JKY_MODE=set-shortcut; JKY_WANT=${2:-}; shift ;;
            -h | --help) jky_usage; return 0 ;;
            *) echo "install.sh: unknown option $1 (try --help)" >&2; return 1 ;;
        esac
        shift
    done
    jky_setup_output
    if [ "$JKY_MODE" = uninstall ]; then jky_uninstall; return 0; fi

    jky_detect
    jky_paths
    mkdir -p "$JKY_HOME"
    JKY_WORK=$(mktemp -d "$JKY_HOME/.install.XXXXXX") || jky_fail "Could not create a working folder in $JKY_HOME"
    JKY_OLD_TTY=""
    trap 'jky_cleanup' EXIT
    trap 'jky_cleanup; exit 130' INT TERM

    if [ "$JKY_MODE" = set-shortcut ]; then
        JKY_RELEASE_VERSION=$(cat "$JKY_HOME/VERSION" 2>/dev/null || echo "")
        JKY_SHORTCUT_NOTE=""
        if [ -z "$JKY_WANT" ] && [ "$JKY_TTY" = 1 ] && (exec </dev/tty) 2>/dev/null; then
            jky_choose_shortcut
            JKY_WANT=$JKY_CHOSEN
        elif jky_is_off "$JKY_WANT"; then
            JKY_WANT=none
        fi
        jky_apply_shortcut "$JKY_WANT"
        status=$?
        if [ -n "$JKY_SHORTCUT_NOTE" ]; then printf '     %s%s%s\n' "$MUTED" "$JKY_SHORTCUT_NOTE" "$RST"; fi
        return $status
    fi

    # The release list first, quietly, so the banner names the real version.
    base=$(jky_base_url)
    label=$JKY_VERSION
    jky_get "$base/SHA256SUMS" "$JKY_WORK/SHA256SUMS" 2>/dev/null
    sums_status=$?
    if [ "$sums_status" = 0 ]; then
        jky_pick_asset
        if [ -n "$JKY_RELEASE_VERSION" ]; then label="v$JKY_RELEASE_VERSION"; fi
    fi
    jky_hide_cursor
    jky_banner "$label"
    printf '\n  %sWelcome to JKY Terminal!%s\n  %sInstalling JKY Terminal — AI terminal. Infinite possibilities.%s\n' "$BLD$CYAN" "$RST" "$TEXT" "$RST"

    jky_check_system

    jky_section "Downloading and installing..."
    if [ "$sums_status" != 0 ]; then
        # curl -f says 22 and wget says 8 when the server answered with an
        # error: it was reached, and the release is not there.
        if [ "$sums_status" = 22 ] || [ "$sums_status" = 8 ]; then
            jky_fail "No published release was found." \
                "Looked in: $base
Releases:  https://github.com/${JKY_REPO}/releases"
        fi
        jky_fail "Could not connect to download JKY Terminal." \
            "Check your internet connection (or proxy), then run this again.
Tried: $base"
    fi
    jky_download "$base/$JKY_ASSET" "$JKY_WORK/$JKY_ASSET" "Downloading package"
    jky_verify "$JKY_WORK/$JKY_ASSET" "$JKY_ASSET_SHA"
    if [ "$JKY_PLATFORM" = linux ]; then
        jky_step "Extracting files" "$JKY_APP" jky_install_linux
        jky_check_libs
        jky_step "Adding to your apps menu" "jky-terminal.desktop" jky_desktop_entry
    else
        jky_step "Installing the app" "$JKY_APP" jky_install_mac
    fi

    jky_section "Setting up JKY Terminal..."
    jky_step "Installing \`jky\` command" "$JKY_BIN_DIR/jky" jky_write_launcher
    JKY_PATH_NOTE=""
    jky_path
    if [ -n "$JKY_PATH_NOTE" ]; then jky_done "Adding it to your PATH" "for new terminals"; fi

    JKY_SHORTCUT_NOTE=""
    if [ -n "$JKY_WANT" ]; then
        if jky_is_off "$JKY_WANT"; then JKY_WANT=none; fi
        jky_apply_shortcut "$JKY_WANT" || true
    elif [ "$JKY_TTY" = 1 ] && [ -r /dev/tty ] && (exec </dev/tty) 2>/dev/null; then
        printf '\n'
        jky_choose_shortcut
        jky_apply_shortcut "$JKY_CHOSEN" || true
    else
        jky_done "Summon shortcut" "not chosen — set one later with: jky shortcut <keys>"
    fi

    jky_finale
    jky_show_cursor
    if [ -n "$JKY_PATH_NOTE" ]; then printf '     %s%s%s\n' "$AMBER" "$JKY_PATH_NOTE" "$RST"; fi
    if [ -n "$JKY_SHORTCUT_NOTE" ]; then printf '     %s%s%s\n' "$MUTED" "$JKY_SHORTCUT_NOTE" "$RST"; fi
    printf '     %sSame terminal. Higher possibilities.%s\n\n' "$FAINT" "$RST"
}

if [ "${JKY_INSTALL_LIB:-}" != 1 ]; then main "$@"; fi
