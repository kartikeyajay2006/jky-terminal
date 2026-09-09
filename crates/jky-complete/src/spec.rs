//! What a handful of commands take.
//!
//! Deliberately small and deliberately hand-written. The alternative — parsing
//! `--help` output — produces a table that is wrong in a different way for
//! every program, and a flag completed with Tab is a flag nobody re-reads.
//! A command not in here gets paths and nothing else, which is the honest
//! answer rather than an invented one.

use serde::Serialize;

/// What a command's arguments are, once past its flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Takes {
    /// Files and directories. The default for anything unknown.
    Paths,
    /// Git branches.
    Branches,
    /// Scripts from a package.json.
    Scripts,
    /// Nothing worth offering. `cd` takes only directories, `kill` a pid.
    Directories,
    Nothing,
}

/// One flag, and what it is for.
#[derive(Debug, Clone, Copy)]
pub struct Flag {
    pub name: &'static str,
    pub detail: &'static str,
}

/// One command's completions.
#[derive(Debug, Clone, Copy)]
pub struct Spec {
    pub command: &'static str,
    pub flags: &'static [Flag],
    /// Subcommands, when the command has them. Empty otherwise.
    pub subcommands: &'static [Flag],
    /// What the second word onwards means, given a subcommand.
    pub takes: Takes,
}

const fn f(name: &'static str, detail: &'static str) -> Flag {
    Flag { name, detail }
}

const GIT_FLAGS: &[Flag] = &[
    f("--all", "every branch or file"),
    f("--amend", "replace the last commit"),
    f("--force", "overwrite what is there"),
    f("--no-verify", "skip the hooks"),
    f("--oneline", "one line per commit"),
    f("--staged", "what is staged"),
    f("-a", "every tracked file"),
    f("-b", "make a new branch"),
    f("-m", "the message"),
];

const GIT_SUBCOMMANDS: &[Flag] = &[
    f("add", "stage changes"),
    f("branch", "list or make branches"),
    f("checkout", "switch branch or restore a file"),
    f("commit", "record what is staged"),
    f("diff", "what changed"),
    f("fetch", "get refs without merging"),
    f("log", "history"),
    f("merge", "join two histories"),
    f("pull", "fetch and merge"),
    f("push", "send commits"),
    f("rebase", "replay commits"),
    f("reset", "move the branch pointer"),
    f("restore", "put a file back"),
    f("stash", "put changes aside"),
    f("status", "what is changed and staged"),
    f("switch", "change branch"),
];

const DOCKER_SUBCOMMANDS: &[Flag] = &[
    f("build", "make an image"),
    f("compose", "run a compose file"),
    f("exec", "run in a running container"),
    f("images", "list images"),
    f("logs", "a container's output"),
    f("ps", "list containers"),
    f("pull", "fetch an image"),
    f("run", "start a container"),
    f("stop", "stop a container"),
];

const CARGO_SUBCOMMANDS: &[Flag] = &[
    f("add", "add a dependency"),
    f("build", "compile"),
    f("check", "compile without producing a binary"),
    f("clippy", "lint"),
    f("fmt", "format"),
    f("run", "compile and run"),
    f("test", "run the tests"),
];

const LS_FLAGS: &[Flag] = &[
    f("-a", "including dotfiles"),
    f("-h", "sizes a person can read"),
    f("-l", "one per line, with detail"),
    f("-t", "newest first"),
];

const NPM_SUBCOMMANDS: &[Flag] =
    &[f("install", "add dependencies"), f("run", "a script from package.json")];

/// Every command with something specific to say.
pub const SPECS: &[Spec] = &[
    Spec { command: "git", flags: GIT_FLAGS, subcommands: GIT_SUBCOMMANDS, takes: Takes::Paths },
    Spec {
        command: "docker",
        flags: &[f("-d", "in the background"), f("-it", "interactive, with a terminal")],
        subcommands: DOCKER_SUBCOMMANDS,
        takes: Takes::Paths,
    },
    Spec {
        command: "cargo",
        flags: &[
            f("--all-targets", "including tests and examples"),
            f("--release", "optimised"),
            f("--workspace", "every crate"),
            f("-p", "one package"),
        ],
        subcommands: CARGO_SUBCOMMANDS,
        takes: Takes::Paths,
    },
    Spec {
        command: "npm",
        flags: &[f("--save-dev", "as a development dependency")],
        subcommands: NPM_SUBCOMMANDS,
        takes: Takes::Scripts,
    },
    Spec {
        command: "pnpm",
        flags: &[f("--filter", "one workspace package"), f("-w", "the workspace root")],
        subcommands: NPM_SUBCOMMANDS,
        takes: Takes::Scripts,
    },
    Spec { command: "ls", flags: LS_FLAGS, subcommands: &[], takes: Takes::Paths },
    Spec {
        command: "cd",
        flags: &[],
        subcommands: &[],
        // A file is never an answer to `cd`, and offering one is offering a
        // command that cannot work.
        takes: Takes::Directories,
    },
    Spec {
        command: "rm",
        flags: &[f("-f", "without asking"), f("-i", "ask each time"), f("-r", "into directories")],
        subcommands: &[],
        takes: Takes::Paths,
    },
    Spec {
        command: "grep",
        flags: &[
            f("-i", "ignoring case"),
            f("-n", "with line numbers"),
            f("-r", "into directories"),
            f("-v", "what does not match"),
        ],
        subcommands: &[],
        takes: Takes::Paths,
    },
];

