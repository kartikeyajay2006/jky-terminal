//! The Apps section's fetches, over IPC.
//!
//! Thin wrappers, as everywhere else in this directory: the request, the URL
//! building and the parsing all live in `jky-apps`, where they are testable
//! without launching a window. What is here is the boundary — turning a typed
//! error into a sentence the panel can show a person.
//!
//! These exist at all because the window cannot fetch. `connect-src 'self'`
//! means the webview can reach no host, so every outbound request is made by
//! Rust and the result comes back over IPC. Weather needs no key and no
//! account, so there is nothing secret in this path; the boundary is about
//! where network access lives, not about protecting a credential.

use jky_apps::weather::{self, Place, Report};
use tauri::State;

use crate::state::AppState;

/// A coordinate the window sent, checked before it reaches a URL.
///
/// The renderer is not trusted to have validated. Out-of-range numbers would
/// be rejected by the service anyway, but NaN formats as the literal text
/// "NaN" in a query string, which is a malformed request rather than a
/// refused one — and the error a person would see says nothing useful.
fn check_coordinate(latitude: f64, longitude: f64) -> Result<(), String> {
    if !latitude.is_finite() || !longitude.is_finite() {
        return Err("that location is not a real coordinate".into());
    }
    if !(-90.0..=90.0).contains(&latitude) {
        return Err("latitude has to be between -90 and 90".into());
    }
    if !(-180.0..=180.0).contains(&longitude) {
        return Err("longitude has to be between -180 and 180".into());
    }
    Ok(())
}

/// The longest search term worth sending.
///
/// No place name approaches this. The bound is here so a megabyte pasted into
/// the box becomes a refusal rather than a megabyte-long URL.
const MAX_QUERY: usize = 120;

fn check_query(query: &str) -> Result<String, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("type somewhere to look for".into());
    }
    if trimmed.chars().count() > MAX_QUERY {
        return Err("that search is too long".into());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn apps_weather(
    state: State<'_, AppState>,
    latitude: f64,
    longitude: f64,
) -> Result<Report, String> {
    check_coordinate(latitude, longitude)?;
    weather::fetch_report(&state.http, latitude, longitude)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apps_weather_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Place>, String> {
    let query = check_query(&query)?;
    weather::search_places(&state.http, &query)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_real_coordinate() {
        assert!(check_coordinate(28.65, 77.23).is_ok());
        assert!(check_coordinate(-90.0, 180.0).is_ok());
    }

    #[test]
    fn refuses_a_coordinate_off_the_globe() {
        assert!(check_coordinate(91.0, 0.0).is_err());
        assert!(check_coordinate(0.0, -181.0).is_err());
    }

    // NaN formats as the text "NaN" in a query string, which produces a
    // malformed request rather than a refused one.
    #[test]
    fn refuses_a_coordinate_that_is_not_a_number() {
        assert!(check_coordinate(f64::NAN, 0.0).is_err());
        assert!(check_coordinate(0.0, f64::INFINITY).is_err());
    }

    #[test]
    fn trims_a_search_term() {
        assert_eq!(check_query("  Delhi  ").unwrap(), "Delhi");
    }

    #[test]
    fn refuses_an_empty_search() {
        assert!(check_query("   ").is_err());
    }

    #[test]
    fn refuses_a_search_longer_than_any_place_name() {
        assert!(check_query(&"a".repeat(MAX_QUERY + 1)).is_err());
    }

    // Counted in characters rather than bytes: a name in a non-Latin script
    // is several bytes per character, and a byte bound would refuse a shorter
    // name than the one it refuses in English.
    #[test]
    fn measures_the_bound_in_characters_not_bytes() {
        assert!(check_query(&"é".repeat(MAX_QUERY)).is_ok());
    }
}
