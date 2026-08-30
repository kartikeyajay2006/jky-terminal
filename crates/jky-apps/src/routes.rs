//! How far apart two places are, and how long the drive takes.
//!
//! Two numbers, because they answer different questions and one of them is not
//! always available. The straight-line distance is arithmetic on two
//! coordinates and always works; the road distance comes from a routing
//! service and does not exist between, say, an island and a landlocked city.
//! Showing only the first would be useless for a journey, and showing only the
//! second would leave the panel blank whenever no road connects the two.
//!
//! Routing is OSRM's public demo server: keyless, which keeps Map in the "no
//! auth, ever" tier. It is meant for light use, and this asks it one question
//! when a person picks a second place — not on a timer and not per keystroke.

use serde::{Deserialize, Serialize};

use crate::places::PlaceError;

const OSRM: &str = "https://router.project-osrm.org/route/v1/driving";

/// Mean Earth radius in metres, as used by the haversine formula.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Route {
    /// Great-circle distance. Always available, because it is arithmetic.
    pub straight_m: f64,
    /// Distance by road, when a road route exists.
    pub road_m: Option<f64>,
    /// Driving time in seconds, when a road route exists.
    pub duration_s: Option<f64>,
}

#[derive(Deserialize)]
struct WireRoute {
    code: String,
    #[serde(default)]
    routes: Vec<WireLeg>,
}

#[derive(Deserialize)]
struct WireLeg {
    distance: f64,
    duration: f64,
}

/// Great-circle distance between two points, in metres.
///
/// The haversine formula, which stays accurate for short distances where the
/// simpler spherical law of cosines loses precision to floating point. It also
/// wraps correctly across the antimeridian, so Tokyo to Los Angeles is not
/// measured the long way round the planet.
pub fn straight_line_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();

    let a = (dlat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

/// Both coordinates, checked before either reaches a URL.
///
/// NaN formats as the literal text "NaN" in a path, which produces a
/// malformed request rather than a refused one — and an error nobody can act
/// on. The same check the weather command makes, for the same reason.
pub fn checked_pair(
    from_lat: f64,
    from_lon: f64,
    to_lat: f64,
    to_lon: f64,
) -> Result<(), PlaceError> {
    for (lat, lon) in [(from_lat, from_lon), (to_lat, to_lon)] {
        if !lat.is_finite() || !lon.is_finite() {
            return Err(PlaceError::Malformed("that is not a real coordinate".into()));
        }
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
            return Err(PlaceError::Malformed(
                "that coordinate is outside the world".into(),
            ));
        }
    }
    Ok(())
}

/// OSRM takes its coordinates in the path, longitude first — the opposite
/// order to every other service in this crate, which is exactly the kind of
/// detail that is worth a test rather than a comment alone.
pub fn route_url(from_lat: f64, from_lon: f64, to_lat: f64, to_lon: f64) -> String {
    format!("{OSRM}/{from_lon},{from_lat};{to_lon},{to_lat}?overview=false")
}

/// `Ok(None)` when the service answered but no road connects the two.
pub fn parse_route(json: &str) -> Result<Option<(f64, f64)>, PlaceError> {
    let wire: WireRoute =
        serde_json::from_str(json).map_err(|e| PlaceError::Malformed(e.to_string()))?;

    if wire.code != "Ok" {
        return Ok(None);
    }

    Ok(wire.routes.first().map(|r| (r.distance, r.duration)))
}

