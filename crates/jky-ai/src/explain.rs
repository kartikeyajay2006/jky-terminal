//! What a proposed command would do, in words, before anyone approves it.
//!
//! The approval card used to say one word — "writes files" — and leave the
//! rest to whoever was reading. This reads the command the way a careful
//! reviewer would: which paths it deletes or overwrites, which hosts it
//! reaches, whether it runs as administrator or runs a script it downloads,
//! and what a safer first step would be.
//!
//! **This is an explanation, not a control.** Every command waits for
//! approval whatever this says. It recognises common programs and shapes; a
//! program it does not know is named as unrecognised rather than quietly
//! treated as harmless, and anything built at run time — `$(…)`, `eval` —
//! is called out as something it cannot see into.

use serde::Serialize;

/// One thing a command would do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Effect {
    /// `deletes`, `writes`, `network`, `publish`, `installs`, `runs`,
    /// `admin`, `processes` or `system` — for the card's colour and icon.
    pub kind: &'static str,
    /// A sentence: "deletes build, recursively, without asking".
    pub text: String,
}

/// Everything the card shows beyond the command itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Explanation {
    pub effects: Vec<Effect>,
    /// Hosts the command would contact, as written in it.
    pub hosts: Vec<String>,
    /// Files and folders it would delete, create or change.
    pub paths: Vec<String>,
    /// A command that shows what this one would do, without doing it.
    pub dry_run: Option<String>,
    /// Programs it runs that this does not recognise.
    pub unrecognised: Vec<String>,
}

impl Explanation {
    fn effect(&mut self, kind: &'static str, text: impl Into<String>) {
        let text = text.into();
        if !self.effects.iter().any(|e| e.kind == kind && e.text == text) {
            self.effects.push(Effect { kind, text });
        }
    }
    fn host(&mut self, host: &str) {
        if !host.is_empty() && !self.hosts.iter().any(|h| h == host) {
            self.hosts.push(host.to_string());
        }
    }
    fn path(&mut self, path: &str) {
        // A path computed at run time is not a path anyone can check.
        let computed = path.contains("$(") || path.contains('`');
        if !path.is_empty() && !computed && !self.paths.iter().any(|p| p == path) {
            self.paths.push(path.to_string());
        }
    }
    fn preview(&mut self, command: String) {
        self.dry_run.get_or_insert(command);
    }
}

// ---------------------------------------------------------------------------
// Reading the command
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Word(String),
    /// `&&`, `||`, `;`, `|`, `&`.
    Sep(&'static str),
    /// `>` or `>>`: the next word is a file written.
    Write { append: bool },
    /// `<`: the next word is read, and needs no mention.
    Read,
}

/// Split a command the way a POSIX shell would, near enough to explain it.
///
/// Quotes and backslashes are honoured so `rm "my file"` names one path, not
/// two. `$(…)` and backticks are not expanded — `opaque` is set instead, and
/// the explanation says so.
fn tokenize(command: &str, opaque: &mut bool) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    let mut chars = command.chars().peekable();

    macro_rules! flush {
        () => {
            if in_word {
                out.push(Tok::Word(std::mem::take(&mut word)));
                in_word = false;
            }
        };
    }

    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' => flush!(),
            '\n' => {
                flush!();
                out.push(Tok::Sep(";"));
            }
            '\'' => {
                in_word = true;
                for q in chars.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    word.push(q);
                }
            }
            '"' => {
                in_word = true;
                while let Some(q) = chars.next() {
                    match q {
                        '"' => break,
                        '\\' => {
                            if let Some(n) = chars.next() {
                                word.push(n);
                            }
                        }
                        '`' => {
                            *opaque = true;
                            word.push(q);
                        }
                        '$' if chars.peek() == Some(&'(') => {
                            *opaque = true;
                            word.push(q);
                        }
                        _ => word.push(q),
                    }
                }
            }
            '\\' => {
                in_word = true;
                if let Some(n) = chars.next() {
                    word.push(n);
                }
            }
            // Kept whole, so `rm $(cat list)` names one unknown thing rather
            // than inventing paths called "$(cat" and "list)".
            '`' => {
                *opaque = true;
                in_word = true;
                word.push(c);
                for q in chars.by_ref() {
                    word.push(q);
                    if q == '`' {
                        break;
                    }
                }
            }
            '$' if chars.peek() == Some(&'(') => {
                *opaque = true;
                in_word = true;
                word.push(c);
                let mut depth = 0;
                for q in chars.by_ref() {
                    word.push(q);
                    match q {
                        '(' => depth += 1,
                        ')' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        _ => {}
                    }
                }
            }
            ';' => {
                flush!();
                out.push(Tok::Sep(";"));
            }
            '|' => {
                flush!();
                if chars.peek() == Some(&'|') {
                    chars.next();
                    out.push(Tok::Sep("||"));
                } else {
                    out.push(Tok::Sep("|"));
                }
            }
            '&' => {
                if chars.peek() == Some(&'&') {
                    flush!();
                    chars.next();
                    out.push(Tok::Sep("&&"));
                } else if chars.peek() == Some(&'>') {
                    // `&>file`: both streams to a file.
                    flush!();
                    chars.next();
                    let append = chars.peek() == Some(&'>');
                    if append {
                        chars.next();
                    }
                    out.push(Tok::Write { append });
                } else {
                    flush!();
                    out.push(Tok::Sep("&"));
                }
            }
            '>' => {
                // `2>` — the 2 is a stream number, not a word.
                if in_word && (word == "1" || word == "2") {
                    word.clear();
                    in_word = false;
                }
                flush!();
                let append = chars.peek() == Some(&'>');
                if append {
                    chars.next();
                }
                // `2>&1` duplicates a stream; nothing is written.
                if chars.peek() == Some(&'&') {
                    chars.next();
                    while chars.peek().is_some_and(|d| d.is_ascii_digit() || *d == '-') {
                        chars.next();
                    }
                    continue;
                }
                out.push(Tok::Write { append });
            }
            '<' => {
                flush!();
                out.push(Tok::Read);
            }
            _ => {
                in_word = true;
                word.push(c);
            }
        }
    }
    if in_word {
        out.push(Tok::Word(word));
    }
    out
}

