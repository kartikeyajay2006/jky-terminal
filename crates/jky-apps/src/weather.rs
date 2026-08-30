//! Weather, from Open-Meteo.
//!
//! Chosen because it needs no API key and no account, which means the app can
//! show the weather the moment it is installed rather than after a signup. It
//! is also why this app is in the "no auth, ever" tier: there is nothing here
//! to authenticate, and asking someone to sign in to see the temperature would
//! be friction bought with nothing.
//!
//! Parsing is separate from fetching so the shape of a response is tested
//! against a recorded fixture. A test that calls the live service is a test
//! that fails when a train goes into a tunnel, and it tells you nothing about
//! your own code when it does.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const FORECAST_HOST: &str = "https://api.open-meteo.com/v1/forecast";

/// How many days of outlook to ask for, today included.
const FORECAST_DAYS: u8 = 4;

#[derive(Debug, Error)]
pub enum WeatherError {
    #[error("the weather service sent a reply this could not read: {0}")]
    Malformed(String),
    #[error("could not reach the weather service: {0}")]
    Network(String),
    #[error("the weather service answered with status {0}")]
    Upstream(u16),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Conditions {
    pub temperature_c: f64,
    pub feels_like_c: f64,
    pub humidity_pct: u8,
    pub wind_kph: f64,
    /// WMO weather code, kept so the window can choose an icon.
    pub code: u8,
    /// The same code in words. Sent with the reading rather than looked up
    /// again in the frontend, so there is one copy of the WMO table.
    pub description: String,
    pub is_day: bool,
    /// Local time of the reading, as the service reported it.
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DayOutlook {
    pub date: String,
    pub code: u8,
    pub description: String,
    pub high_c: f64,
    pub low_c: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Report {
    pub now: Conditions,
    pub days: Vec<DayOutlook>,
    /// The zone the times above are in, so the window need not guess.
    pub timezone: String,
}

// ---- the wire ----

#[derive(Deserialize)]
struct WireForecast {
    timezone: String,
    current: Option<WireCurrent>,
    daily: Option<WireDaily>,
}

#[derive(Deserialize)]
struct WireCurrent {
    time: String,
    temperature_2m: f64,
    apparent_temperature: f64,
    relative_humidity_2m: u8,
    is_day: u8,
    weather_code: u8,
    wind_speed_10m: f64,
}

#[derive(Deserialize)]
struct WireDaily {
    time: Vec<String>,
    weather_code: Vec<u8>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

// ---- parsing ----

pub fn parse_report(json: &str) -> Result<Report, WeatherError> {
    let wire: WireForecast =
        serde_json::from_str(json).map_err(|e| WeatherError::Malformed(e.to_string()))?;

    let current = wire
        .current
        .ok_or_else(|| WeatherError::Malformed("the reply had no current reading".into()))?;

    let daily = wire
        .daily
        .ok_or_else(|| WeatherError::Malformed("the reply had no daily outlook".into()))?;

    // The four daily arrays are parallel. A reply with four dates and three
    // highs would otherwise pair a date with the wrong day's temperature,
    // which is worse than refusing it because it still looks like an answer.
    let n = daily.time.len();
    if daily.weather_code.len() != n
        || daily.temperature_2m_max.len() != n
        || daily.temperature_2m_min.len() != n
    {
        return Err(WeatherError::Malformed(
            "the daily outlook had mismatched columns".into(),
        ));
    }

    let days = (0..n)
        .map(|i| DayOutlook {
            date: daily.time[i].clone(),
            code: daily.weather_code[i],
            description: describe(daily.weather_code[i]).to_string(),
            high_c: daily.temperature_2m_max[i],
            low_c: daily.temperature_2m_min[i],
        })
        .collect();

    Ok(Report {
        now: Conditions {
            temperature_c: current.temperature_2m,
            feels_like_c: current.apparent_temperature,
            humidity_pct: current.relative_humidity_2m,
            wind_kph: current.wind_speed_10m,
            code: current.weather_code,
            description: describe(current.weather_code).to_string(),
            is_day: current.is_day == 1,
            observed_at: current.time,
        },
        days,
        timezone: wire.timezone,
    })
}

/// A WMO weather code in words.
///
/// The table is the published WMO 4677 set that Open-Meteo documents. It has
/// gaps, and an unrecognised code still has to say something: printing the
/// number to the user says nothing at all.
pub fn describe(code: u8) -> &'static str {
    match code {
        0 => "Clear",
        1 => "Mainly clear",
        2 => "Partly cloudy",
        3 => "Overcast",
        45 => "Fog",
        48 => "Freezing fog",
        51 => "Light drizzle",
        53 => "Drizzle",
        55 => "Heavy drizzle",
        56 => "Light freezing drizzle",
        57 => "Freezing drizzle",
        61 => "Light rain",
        63 => "Rain",
        65 => "Heavy rain",
        66 => "Light freezing rain",
        67 => "Freezing rain",
        71 => "Light snow",
        73 => "Snow",
        75 => "Heavy snow",
        77 => "Snow grains",
        80 => "Light showers",
        81 => "Showers",
        82 => "Violent showers",
        85 => "Light snow showers",
        86 => "Snow showers",
        95 => "Thunderstorm",
        96 => "Thunderstorm with hail",
        99 => "Thunderstorm with heavy hail",
        _ => "Unknown",
    }
}

// ---- urls ----

pub fn forecast_url(latitude: f64, longitude: f64) -> String {
    format!(
        "{FORECAST_HOST}?latitude={latitude}&longitude={longitude}\
         &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m\
         &daily=weather_code,temperature_2m_max,temperature_2m_min\
         &timezone=auto&forecast_days={FORECAST_DAYS}"
    )
}

// ---- fetching ----

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, WeatherError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| WeatherError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(WeatherError::Upstream(status.as_u16()));
    }

    response
        .text()
        .await
        .map_err(|e| WeatherError::Network(e.to_string()))
}

pub async fn fetch_report(
    client: &reqwest::Client,
    latitude: f64,
    longitude: f64,
) -> Result<Report, WeatherError> {
    let body = get_text(client, &forecast_url(latitude, longitude)).await?;
    parse_report(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FORECAST: &str = include_str!("../fixtures/forecast-delhi.json");

    #[test]
    fn reads_the_current_conditions() {
        let report = parse_report(FORECAST).expect("fixture parses");
        assert_eq!(report.now.temperature_c, 33.8);
        assert_eq!(report.now.feels_like_c, 37.8);
        assert_eq!(report.now.humidity_pct, 49);
        assert_eq!(report.now.wind_kph, 4.6);
        assert_eq!(report.now.code, 3);
        assert!(report.now.is_day);
    }

    // The words travel with the reading rather than being looked up again in
    // TypeScript. A second copy of the WMO table in the frontend is a second
    // thing to keep in step, and nothing would fail when they drifted.
    #[test]
    fn carries_the_conditions_in_words() {
        let report = parse_report(FORECAST).expect("fixture parses");
        assert_eq!(report.now.description, "Overcast");
        assert_eq!(report.days[3].description, "Thunderstorm");
    }

    #[test]
    fn reads_the_timezone_the_reading_was_taken_in() {
        let report = parse_report(FORECAST).expect("fixture parses");
        assert_eq!(report.timezone, "Asia/Kolkata");
    }

    #[test]
    fn reads_the_daily_outlook() {
        let report = parse_report(FORECAST).expect("fixture parses");
        assert_eq!(report.days.len(), 4);
        assert_eq!(report.days[0].date, "2026-08-30");
        assert_eq!(report.days[0].high_c, 35.2);
        assert_eq!(report.days[0].low_c, 28.8);
        assert_eq!(report.days[3].code, 95);
    }

    #[test]
    fn refuses_json_it_cannot_read() {
        assert!(matches!(parse_report("not json"), Err(WeatherError::Malformed(_))));
    }

    #[test]
    fn refuses_a_response_with_no_current_reading() {
        let json = r#"{"timezone":"UTC","daily":{"time":[],"weather_code":[],"temperature_2m_max":[],"temperature_2m_min":[]}}"#;
        assert!(matches!(parse_report(json), Err(WeatherError::Malformed(_))));
    }

    // The daily arrays are parallel, and a provider that returned four dates
    // and three highs would otherwise index past the end or silently pair a
    // date with the wrong day's temperature.
    #[test]
    fn refuses_daily_arrays_of_different_lengths() {
        let json = r#"{
            "timezone":"UTC",
            "current":{"time":"2026-08-30T18:00","temperature_2m":1.0,"apparent_temperature":1.0,
                       "relative_humidity_2m":1,"is_day":1,"weather_code":0,"wind_speed_10m":1.0},
            "daily":{"time":["a","b"],"weather_code":[0],"temperature_2m_max":[1.0],"temperature_2m_min":[0.0]}
        }"#;
        assert!(matches!(parse_report(json), Err(WeatherError::Malformed(_))));
    }




    #[test]
    fn describes_the_standard_weather_codes() {
        assert_eq!(describe(0), "Clear");
        assert_eq!(describe(3), "Overcast");
        assert_eq!(describe(95), "Thunderstorm");
    }

    // The WMO table has gaps. An unknown code must still say something, and
    // rendering a bare number to the user says nothing at all.
    #[test]
    fn describes_an_unknown_code_without_panicking() {
        assert_eq!(describe(200), "Unknown");
    }

    #[test]
    fn builds_a_forecast_url_from_a_coordinate() {
        let url = forecast_url(28.65, 77.23);
        assert!(url.starts_with("https://api.open-meteo.com/"));
        assert!(url.contains("latitude=28.65"));
        assert!(url.contains("longitude=77.23"));
        assert!(url.contains("timezone=auto"));
    }

}
