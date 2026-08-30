//! Places: finding one by name, and working out where you are.
//!
//! Split out of the weather module because two apps need a coordinate and
//! only one of them is about the weather. Map asks the same questions.
//!
//! Both services here are keyless and free, which is what lets Weather and Map
//! stay in the "no auth, ever" tier.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const GEOCODE_HOST: &str = "https://geocoding-api.open-meteo.com/v1/search";
/// Address-based location. Approximate — city level at best — which is why
/// nothing here pretends to be GPS.
const LOCATE_HOST: &str = "https://ipwho.is/";

#[derive(Debug, Error)]
pub enum PlaceError {
    #[error("that reply could not be read: {0}")]
    Malformed(String),
    #[error("could not reach the location service: {0}")]
    Network(String),
    #[error("the location service answered with status {0}")]
    Upstream(u16),
    #[error("your location could not be worked out: {0}")]
    Unavailable(String),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Place {
    pub name: String,
    pub country: String,
    /// State or province. Two places share a name often enough that leaving
    /// this out would make the search results impossible to choose between.
    pub region: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: Option<String>,
}

#[derive(Deserialize)]
struct WireGeocode {
    // Open-Meteo omits this key entirely when nothing matched, rather than
    // sending an empty array, so it cannot be a required field.
    #[serde(default)]
    results: Vec<WirePlace>,
}

#[derive(Deserialize)]
struct WirePlace {
    name: String,
    country: Option<String>,
    admin1: Option<String>,
    latitude: f64,
    longitude: f64,
    timezone: Option<String>,
}

#[derive(Deserialize)]
struct WireLocated {
    success: Option<bool>,
    message: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    timezone: Option<WireZone>,
}

/// The zone arrives as an object, not a string. Read naively it reaches the
/// window as `[object Object]` where a timezone should be.
#[derive(Deserialize)]
struct WireZone {
    id: Option<String>,
}

pub fn parse_places(json: &str) -> Result<Vec<Place>, PlaceError> {
    let wire: WireGeocode =
        serde_json::from_str(json).map_err(|e| PlaceError::Malformed(e.to_string()))?;

    Ok(wire
        .results
        .into_iter()
        .map(|p| Place {
            name: p.name,
            country: p.country.unwrap_or_default(),
            region: p.admin1,
            latitude: p.latitude,
            longitude: p.longitude,
            timezone: p.timezone,
        })
        .collect())
}

/// Where this machine appears to be, from its public address.
///
/// City level at best, and wrong behind a VPN — which is why it is offered as
/// a shortcut beside the search box rather than used silently. It needs no
/// permission prompt and no browser geolocation API, neither of which is
/// dependable across the three platforms this ships on.
pub fn parse_located(json: &str) -> Result<Place, PlaceError> {
    let wire: WireLocated =
        serde_json::from_str(json).map_err(|e| PlaceError::Malformed(e.to_string()))?;

    // The service reports failure in the body with HTTP 200, so a caller that
    // only checked the status would treat a refusal as a location.
    if wire.success == Some(false) {
        return Err(PlaceError::Unavailable(
            wire.message.unwrap_or_else(|| "the service declined".into()),
        ));
    }

    let (Some(latitude), Some(longitude)) = (wire.latitude, wire.longitude) else {
        return Err(PlaceError::Malformed(
            "the reply carried no coordinate".into(),
        ));
    };

    if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
        return Err(PlaceError::Malformed(
            "the reply carried a coordinate outside the world".into(),
        ));
    }

    let country = wire.country.unwrap_or_default();
    // A lookup that resolves only to a country still names somewhere; showing
    // an empty heading would look broken.
    let name = wire
        .city
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| country.clone());

    Ok(Place {
        name,
        country,
        region: wire.region,
        latitude,
        longitude,
        timezone: wire.timezone.and_then(|z| z.id),
    })
}