pub fn spec_for(command: &str) -> Option<&'static Spec> {
    // The program as invoked may carry a path: `/usr/bin/git` is git.
    let name = command.rsplit(['/', '\\']).next().unwrap_or(command);
    let name = name.strip_suffix(".exe").unwrap_or(name);
    SPECS.iter().find(|s| s.command == name)
}

/// What the word after `git checkout` means, given the subcommand.
pub fn takes_for(spec: &Spec, args: &[String]) -> Takes {
    let sub = args.iter().find(|a| !a.starts_with('-')).map(String::as_str);

    match (spec.command, sub) {
        // The commands that take a branch. Listed rather than assumed:
        // `git add` takes files, and offering branches there would be
        // offering something that cannot work.
        ("git", Some("checkout" | "switch" | "merge" | "rebase" | "branch")) => Takes::Branches,
        ("npm" | "pnpm", Some("run")) => Takes::Scripts,
        ("npm" | "pnpm", Some(_)) => Takes::Nothing,
        // A subcommand has not been chosen yet, so nothing more specific is
        // known than what the command itself takes.
        _ => spec.takes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_a_command_however_it_was_invoked() {
        assert!(spec_for("git").is_some());
        assert!(spec_for("/usr/bin/git").is_some());
        assert!(spec_for("git.exe").is_some());
        assert!(spec_for("C:\\Program Files\\Git\\git.exe").is_some());
    }

    #[test]
    fn knows_nothing_about_a_command_it_was_not_told_about() {
        // Which is the honest answer. A guessed flag is a flag nobody
        // re-reads before pressing Enter.
        assert!(spec_for("kubectl").is_none());
    }

    #[test]
    fn a_git_branch_is_offered_only_where_a_branch_belongs() {
        let git = spec_for("git").unwrap();
        assert_eq!(takes_for(git, &args(&["checkout"])), Takes::Branches);
        assert_eq!(takes_for(git, &args(&["switch"])), Takes::Branches);
        // `git add` takes files.
        assert_eq!(takes_for(git, &args(&["add"])), Takes::Paths);
    }

    #[test]
    fn a_flag_before_the_subcommand_does_not_hide_it() {
        let git = spec_for("git").unwrap();
        assert_eq!(takes_for(git, &args(&["--no-pager", "checkout"])), Takes::Branches);
    }

    #[test]
    fn npm_run_takes_scripts_and_npm_install_does_not() {
        let npm = spec_for("npm").unwrap();
        assert_eq!(takes_for(npm, &args(&["run"])), Takes::Scripts);
        assert_eq!(takes_for(npm, &args(&["install"])), Takes::Nothing);
    }

    #[test]
    fn cd_takes_directories_and_never_a_file() {
        assert_eq!(takes_for(spec_for("cd").unwrap(), &[]), Takes::Directories);
    }

    #[test]
    fn every_spec_is_distinct_and_sorted_where_it_claims_to_be() {
        let mut seen = std::collections::BTreeSet::new();
        for spec in SPECS {
            assert!(seen.insert(spec.command), "{} twice", spec.command);
            for window in spec.flags.windows(2) {
                assert!(window[0].name < window[1].name, "{} flags out of order", spec.command);
            }
            for window in spec.subcommands.windows(2) {
                assert!(window[0].name < window[1].name, "{} subcommands out of order", spec.command);
            }
        }
    }

    #[test]
    fn every_flag_says_what_it_is_for() {
        // A list of flags with no explanation is a man page with the useful
        // half removed.
        for spec in SPECS {
            for flag in spec.flags.iter().chain(spec.subcommands) {
                assert!(!flag.detail.is_empty(), "{} {}", spec.command, flag.name);
                assert!(flag.name.len() > 1, "{} {}", spec.command, flag.name);
            }
        }
    }
}