/// One simple command: its words, the files it redirects into, and whether
/// its input is the previous command's output.
#[derive(Debug, Default)]
struct Segment {
    words: Vec<String>,
    writes: Vec<(String, bool)>,
    piped: bool,
}

fn segments(tokens: Vec<Tok>) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut current = Segment::default();
    let mut tokens = tokens.into_iter();
    while let Some(tok) = tokens.next() {
        match tok {
            Tok::Word(w) => current.words.push(w),
            Tok::Write { append } => {
                if let Some(Tok::Word(target)) = tokens.next() {
                    current.writes.push((target, append));
                }
            }
            Tok::Read => {
                tokens.next();
            }
            Tok::Sep(sep) => {
                out.push(std::mem::take(&mut current));
                current.piped = sep == "|";
            }
        }
    }
    out.push(current);
    out.retain(|s| !s.words.is_empty() || !s.writes.is_empty());
    out
}

// ---------------------------------------------------------------------------
// Explaining it
// ---------------------------------------------------------------------------

/// Read a proposed command and say what it would do.
pub fn explain(command: &str) -> Explanation {
    let mut ex = Explanation::default();
    let mut opaque = false;
    let segs = segments(tokenize(command, &mut opaque));

    let mut previous: Option<String> = None;
    for seg in &segs {
        for (target, append) in &seg.writes {
            if is_device_sink(target) {
                if target.starts_with("/dev/sd") || target.starts_with("/dev/nvme") || target.starts_with("/dev/disk") {
                    ex.effect("deletes", format!("overwrites the disk {target}"));
                }
                continue;
            }
            ex.path(target);
            if *append {
                ex.effect("writes", format!("appends to {target}"));
            } else {
                ex.effect("writes", format!("overwrites {target}"));
            }
        }
        let program = explain_words(&seg.words, &mut ex, seg.piped, previous.as_deref());
        previous = program;
    }

    for word in command.split_whitespace() {
        if let Some(host) = url_host(word.trim_matches(|c| c == '"' || c == '\'')) {
            ex.host(&host);
        }
    }

    if opaque {
        ex.effect(
            "runs",
            "builds part of itself at run time ($(…) or backticks) — JKY cannot see what that part runs",
        );
    }
    ex
}

fn is_device_sink(target: &str) -> bool {
    target.starts_with("/dev/")
}

/// Programs that only read or print. Running one adds nothing to the card.
const QUIET: &[&str] = &[
    "ls", "cat", "less", "more", "head", "tail", "wc", "grep", "rg", "ag", "echo", "printf", "pwd",
    "which", "whereis", "type", "whoami", "id", "date", "tree", "du", "df", "ps", "top", "uname",
    "file", "stat", "diff", "cmp", "sort", "uniq", "cut", "tr", "awk", "jq", "yq", "true", "false",
    "test", "[", "cd", "basename", "dirname", "realpath", "readlink", "nl", "column", "fd",
    "hostname", "uptime", "free", "lsof", "env", "printenv", "sleep", "seq", "md5sum", "sha256sum",
    "shasum", "base64", "xxd", "hexdump", "od", "strings", "man", "help", "history", "tldr",
];

/// Build tools and runtimes: they run the project's own code.
const RUNNERS: &[&str] = &[
    "make", "cmake", "ninja", "node", "deno", "bun", "python", "python3", "ruby", "perl", "php",
    "java", "go", "pytest", "tsc", "vitest", "jest", "mocha", "gradle", "./gradlew", "mvn",
    "dotnet", "swift", "zig", "gcc", "clang", "cc", "rustc", "just", "turbo", "nx", "tox",
];

/// The words after leading `sudo`, `env FOO=1`, `time` and the like, with
/// what those prefixes mean recorded on the way.
fn strip_prefixes<'a>(mut words: &'a [String], ex: &mut Explanation) -> &'a [String] {
    loop {
        let Some(first) = words.first() else { return words };
        let name = program_name(first);
        if first.contains('=') && !first.starts_with('-') && !first.starts_with('=') {
            words = &words[1..];
        } else if name == "sudo" || name == "doas" || name == "run0" {
            ex.effect("admin", "runs as administrator (root), with access to the whole system");
            words = &words[1..];
            // sudo's own flags, and the argument of the ones that take one.
            while let Some(flag) = words.first() {
                if !flag.starts_with('-') {
                    break;
                }
                let takes_value = matches!(flag.as_str(), "-u" | "-g" | "-C" | "-h" | "-p" | "-U");
                words = &words[if takes_value { 2.min(words.len()) } else { 1 }..];
            }
        } else if matches!(name, "time" | "nohup" | "nice" | "command" | "builtin" | "exec")
            || (name == "env" && words.len() > 1)
        {
            words = &words[1..];
        } else {
            return words;
        }
    }
}

