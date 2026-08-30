//! The apps that fetch.
//!
//! Every outbound request the Apps section makes happens here, in Rust, and
//! the result reaches the window over IPC. That is not an accident of layering:
//! the app's CSP names no host but `'self'`, so the window has no way to reach
//! the network and a compromised frontend has nowhere to send anything. Moving
//! a fetch into the webview to save a hop would quietly undo that.
//!
//! Parsing is kept separate from fetching throughout, so the shape of every
//! response is tested against a recorded fixture rather than against whatever
//! the network happens to return today.

pub mod weather;
