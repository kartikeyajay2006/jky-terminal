mod registry;
mod session;
mod shell;

pub use registry::PtyRegistry;
pub use session::{PtyError, PtySession, SpawnConfig};
pub use shell::{ShellSpec, default_shell, pty_env, resolve_shell};