/// Percent-encode one query-string value.
///
/// Hand-written rather than pulled in as a dependency: it is a dozen lines,
/// the project audits everything it ships, and the alternative is another
/// crate in the tree to justify. Everything outside the unreserved set of
/// RFC 3986 is escaped, so a name containing `&`, `?`, a space or any
/// non-ASCII character cannot end the value early or start a new parameter.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn search_url(query: &str) -> String {
    format!("{GEOCODE_HOST}?name={}&count=8&language=en&format=json", encode(query))
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, PlaceError> {
    let response = client
        .get(url)
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

pub async fn search_places(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<Place>, PlaceError> {
    let body = get_text(client, &search_url(query)).await?;
    parse_places(&body)
}

pub async fn locate(client: &reqwest::Client) -> Result<Place, PlaceError> {
    let body = get_text(client, LOCATE_HOST).await?;
    parse_located(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const IPWHO: &str = include_str!("../fixtures/ipwho.json");
    const GEOCODE: &str = include_str!("../fixtures/geocode-delhi.json");

    #[test]
    fn reads_places_from_a_search() {
        let places = parse_places(GEOCODE).expect("fixture parses");
        assert!(places.len() >= 2);
        assert_eq!(places[0].name, "Delhi");
        assert_eq!(places[0].country, "India");
        assert_eq!(places[0].latitude, 28.65195);
        assert_eq!(places[0].longitude, 77.23149);
    }

    #[test]
    fn keeps_the_region_so_two_places_of_one_name_can_be_told_apart() {
        let places = parse_places(GEOCODE).expect("fixture parses");
        let delhis: Vec<_> = places.iter().filter(|p| p.name == "Delhi").collect();
        assert!(delhis.len() >= 2, "the fixture has more than one Delhi");
        assert_ne!(delhis[0].country, delhis[1].country);
    }

    // Open-Meteo omits `results` entirely rather than sending an empty array,
    // which serde would otherwise treat as a missing required field.
    #[test]
    fn reads_no_matches_as_an_empty_list_rather_than_an_error() {
        assert_eq!(parse_places(r#"{"generationtime_ms":0.1}"#).unwrap().len(), 0);
    }

    // A place name reaches a URL, so anything that could end the query string
    // early or start a new parameter has to be encoded rather than passed on.
    // The assertion looks at the `name` value alone: checking the whole URL
    // would trip over `&count=8`, which legitimately contains "&co".
    #[test]
    fn escapes_a_search_term_before_it_reaches_a_url() {
        let url = search_url("São Paulo & co?x=1");
        let name = url
            .split("name=")
            .nth(1)
            .expect("the url has a name parameter")
            .split('&')
            .next()
            .expect("the value ends at the next parameter");

        assert!(!name.contains(' '), "a space would end the value");
        assert!(!name.contains('?'), "a question mark would start a new query");
        assert!(!name.contains('='), "an equals would look like another parameter");
        assert!(name.contains("%20"), "the space survives, encoded");
        assert!(name.contains("%26"), "the ampersand survives, encoded");
        assert!(name.contains("%C3%A3"), "non-ASCII is encoded as its UTF-8 bytes");
    }

    #[test]
    fn reads_a_location_from_the_address_lookup() {
        let place = parse_located(IPWHO).expect("fixture parses");
        assert_eq!(place.name, "Bengaluru");
        assert_eq!(place.country, "India");
        assert_eq!(place.region.as_deref(), Some("Karnataka"));
        assert!((place.latitude - 12.9715893).abs() < 1e-6);
        assert!((place.longitude - 77.5945856).abs() < 1e-6);
    }

    // The zone arrives as an object, not a string, so a naive read gives the
    // window `[object Object]` where a timezone should be.
    #[test]
    fn reads_the_timezone_out_of_the_object_it_arrives_in() {
        let place = parse_located(IPWHO).expect("fixture parses");
        assert_eq!(place.timezone.as_deref(), Some("Asia/Kolkata"));
    }

    // The service reports failure in the body with HTTP 200, so a caller that
    // only checked the status would treat a refusal as a location.
    #[test]
    fn refuses_a_lookup_the_service_says_failed() {
        let json = r#"{"success":false,"message":"Reserved range"}"#;
        assert!(matches!(parse_located(json), Err(PlaceError::Unavailable(_))));
    }

    #[test]
    fn refuses_a_lookup_with_no_coordinate() {
        let json = r#"{"success":true,"city":"Nowhere","country":"X"}"#;
        assert!(matches!(parse_located(json), Err(PlaceError::Malformed(_))));
    }

    #[test]
    fn refuses_json_it_cannot_read() {
        assert!(matches!(parse_located("not json"), Err(PlaceError::Malformed(_))));
    }

    // A lookup that lands on an ocean-centre default is not a location worth
    // showing as "you are here".
    #[test]
    fn refuses_a_coordinate_outside_the_world() {
        let json = r#"{"success":true,"city":"X","country":"Y","latitude":99.0,"longitude":0.0}"#;
        assert!(matches!(parse_located(json), Err(PlaceError::Malformed(_))));
    }

    #[test]
    fn falls_back_to_the_country_when_the_city_is_missing() {
        let json = r#"{"success":true,"country":"India","latitude":1.0,"longitude":2.0}"#;
        let place = parse_located(json).expect("parses");
        assert_eq!(place.name, "India");
    }
}