fn program_name(word: &str) -> &str {
    if word == "./gradlew" {
        return word;
    }
    word.rsplit(['/', '\\']).next().unwrap_or(word)
}

/// Arguments that are not flags.
fn operands(args: &[String]) -> Vec<&str> {
    let mut out = Vec::new();
    let mut after_dashdash = false;
    for a in args {
        if after_dashdash || !a.starts_with('-') || a == "-" {
            out.push(a.as_str());
        } else if a == "--" {
            after_dashdash = true;
        }
    }
    out
}

fn has_flag(args: &[String], short: char, long: &str) -> bool {
    args.iter().any(|a| {
        a == long
            || (a.starts_with('-') && !a.starts_with("--") && a[1..].contains(short))
    })
}

fn list(paths: &[&str]) -> String {
    match paths.len() {
        0 => "the paths it is given".into(),
        1..=4 => paths.join(", "),
        n => format!("{}, and {} more", paths[..3].join(", "), n - 3),
    }
}

fn quoted(words: &[String]) -> String {
    words
        .iter()
        .map(|w| {
            if w.is_empty() || w.chars().any(|c| c.is_whitespace() || "'\"$`\\|&;<>()*?".contains(c)) {
                format!("'{}'", w.replace('\'', "'\\''"))
            } else {
                w.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Explain one simple command. Returns the program name, so a following
/// `| sh` can say whose output it is running.
fn explain_words(
    words: &[String],
    ex: &mut Explanation,
    piped: bool,
    previous: Option<&str>,
) -> Option<String> {
    let words = strip_prefixes(words, ex);
    let first = words.first()?;
    let name = program_name(first).to_string();
    let args = &words[1..];
    let ops = operands(args);

    match name.as_str() {
        "rm" | "rmdir" | "unlink" | "del" | "rd" | "Remove-Item" => {
            let recursive = has_flag(args, 'r', "--recursive") || has_flag(args, 'R', "--recursive");
            let forced = has_flag(args, 'f', "--force");
            for p in &ops {
                ex.path(p);
            }
            let mut text = format!("deletes {}", list(&ops));
            if recursive {
                text.push_str(", and everything inside");
            }
            if forced {
                text.push_str(", without asking");
            }
            ex.effect("deletes", text);
            if !ops.is_empty() {
                ex.preview(format!("ls -la{} {}", if recursive { "R" } else { "" }, quoted(&ops.iter().map(|s| s.to_string()).collect::<Vec<_>>())));
            }
        }
        "mv" | "cp" | "ln" | "install" => {
            if ops.len() >= 2 {
                let (dest, sources) = ops.split_last().unwrap();
                ex.path(dest);
                let verb = match name.as_str() {
                    "mv" => "moves",
                    "ln" => "links",
                    _ => "copies",
                };
                ex.effect(
                    "writes",
                    format!("{verb} {} to {dest}, replacing anything already there", list(sources)),
                );
                if name == "mv" {
                    for s in sources {
                        ex.path(s);
                    }
                }
            } else {
                ex.effect("writes", format!("runs {name}"));
            }
        }
        "mkdir" | "touch" => {
            for p in &ops {
                ex.path(p);
            }
            ex.effect("writes", format!("creates {}", list(&ops)));
        }
        "tee" => {
            let append = has_flag(args, 'a', "--append");
            for p in &ops {
                ex.path(p);
            }
            ex.effect(
                "writes",
                format!("{} {}", if append { "appends to" } else { "overwrites" }, list(&ops)),
            );
        }
        "sed" | "perl" if args.iter().any(|a| a == "-i" || a.starts_with("-i") || a == "--in-place") => {
            // The first operand is the script; the rest are the files.
            let files: Vec<&str> = ops.iter().skip(1).copied().collect();
            for p in &files {
                ex.path(p);
            }
            ex.effect("writes", format!("edits {} in place", list(&files)));
            if name == "sed" {
                let without: Vec<String> = args
                    .iter()
                    .filter(|a| !(*a == "-i" || a.starts_with("-i") || *a == "--in-place"))
                    .cloned()
                    .collect();
                ex.preview(format!("sed {} | diff {} -", quoted(&without), files.first().unwrap_or(&"FILE")));
            }
        }
        "chmod" | "chown" | "chgrp" => {
            let targets: Vec<&str> = ops.iter().skip(1).copied().collect();
            for p in &targets {
                ex.path(p);
            }
            let what = if name == "chmod" { "permissions" } else { "owner" };
            let mut text = format!("changes the {what} of {}", list(&targets));
            if has_flag(args, 'R', "--recursive") {
                text.push_str(", and everything inside");
            }
            ex.effect("writes", text);
        }
        "dd" => {
            if let Some(of) = args.iter().find_map(|a| a.strip_prefix("of=")) {
                ex.path(of);
                ex.effect("deletes", format!("overwrites {of} byte for byte"));
            }
        }
        n if n.starts_with("mkfs") || n == "format" || n == "diskutil" || n == "fdisk" || n == "parted" => {
            ex.effect("deletes", format!("formats or repartitions {} — erasing what is on it", list(&ops)));
        }
        "shutdown" | "reboot" | "halt" | "poweroff" => {
            ex.effect("system", "shuts down or restarts this computer");
        }
        "kill" | "pkill" | "killall" | "taskkill" | "Stop-Process" => {
            ex.effect("processes", format!("stops {}", if ops.is_empty() { "processes".to_string() } else { format!("process {}", list(&ops)) }));
        }
        "find" => {
            if args.iter().any(|a| a == "-delete") {
                ex.effect("deletes", "deletes every file it finds");
                let without: Vec<String> = args.iter().filter(|a| *a != "-delete").cloned().collect();
                ex.preview(format!("find {}", quoted(&without)));
            }
            if args.iter().any(|a| a == "-exec" || a == "-execdir" || a == "-ok") {
                ex.effect("runs", "runs another command on every file it finds");
            }
        }
        "xargs" => {
            let rest: Vec<String> = args.iter().skip_while(|a| a.starts_with('-')).cloned().collect();
            if rest.is_empty() {
                ex.effect("runs", "runs a command on every line of its input");
            } else {
                let inner = program_name(&rest[0]).to_string();
                explain_words(&rest, ex, false, None);
                if !QUIET.contains(&inner.as_str()) {
                    ex.effect("runs", format!("runs {inner} once per line of its input — on paths this cannot know in advance"));
                }
            }
        }
        "sh" | "bash" | "zsh" | "fish" | "dash" | "pwsh" | "powershell" | "cmd" | "eval" | "source" | "." => {
            if piped {
                let from = previous.unwrap_or("the previous command");
                ex.effect("runs", format!("runs whatever {from} outputs as a script — read that script first"));
            } else if args.iter().any(|a| a == "-c" || a == "-Command" || a == "/C") || name == "eval" {
                ex.effect("runs", format!("runs code given to {name} as text, which JKY does not inspect"));
            } else if let Some(script) = ops.first() {
                ex.effect("runs", format!("runs the script {script}"));
            } else {
                ex.effect("runs", format!("starts {name}"));
            }
        }
        "curl" | "wget" | "http" | "https" | "xh" | "Invoke-WebRequest" | "iwr" => {
            explain_fetch(&name, args, ex);
        }
        "ssh" | "mosh" => {
            if let Some(host) = ops.first() {
                let host = host.rsplit('@').next().unwrap_or(host);
                ex.host(host);
                if ops.len() > 1 {
                    ex.effect("network", format!("runs a command on {host}"));
                } else {
                    ex.effect("network", format!("opens a shell on {host}"));
                }
            }
        }
        "scp" | "rsync" | "sftp" => {
            let mut remote = false;
            for op in &ops {
                if let Some((host, _)) = op.split_once(':') {
                    if !host.is_empty() && !host.contains('/') {
                        let host = host.rsplit('@').next().unwrap_or(host);
                        ex.host(host);
                        remote = true;
                    }
                }
            }
            if let Some(dest) = ops.last() {
                ex.path(dest);
            }
            ex.effect(
                if remote { "network" } else { "writes" },
                format!("copies {} to {}", list(&ops[..ops.len().saturating_sub(1)]), ops.last().unwrap_or(&"a destination")),
            );
            if args.iter().any(|a| a.starts_with("--delete") || a == "--remove-source-files") {
                ex.effect("deletes", "deletes files at the destination that are not in the source");
            }
            if name == "rsync" && !has_flag(args, 'n', "--dry-run") {
                ex.preview(format!("rsync --dry-run {}", quoted(args)));
            }
        }
        "git" => explain_git(args, ex),
        "gh" => explain_gh(args, ex),
        "npm" | "pnpm" | "yarn" | "bun" | "npx" | "pnpx" => explain_node(&name, args, ex),
        "cargo" => explain_cargo(args, ex),
        "pip" | "pip3" | "pipx" | "uv" | "poetry" | "gem" | "brew" | "apt" | "apt-get" | "dnf"
        | "yum" | "pacman" | "zypper" | "apk" | "port" | "choco" | "winget" | "scoop" | "snap"
        | "flatpak" | "conda" | "mamba" => {
            let sub = ops.first().copied().unwrap_or("");
            if matches!(sub, "install" | "add" | "upgrade" | "update" | "sync" | "-S" | "-Syu")
                || args.iter().any(|a| a == "-S" || a == "-Syu")
            {
                ex.effect("installs", format!("installs or upgrades packages with {name}, downloading them and running their install steps"));
            } else if matches!(sub, "remove" | "uninstall" | "purge" | "autoremove" | "-R") {
                ex.effect("deletes", format!("uninstalls packages with {name}"));
            } else if matches!(sub, "publish" | "push" | "upload") {
                ex.effect("publish", format!("publishes a package with {name}"));
            } else {
                ex.effect("runs", format!("runs {name} {sub}").trim_end().to_string());
            }
        }
        "docker" | "podman" => {
            let sub = ops.first().copied().unwrap_or("");
            match sub {
                "rm" | "rmi" | "prune" => ex.effect("deletes", format!("removes {name} containers or images")),
                "system" | "volume" | "image" | "container" if ops.get(1).is_some_and(|s| *s == "prune" || *s == "rm") => {
                    ex.effect("deletes", format!("removes {name} data ({sub} {})", ops[1]))
                }
                "push" => ex.effect("publish", format!("pushes an image to a registry with {name}")),
                "run" | "exec" | "compose" | "start" | "up" => ex.effect("runs", format!("runs a container with {name}")),
                "build" | "pull" => ex.effect("network", format!("{name} {sub} downloads images")),
                _ => ex.effect("runs", format!("runs {name} {sub}").trim_end().to_string()),
            }
        }
        "kubectl" | "helm" => {
            let sub = ops.first().copied().unwrap_or("");
            if matches!(sub, "apply" | "create" | "delete" | "patch" | "replace" | "scale" | "install" | "upgrade" | "uninstall" | "rollout" | "edit") {
                ex.effect("network", format!("changes the live cluster ({name} {sub})"));
                if name == "kubectl" && !args.iter().any(|a| a.starts_with("--dry-run")) {
                    ex.preview(format!("kubectl {} --dry-run=server", quoted(args)));
                }
            }
        }
        "terraform" | "tofu" | "pulumi" => {
            let sub = ops.first().copied().unwrap_or("");
            match sub {
                "apply" | "up" => {
                    ex.effect("network", format!("changes real infrastructure ({name} {sub})"));
                    ex.preview(format!("{name} {}", if name == "pulumi" { "preview" } else { "plan" }));
                }
                "destroy" => {
                    ex.effect("deletes", format!("destroys real infrastructure ({name} destroy)"));
                    ex.preview(format!("{name} plan -destroy"));
                }
                _ => {}
            }
        }
        "make" => {
            ex.effect("runs", "runs the project's Makefile, which can do anything its rules say");
            if !has_flag(args, 'n', "--dry-run") {
                ex.preview(format!("make -n {}", quoted(args)).trim_end().to_string());
            }
        }
        n if QUIET.contains(&n) => {}
        n if RUNNERS.contains(&n) => {
            ex.effect("runs", format!("runs project code with {n}"));
        }
        n if n.starts_with("./") || first.starts_with("./") || first.starts_with('/') => {
            ex.effect("runs", format!("runs the program {first}"));
        }
        n => {
            if !ex.unrecognised.iter().any(|u| u == n) {
                ex.unrecognised.push(n.to_string());
            }
        }
    }
    Some(name)
}

fn explain_fetch(name: &str, args: &[String], ex: &mut Explanation) {
    let ops = operands(args);
    let sends = args.iter().any(|a| {
        matches!(
            a.as_str(),
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" | "-F" | "--form"
                | "-T" | "--upload-file" | "--json" | "--post-data" | "--post-file" | "-Body" | "-InFile"
        ) || a.starts_with("--data")
    }) || args
        .windows(2)
        .any(|w| (w[0] == "-X" || w[0] == "--request" || w[0] == "-Method") && !w[1].eq_ignore_ascii_case("GET"));
    let hosts: Vec<String> = ops.iter().filter_map(|o| url_host(o).or_else(|| bare_host(o))).collect();
    for h in &hosts {
        ex.host(h);
    }
    let to = if hosts.is_empty() { "a server".to_string() } else { hosts.join(", ") };
    if sends {
        ex.effect("network", format!("sends data to {to}"));
    } else {
        ex.effect("network", format!("downloads from {to}"));
    }
    let output = args.windows(2).find_map(|w| {
        (w[0] == "-o" || w[0] == "--output" || w[0] == "-O" && name == "wget" || w[0] == "-OutFile").then(|| w[1].clone())
    });
    if let Some(file) = output {
        ex.path(&file);
        ex.effect("writes", format!("saves the download as {file}"));
    } else if (name == "curl" && args.iter().any(|a| a == "-O" || a == "--remote-name")) || name == "wget" {
        ex.effect("writes", "saves the download in this folder");
    }
}

fn explain_git(args: &[String], ex: &mut Explanation) {
    let ops = operands(args);
    let sub = ops.first().copied().unwrap_or("");
    let rest = &ops[ops.len().min(1)..];
    match sub {
        "push" => {
            let remote = rest.first().copied().unwrap_or("the default remote");
            if let Some(h) = url_host(remote).or_else(|| scp_host(remote)) {
                ex.host(&h);
            }
            let force = args.iter().any(|a| a == "-f" || a == "--force" || a.starts_with("--force-with-lease") || a == "--mirror")
                || rest.iter().any(|r| r.starts_with('+'));
            let delete = args.iter().any(|a| a == "-d" || a == "--delete") || rest.iter().any(|r| r.starts_with(':'));
            if force {
                ex.effect("deletes", format!("force-pushes to {remote}, which can throw away commits already there"));
            } else if delete {
                ex.effect("deletes", format!("deletes a branch or tag on {remote}"));
            } else {
                ex.effect("publish", format!("publishes commits to {remote}"));
            }
            let without: Vec<String> = args.iter().filter(|a| *a != "push").cloned().collect();
            ex.preview(format!("git push --dry-run {}", quoted(&without)).trim_end().to_string());
        }
        "commit" => {
            if args.iter().any(|a| a == "--amend") {
                ex.effect("writes", "rewrites the last commit");
            } else {
                ex.effect("writes", "records a commit in this repository");
            }
        }
        "reset" if args.iter().any(|a| a == "--hard") => {
            ex.effect("deletes", "throws away every uncommitted change in this repository");
            ex.preview("git status --short && git diff --stat".into());
        }
        "clean" => {
            let mut text = "deletes untracked files".to_string();
            if has_flag(args, 'd', "--directories") {
                text.push_str(" and folders");
            }
            if has_flag(args, 'x', "--ignored") {
                text.push_str(", including ignored ones such as build output and .env files");
            }
            ex.effect("deletes", text);
            let flags: String = args.iter().filter(|a| a.starts_with('-') && !a.starts_with("--")).flat_map(|a| a[1..].chars()).filter(|c| *c != 'f').collect();
            ex.preview(format!("git clean -n{flags}"));
        }
        "checkout" | "restore" if rest.iter().any(|r| *r == "." || *r == "--") || args.iter().any(|a| a == "--") => {
            ex.effect("deletes", "discards uncommitted changes to the files it names");
            ex.preview("git diff --stat".into());
        }
        "checkout" | "switch" => ex.effect("writes", "switches branch, changing the files in this folder"),
        "rebase" => ex.effect("writes", "rewrites the history of the current branch"),
        "merge" => ex.effect("writes", "merges another branch into the current one"),
        "pull" => {
            ex.effect("network", format!("fetches from {} and merges into the current branch", rest.first().copied().unwrap_or("the default remote")));
        }
        "fetch" => ex.effect("network", format!("downloads from {}", rest.first().copied().unwrap_or("the default remote"))),
        "clone" => {
            if let Some(url) = rest.first() {
                if let Some(h) = url_host(url).or_else(|| scp_host(url)) {
                    ex.host(&h);
                }
            }
            ex.effect("network", "downloads a repository into a new folder");
        }
        "branch" if args.iter().any(|a| a == "-D" || a == "-d" || a == "--delete") => {
            ex.effect("deletes", format!("deletes the branch {}", list(rest)));
        }
        "stash" if rest.first().is_some_and(|s| *s == "drop" || *s == "clear") => {
            ex.effect("deletes", "deletes stashed changes");
        }
        "tag" if args.iter().any(|a| a == "-d" || a == "--delete") => ex.effect("deletes", "deletes a tag"),
        "add" | "rm" | "mv" | "stash" | "tag" | "cherry-pick" | "revert" | "apply" | "am" | "init" => {
            ex.effect("writes", format!("changes this repository (git {sub})"));
        }
        // status, log, diff, show, branch, remote -v, rev-parse, blame…: reading.
        _ => {}
    }
}

fn explain_gh(args: &[String], ex: &mut Explanation) {
    let ops = operands(args);
    ex.host("github.com");
    let what = ops.iter().take(2).copied().collect::<Vec<_>>().join(" ");
    let writes = ["create", "merge", "close", "delete", "edit", "comment", "review", "release", "upload", "fork", "sync"];
    if ops.iter().take(2).any(|o| writes.contains(o)) || what.starts_with("api") && args.iter().any(|a| a == "-X" || a == "--method" || a == "-f" || a == "-F") {
        ex.effect("publish", format!("changes something on GitHub (gh {what})"));
    } else {
        ex.effect("network", format!("reads from GitHub (gh {what})"));
    }
}

fn explain_node(name: &str, args: &[String], ex: &mut Explanation) {
    let ops = operands(args);
    let sub = ops.first().copied().unwrap_or("");
    match sub {
        "install" | "i" | "add" | "ci" | "update" | "up" | "upgrade" => {
            ex.effect("installs", format!("installs packages with {name}, downloading them and running their install scripts"));
        }
        "" if name != "npm" && name != "npx" && name != "pnpx" => {
            ex.effect("installs", format!("installs packages with {name}, downloading them and running their install scripts"));
        }
        "remove" | "rm" | "uninstall" | "un" => ex.effect("writes", format!("removes packages with {name}")),
        "publish" => {
            ex.effect("publish", format!("publishes this package to the registry with {name}"));
            if !args.iter().any(|a| a == "--dry-run") {
                ex.preview(format!("{name} publish --dry-run"));
            }
        }
        "exec" | "dlx" | "x" => ex.effect("installs", format!("downloads and runs a package with {name}")),
        _ if name == "npx" || name == "pnpx" => {
            ex.effect("installs", format!("downloads and runs {} if it is not installed", ops.first().copied().unwrap_or("a package")));
        }
        _ => ex.effect("runs", format!("runs the project's {} script with {name}", if sub == "run" { ops.get(1).copied().unwrap_or("") } else { sub })),
    }
}

fn explain_cargo(args: &[String], ex: &mut Explanation) {
    let ops = operands(args);
    let sub = ops.first().copied().unwrap_or("");
    match sub {
        "publish" => {
            ex.effect("publish", "publishes this crate to crates.io — permanently, a version cannot be deleted");
            ex.host("crates.io");
            if !args.iter().any(|a| a == "--dry-run") {
                ex.preview("cargo publish --dry-run".into());
            }
        }
        "install" | "add" | "update" => ex.effect("installs", format!("downloads crates (cargo {sub})")),
        "fmt" if !args.iter().any(|a| a == "--check") => {
            ex.effect("writes", "reformats source files in place");
            ex.preview("cargo fmt --check".into());
        }
        "clean" => ex.effect("deletes", "deletes the build output in target/"),
        "fix" | "clippy" if args.iter().any(|a| a == "--fix") || sub == "fix" => {
            ex.effect("writes", "edits source files to apply suggested fixes")
        }
        _ => ex.effect("runs", format!("builds and runs project code (cargo {sub})").replace(" ()", "")),
    }
}

/// The host in `scheme://host[:port]/…`.
fn url_host(word: &str) -> Option<String> {
    let (scheme, rest) = word.split_once("://")?;
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || c == '+') {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    let host = if host.starts_with('[') {
        host.split(']').next().map(|h| format!("{h}]"))?
    } else {
        host.split(':').next()?.to_string()
    };
    (!host.is_empty()).then_some(host)
}

/// The host in `git@github.com:owner/repo`.
fn scp_host(word: &str) -> Option<String> {
    if word.contains("://") {
        return None;
    }
    let (left, _) = word.split_once(':')?;
    let host = left.rsplit('@').next()?;
    (host.contains('.') && !host.contains('/')).then(|| host.to_string())
}

/// `example.com/path` with no scheme, as curl accepts.
fn bare_host(word: &str) -> Option<String> {
    let host = word.split(['/', '?']).next()?;
    let host = host.split(':').next()?;
    let looks = host.contains('.')
        && !host.starts_with('.')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && host.rsplit('.').next().is_some_and(|tld| tld.chars().all(|c| c.is_ascii_alphabetic()) && tld.len() >= 2);
    looks.then(|| host.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(ex: &Explanation) -> Vec<&'static str> {
        ex.effects.iter().map(|e| e.kind).collect()
    }
    fn says(ex: &Explanation, needle: &str) -> bool {
        ex.effects.iter().any(|e| e.text.contains(needle))
    }

    #[test]
    fn a_recursive_forced_delete_names_its_paths_and_how() {
        let ex = explain("rm -rf build dist");
        assert_eq!(kinds(&ex), ["deletes"]);
        assert!(says(&ex, "deletes build, dist, and everything inside, without asking"), "{ex:?}");
        assert_eq!(ex.paths, ["build", "dist"]);
        assert_eq!(ex.dry_run.as_deref(), Some("ls -laR build dist"));
    }

    #[test]
    fn a_quoted_path_is_one_path() {
        let ex = explain("rm \"my notes.txt\"");
        assert_eq!(ex.paths, ["my notes.txt"]);
        assert_eq!(ex.dry_run.as_deref(), Some("ls -la 'my notes.txt'"));
    }

    #[test]
    fn a_delete_hidden_after_a_harmless_command_is_still_explained() {
        let ex = explain("ls && rm -rf ~/projects");
        assert!(says(&ex, "deletes ~/projects"), "{ex:?}");
    }

    #[test]
    fn redirects_say_which_file_is_overwritten_or_appended_to() {
        let ex = explain("cargo test > out.txt 2>&1 && echo done >> log.txt");
        assert!(says(&ex, "overwrites out.txt"));
        assert!(says(&ex, "appends to log.txt"));
        assert_eq!(ex.paths, ["out.txt", "log.txt"]);
        assert!(!ex.paths.iter().any(|p| p == "1" || p == "&1"), "a stream duplicate is not a file");
    }

    #[test]
    fn a_stream_number_is_not_mistaken_for_a_path() {
        let ex = explain("rm old.log 2> errors.txt");
        assert!(says(&ex, "deletes old.log"), "{ex:?}");
        assert!(!says(&ex, "old.log, 2"), "{ex:?}");
        assert_eq!(ex.paths, ["errors.txt", "old.log"]);
    }

    #[test]
    fn writing_to_dev_null_is_not_a_file_change() {
        let ex = explain("cargo build 2> /dev/null");
        assert!(ex.paths.is_empty(), "{ex:?}");
    }

    #[test]
    fn a_download_names_the_host_it_reaches() {
        let ex = explain("curl -fsSL https://api.example.com/v1/status");
        assert_eq!(ex.hosts, ["api.example.com"]);
        assert!(says(&ex, "downloads from api.example.com"));
    }

    #[test]
    fn sending_data_is_distinguished_from_downloading() {
        let ex = explain("curl -X POST -d @payload.json https://hooks.example.com/notify");
        assert!(says(&ex, "sends data to hooks.example.com"), "{ex:?}");
    }

    #[test]
    fn piping_a_download_into_a_shell_is_called_out() {
        let ex = explain("curl -fsSL https://get.example.sh | sh");
        assert!(says(&ex, "runs whatever curl outputs as a script"), "{ex:?}");
        assert_eq!(ex.hosts, ["get.example.sh"]);
    }

    #[test]
    fn sudo_is_named_and_the_command_behind_it_still_explained() {
        let ex = explain("sudo -u root rm -rf /var/cache/app");
        assert_eq!(kinds(&ex), ["admin", "deletes"]);
        assert!(says(&ex, "/var/cache/app"));
    }

    #[test]
    fn a_push_names_the_remote_and_offers_a_dry_run() {
        let ex = explain("git push origin main");
        assert_eq!(kinds(&ex), ["publish"]);
        assert!(says(&ex, "publishes commits to origin"));
        assert_eq!(ex.dry_run.as_deref(), Some("git push --dry-run origin main"));
    }

    #[test]
    fn a_force_push_says_what_it_can_lose() {
        for cmd in ["git push --force origin main", "git push -f", "git push origin +main"] {
            let ex = explain(cmd);
            assert!(says(&ex, "can throw away commits"), "{cmd}: {ex:?}");
        }
    }

    #[test]
    fn a_push_to_a_url_names_its_host() {
        let ex = explain("git push git@github.com:me/repo.git main");
        assert_eq!(ex.hosts, ["github.com"]);
    }

    #[test]
    fn git_clean_previews_with_the_same_flags() {
        let ex = explain("git clean -fdx");
        assert!(says(&ex, "deletes untracked files and folders, including ignored ones"), "{ex:?}");
        assert_eq!(ex.dry_run.as_deref(), Some("git clean -ndx"));
    }

    #[test]
    fn a_hard_reset_says_it_throws_work_away() {
        let ex = explain("git reset --hard HEAD~1");
        assert!(says(&ex, "throws away every uncommitted change"));
        assert!(ex.dry_run.is_some());
    }

    #[test]
    fn reading_commands_add_nothing() {
        for cmd in ["git status", "git log --oneline -5", "ls -la", "cat README.md | grep x", "git diff HEAD"] {
            let ex = explain(cmd);
            assert!(ex.effects.is_empty() && ex.unrecognised.is_empty(), "{cmd}: {ex:?}");
        }
    }

    #[test]
    fn an_unknown_program_is_named_rather_than_assumed_safe() {
        let ex = explain("frobnicate --all");
        assert_eq!(ex.unrecognised, ["frobnicate"]);
    }

    #[test]
    fn command_substitution_is_flagged_as_unseen() {
        let ex = explain("rm $(cat files.txt)");
        assert!(says(&ex, "cannot see what that part runs"), "{ex:?}");
        assert!(says(&ex, "deletes $(cat files.txt)"), "kept as one word: {ex:?}");
    }

    #[test]
    fn installing_packages_says_install_scripts_run() {
        let ex = explain("npm install left-pad");
        assert_eq!(kinds(&ex), ["installs"]);
        assert!(says(&ex, "running their install scripts"));
    }

    #[test]
    fn publishing_offers_a_dry_run() {
        assert_eq!(explain("npm publish").dry_run.as_deref(), Some("npm publish --dry-run"));
        let cargo = explain("cargo publish");
        assert!(says(&cargo, "permanently"));
        assert_eq!(cargo.dry_run.as_deref(), Some("cargo publish --dry-run"));
    }

    #[test]
    fn in_place_edits_name_the_file_and_preview_the_change() {
        let ex = explain("sed -i 's/foo/bar/g' src/main.rs");
        assert!(says(&ex, "edits src/main.rs in place"), "{ex:?}");
        assert_eq!(ex.dry_run.as_deref(), Some("sed s/foo/bar/g src/main.rs | diff src/main.rs -"));
    }

    #[test]
    fn ssh_names_the_host_without_the_user() {
        let ex = explain("ssh deploy@prod.example.com 'systemctl restart api'");
        assert_eq!(ex.hosts, ["prod.example.com"]);
        assert!(says(&ex, "runs a command on prod.example.com"));
    }

    #[test]
    fn rsync_offers_its_own_dry_run_and_says_when_it_deletes() {
        let ex = explain("rsync -av --delete dist/ deploy@web.example.com:/srv/site");
        assert!(says(&ex, "deletes files at the destination"), "{ex:?}");
        assert_eq!(ex.hosts, ["web.example.com"]);
        assert_eq!(
            ex.dry_run.as_deref(),
            Some("rsync --dry-run -av --delete dist/ deploy@web.example.com:/srv/site")
        );
    }

    #[test]
    fn infrastructure_changes_preview_with_a_plan() {
        assert_eq!(explain("terraform apply -auto-approve").dry_run.as_deref(), Some("terraform plan"));
        assert_eq!(
            explain("kubectl apply -f deploy.yaml").dry_run.as_deref(),
            Some("kubectl apply -f deploy.yaml --dry-run=server")
        );
    }

    #[test]
    fn running_tests_says_project_code_runs() {
        let ex = explain("cargo test --workspace");
        assert_eq!(kinds(&ex), ["runs"]);
        assert!(says(&ex, "cargo test"));
    }

    #[test]
    fn the_same_effect_is_not_listed_twice() {
        let ex = explain("echo a > x.txt; echo b > x.txt");
        assert_eq!(ex.effects.len(), 1);
        assert_eq!(ex.paths, ["x.txt"]);
    }

    #[test]
    fn find_delete_previews_without_deleting() {
        let ex = explain("find . -name '*.orig' -delete");
        assert!(says(&ex, "deletes every file it finds"));
        assert_eq!(ex.dry_run.as_deref(), Some("find . -name '*.orig'"));
    }

    #[test]
    fn an_unterminated_quote_does_not_panic() {
        let _ = explain("echo 'unfinished");
        let _ = explain("rm \"half");
        let _ = explain("a \\");
        let _ = explain("> ");
        let _ = explain("");
    }
}
