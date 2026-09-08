//! What happens to a picture once the window has taken one.
//!
//! The window renders itself and hands over PNG bytes; everything after that
//! is an effect on the machine, so it happens here rather than there. The
//! renderer has no filesystem capability and no clipboard access, and this
//! crate is the reason it does not need either.
//!
//! Two destinations, and they are not variations of one thing. **Saving** is
//! for keeping: a file, with a name that sorts chronologically. **Copying** is
//! for sending: the image on the clipboard and nothing written to disk, since
//! somebody pasting a screenshot into a chat did not ask for a file to clean
//! up afterwards.

use std::path::{Path, PathBuf};

/// The largest capture this will handle, in bytes.
///
/// A 4K window at 2x is around 12MB of PNG; 64MB is far above anything the
/// renderer can legitimately produce and still small enough that a malformed
/// or hostile payload cannot exhaust memory here.
pub const MAX_CAPTURE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("that capture is empty")]
    Empty,
    #[error("that capture is too large to handle")]
    TooLarge,
    #[error("that is not a PNG")]
    NotPng,
    #[error("the capture could not be written: {0}")]
    Write(String),
    #[error("the capture could not be put on the clipboard: {0}")]
    Clipboard(String),
}

/// Every PNG begins with these eight bytes.
///
/// Checked before anything else touches the payload. The window is the only
/// caller today, but this crate's job is to be the place where that stops
/// being load-bearing.
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Reject anything that is not a plausible PNG before acting on it.
pub fn check(bytes: &[u8]) -> Result<(), CaptureError> {
    if bytes.is_empty() {
        return Err(CaptureError::Empty);
    }
    if bytes.len() > MAX_CAPTURE_BYTES {
        return Err(CaptureError::TooLarge);
    }
    if !bytes.starts_with(&PNG_MAGIC) {
        return Err(CaptureError::NotPng);
    }
    Ok(())
}

/// The name a capture is saved under, from a Unix timestamp.
///
/// Sorts chronologically as text, which is the only property that matters in a
/// downloads folder holding a hundred of them. Seconds resolution is enough:
/// `unique_path` handles the case of two captures inside the same second, and
/// a name carrying milliseconds would be noise in every other case.
pub fn capture_filename(unix_secs: u64) -> String {
    let days = unix_secs / 86_400;
    let rem = unix_secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "jky-terminal-{y:04}-{m:02}-{d:02}-{:02}{:02}{:02}.png",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days-from-civil, inverted. Public domain algorithm.
///
/// The same one `jky-audit` uses, and for the same reason: a date crate is a
/// large dependency to take on for one `format!`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A path in `dir` that nothing occupies yet.
///
/// Two captures inside one second would otherwise silently overwrite each
/// other, and losing the first one is exactly the kind of thing a person would
/// not notice until they went looking for it.
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = filename.strip_suffix(".png").unwrap_or(filename);
    for n in 2..1000 {
        let next = dir.join(format!("{stem}-{n}.png"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}-{}.png", std::process::id()))
}

/// Write a capture into `dir`, returning where it landed.
pub fn save(dir: &Path, bytes: &[u8], unix_secs: u64) -> Result<PathBuf, CaptureError> {
    check(bytes)?;
    std::fs::create_dir_all(dir).map_err(|e| CaptureError::Write(e.to_string()))?;
    let path = unique_path(dir, &capture_filename(unix_secs));
    std::fs::write(&path, bytes).map_err(|e| CaptureError::Write(e.to_string()))?;
    Ok(path)
}

/// Put a capture on the system clipboard, writing nothing to disk.
///
/// One platform caveat, verified rather than assumed: on Wayland the clipboard
/// is *served by a live process*, so the image survives exactly as long as the
/// app does — quit it and a pasted-nowhere capture is gone, unless the desktop
/// runs a clipboard manager. That is how every Wayland application behaves and
/// there is nothing to fix here; it is written down because the alternative is
/// somebody re-discovering it as a bug.
///
/// Checked on Hyprland with `wl-paste --list-types`: `image/png`, and the
/// bytes read back.
pub fn copy_to_clipboard(bytes: &[u8]) -> Result<(), CaptureError> {
    check(bytes)?;
    let (width, height, rgba) = decode_rgba(bytes)?;
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| CaptureError::Clipboard(e.to_string()))?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(rgba),
        })
        .map_err(|e| CaptureError::Clipboard(e.to_string()))
}

/// A PNG as raw RGBA, which is the only form a clipboard accepts.
fn decode_rgba(bytes: &[u8]) -> Result<(usize, usize, Vec<u8>), CaptureError> {
    let decoder = png::Decoder::new(bytes);
    let mut reader = decoder
        .read_info()
        .map_err(|e| CaptureError::Clipboard(e.to_string()))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| CaptureError::Clipboard(e.to_string()))?;
    buf.truncate(info.buffer_size());

    // The window always encodes RGBA, but a decoder that assumes its input
    // rather than checking it is a decoder that panics on the one file that is
    // different.
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 0xff])
            .collect(),
        other => {
            return Err(CaptureError::Clipboard(format!(
                "unsupported colour type {other:?}"
            )))
        }
    };
    Ok((info.width as usize, info.height as usize, rgba))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-pixel PNG, so the guards can be tested against a real header.
    fn tiny_png() -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[9, 8, 7, 255]).unwrap();
        }
        out
    }

    #[test]
    fn a_name_says_when_it_was_taken() {
        // 2023-11-14T22:13:20Z, checked against `date -u -d @1700000000`.
        assert_eq!(
            capture_filename(1_700_000_000),
            "jky-terminal-2023-11-14-221320.png"
        );
    }

    #[test]
    fn names_sort_chronologically_as_text() {
        let earlier = capture_filename(1_700_000_000);
        let later = capture_filename(1_700_003_600);
        assert!(earlier < later, "{earlier} should sort before {later}");
    }

    #[test]
    fn a_name_is_a_png_with_the_app_in_it() {
        let name = capture_filename(1_700_000_000);
        assert!(name.starts_with("jky-terminal-"), "{name}");
        assert!(name.ends_with(".png"), "{name}");
    }

    #[test]
    fn two_captures_in_one_second_do_not_overwrite_each_other() {
        let dir = std::env::temp_dir().join(format!("jky-cap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = tiny_png();

        let first = save(&dir, &png, 1_700_000_000).unwrap();
        let second = save(&dir, &png, 1_700_000_000).unwrap();

        assert_ne!(first, second, "the second capture replaced the first");
        assert!(first.exists() && second.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_that_is_not_a_png_is_written_anywhere() {
        assert!(matches!(check(b"not a png at all"), Err(CaptureError::NotPng)));
        assert!(matches!(check(&[]), Err(CaptureError::Empty)));
        assert!(matches!(
            check(&vec![0u8; MAX_CAPTURE_BYTES + 1]),
            Err(CaptureError::TooLarge)
        ));
    }

    #[test]
    fn a_real_png_passes_the_guard() {
        assert!(check(&tiny_png()).is_ok());
    }

    #[test]
    fn a_png_decodes_to_the_rgba_a_clipboard_wants() {
        let (w, h, rgba) = decode_rgba(&tiny_png()).unwrap();
        assert_eq!((w, h), (1, 1));
        assert_eq!(rgba, vec![9, 8, 7, 255]);
    }
}