/// The distance between two places, by air and — where there is one — by road.
///
/// A routing failure is not an error here. The straight line is still a true
/// answer, and losing it because a third-party server was busy would be worse
/// than showing it alone.
pub async fn between(
    client: &reqwest::Client,
    from_lat: f64,
    from_lon: f64,
    to_lat: f64,
    to_lon: f64,
) -> Result<Route, PlaceError> {
    checked_pair(from_lat, from_lon, to_lat, to_lon)?;

    let straight_m = straight_line_m(from_lat, from_lon, to_lat, to_lon);
    let url = route_url(from_lat, from_lon, to_lat, to_lon);

    let fetched = crate::net::retrying(crate::net::ATTEMPTS, PlaceError::is_transient, || {
        let client = client.clone();
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|e| PlaceError::Network(e.to_string()))?;
            let status = response.status();
            if !status.is_success() {
                return Err(PlaceError::Upstream(status.as_u16()));
            }
            response
                .text()
                .await
                .map_err(|e| PlaceError::Network(e.to_string()))
        }
    })
    .await;

    let road = fetched.ok().and_then(|body| parse_route(&body).ok().flatten());

    Ok(Route {
        straight_m,
        road_m: road.map(|(d, _)| d),
        duration_s: road.map(|(_, t)| t),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OSRM: &str = include_str!("../fixtures/osrm-route.json");

    #[test]
    fn a_point_is_no_distance_from_itself() {
        assert_eq!(straight_line_m(12.97, 77.59, 12.97, 77.59), 0.0);
    }

    // A degree of latitude is about 111km anywhere on the globe, which is the
    // one distance that can be checked without trusting another calculator.
    #[test]
    fn one_degree_of_latitude_is_about_a_hundred_and_eleven_kilometres() {
        let metres = straight_line_m(0.0, 0.0, 1.0, 0.0);
        assert!((metres - 111_195.0).abs() < 500.0, "got {metres}");
    }

    #[test]
    fn measures_a_known_pair_of_cities() {
        // London to Paris, about 343km great-circle.
        let metres = straight_line_m(51.5074, -0.1278, 48.8566, 2.3522);
        assert!((metres - 343_000.0).abs() < 5_000.0, "got {metres}");
    }

    // Longitudes wrap. Tokyo to Los Angeles must not be measured the long way
    // round the planet.
    #[test]
    fn measures_across_the_antimeridian_the_short_way() {
        let metres = straight_line_m(35.68, 139.69, 34.05, -118.24);
        assert!((metres - 8_815_000.0).abs() < 50_000.0, "got {metres}");
    }

    #[test]
    fn is_the_same_distance_in_either_direction() {
        let there = straight_line_m(12.97, 77.59, 27.17, 78.00);
        let back = straight_line_m(27.17, 78.00, 12.97, 77.59);
        assert!((there - back).abs() < 1.0);
    }

    #[test]
    fn reads_the_road_distance_and_driving_time() {
        let (metres, seconds) = parse_route(OSRM).expect("fixture parses").expect("has a route");
        assert!(metres > 1_900_000.0 && metres < 2_100_000.0, "got {metres}");
        assert!(seconds > 60_000.0, "got {seconds}");
    }

    // "No route" is an answer, not a failure: there is no road from a Pacific
    // island to a landlocked city, and saying so beats an error.
    #[test]
    fn reads_no_route_as_no_route_rather_than_an_error() {
        let json = r#"{"code":"NoRoute","message":"Impossible route"}"#;
        assert_eq!(parse_route(json).expect("parses"), None);
    }

    #[test]
    fn refuses_a_reply_it_cannot_read() {
        assert!(parse_route("not json").is_err());
    }

    #[test]
    fn refuses_an_ok_reply_carrying_no_route() {
        assert!(parse_route(r#"{"code":"Ok","routes":[]}"#).expect("parses").is_none());
    }

    // Coordinates go into the path, not a query string, and OSRM wants them
    // longitude-first — the opposite order to everywhere else in this crate.
    #[test]
    fn builds_the_route_url_longitude_first() {
        let url = route_url(12.97, 77.59, 27.17, 78.00);
        assert!(url.contains("77.59,12.97;78,27.17"), "got {url}");
        assert!(url.starts_with("https://router.project-osrm.org/"));
    }

    #[test]
    fn refuses_to_build_a_url_from_a_coordinate_that_is_not_a_number() {
        assert!(checked_pair(f64::NAN, 0.0, 0.0, 0.0).is_err());
        assert!(checked_pair(0.0, 0.0, 91.0, 0.0).is_err());
        assert!(checked_pair(12.9, 77.5, 27.1, 78.0).is_ok());
    }
}
