//! The Browser app's webview.
//!
//! A native child webview docked into the main window, not an iframe. That is
//! not a preference: GitHub and Jira send `X-Frame-Options: deny`, and Slack,
//! Notion, Figma, YouTube and Reddit all send `SAMEORIGIN`, so an iframe-based
//! browser cannot open most of the web. Framing rules govern nested browsing
//! contexts only, and a native webview is a top-level one.
//!
//! Three things make this safe to have in the app.
//!
//! It has **no capabilities**. Tauri grants a window-scoped capability to
//! every webview in that window, so `capabilities/default.json` is scoped to
//! the webview labelled `main` instead. This one is labelled `browser` and
//! matches nothing, so a page loaded from the internet cannot call a single
//! Tauri command. A test in `tests/security.rs` pins that.
//!
//! It is **private**. The webview is incognito, so cookies, storage and
//! history are held in memory and gone when it closes — nothing a site leaves
//! behind survives to the next session, and nothing is written to disk.
//!
//! It **only loads the web**. Every address goes through `jky_apps::browser`,
//! which permits `http` and `https` and refuses everything else — `file://`
//! most of all, since that would turn the address bar into a reader for the
//! whole disk.
//!
//! The engine is whatever the operating system ships: WebKitGTK on Linux,
//! WKWebView on macOS, WebView2 on Windows. Nothing is bundled, so this costs
//! no download size and no memory beyond the page being shown.

use jky_apps::browser;
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl, Window};

/// The label of the browser webview. Matches no capability, deliberately.
pub const BROWSER_LABEL: &str = "browser";

/// Where the pane sits, in logical pixels, as the window measured it.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A rectangle, checked before it becomes a webview's bounds.
///
/// A zero or negative size is not a pane, and a wildly large one would push
/// the webview off the window where it cannot be closed.
fn check(rect: Rect) -> Result<Rect, String> {
    let sane = |v: f64| v.is_finite() && (-8192.0..=32768.0).contains(&v);
    if !sane(rect.x) || !sane(rect.y) || !sane(rect.width) || !sane(rect.height) {
        return Err("that is not a usable size".into());
    }
    if rect.width < 1.0 || rect.height < 1.0 {
        return Err("that is not a usable size".into());
    }
    Ok(rect)
}

/// Open the browser at a URL, or point the open one at it.
#[tauri::command]
pub async fn browser_open(window: Window, url: String, rect: Rect) -> Result<String, String> {
    let target = browser::normalise(&url).map_err(|e| e.to_string())?;
    let rect = check(rect)?;

    if let Some(existing) = window.get_webview(BROWSER_LABEL) {
        existing
            .navigate(target.parse().map_err(|_| "that address could not be read")?)
            .map_err(|e| format!("could not open that: {e}"))?;
        return Ok(target);
    }

    let builder = tauri::webview::WebviewBuilder::new(
        BROWSER_LABEL,
        WebviewUrl::External(target.parse().map_err(|_| "that address could not be read")?),
    )
    // Nothing a site leaves behind survives the session, and nothing is
    // written to disk.
    .incognito(true)
    // Ordinary on purpose: a user agent nobody else sends is a fingerprint.
    .user_agent(browser::USER_AGENT);

    window
        .add_child(
            builder,
            LogicalPosition::new(rect.x, rect.y),
            LogicalSize::new(rect.width, rect.height),
        )
        .map_err(|e| format!("could not open the browser: {e}"))?;

    Ok(target)
}

/// Move and resize the pane, as the window's layout changes.
#[tauri::command]
pub fn browser_place(window: Window, rect: Rect) -> Result<(), String> {
    let rect = check(rect)?;
    let Some(webview) = window.get_webview(BROWSER_LABEL) else {
        return Ok(());
    };
    webview
        .set_position(LogicalPosition::new(rect.x, rect.y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(rect.width, rect.height))
        .map_err(|e| e.to_string())
}

/// Close it. Being incognito, this is also what discards everything it held.
#[tauri::command]
pub fn browser_close(window: Window) -> Result<(), String> {
    if let Some(webview) = window.get_webview(BROWSER_LABEL) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Back, forward and reload.
///
/// Driven through the page's own history rather than a Tauri API, because
/// there is not one — and `history.go` is what the buttons in every browser
/// do anyway. The argument is a number this function chooses, never a string
/// from the window, so there is nothing here to inject into.
#[tauri::command]
pub fn browser_history(window: Window, step: i8) -> Result<(), String> {
    let Some(webview) = window.get_webview(BROWSER_LABEL) else {
        return Ok(());
    };
    let script = match step {
        0 => "location.reload()".to_string(),
        n if n < 0 => "history.back()".to_string(),
        _ => "history.forward()".to_string(),
    };
    webview.eval(&script).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, width: w, height: h }
    }

    #[test]
    fn accepts_a_pane_the_size_of_a_pane() {
        assert!(check(rect(200.0, 80.0, 900.0, 600.0)).is_ok());
    }

    // A zero-sized webview is invisible and cannot be closed by clicking it.
    #[test]
    fn refuses_a_size_that_is_not_a_size() {
        assert!(check(rect(0.0, 0.0, 0.0, 600.0)).is_err());
        assert!(check(rect(0.0, 0.0, 900.0, 0.0)).is_err());
        assert!(check(rect(0.0, 0.0, -10.0, 600.0)).is_err());
    }

    // NaN reaches the platform layer as a nonsense coordinate rather than a
    // refusal, the same trap the weather command's coordinates had.
    #[test]
    fn refuses_a_position_that_is_not_a_number() {
        assert!(check(rect(f64::NAN, 0.0, 900.0, 600.0)).is_err());
        assert!(check(rect(0.0, f64::INFINITY, 900.0, 600.0)).is_err());
    }

    // Pushed far enough off the window, the pane cannot be reached to close.
    #[test]
    fn refuses_a_rectangle_far_outside_any_window() {
        assert!(check(rect(0.0, 0.0, 99_999.0, 600.0)).is_err());
        assert!(check(rect(-99_999.0, 0.0, 900.0, 600.0)).is_err());
    }

    // The label is what keeps this webview out of every capability.
    #[test]
    fn the_browser_webview_is_not_the_one_capabilities_name() {
        assert_ne!(BROWSER_LABEL, "main");
    }
}
