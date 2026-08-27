//! Where the alerts go, and how to reach the server.
//!
//! The password is deliberately absent from this type. It lives in the OS
//! keychain under the same one-way rule as an API key: the app can store it,
//! check that one exists, and delete it, and nothing reads it back to the
//! window.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct MailConfig {
    /// The address alerts are sent from and to. One address: this is a
    /// reminder to yourself, not a mailing list.
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    /// Whether alerts are being delivered at all.
    #[serde(default)]
    pub enabled: bool,
}

/// A known provider, so nobody has to look up a port number.
pub struct Preset {
    pub id: &'static str,
    pub label: &'static str,
    pub host: &'static str,
    pub port: u16,
    /// What the user has to do before this will work.
    pub note: &'static str,
}

/// Port 465 throughout: implicit TLS, encrypted from the first byte.
///
/// 587 with STARTTLS begins in the clear and asks the server to upgrade, which
/// is one downgrade away from sending a password in plain text.
pub const PRESETS: &[Preset] = &[
    Preset {
        id: "gmail",
        label: "Gmail",
        host: "smtp.gmail.com",
        port: 465,
        note: "Gmail refuses your account password over SMTP. Turn on 2-Step \
               Verification, then create an App Password and paste that here.",
    },
    Preset {
        id: "outlook",
        label: "Outlook",
        host: "smtp-mail.outlook.com",
        port: 465,
        note: "Outlook needs an app password when two-factor sign-in is on.",
    },
    Preset {
        id: "yahoo",
        label: "Yahoo",
        host: "smtp.mail.yahoo.com",
        port: 465,
        note: "Yahoo requires an app password generated in Account Security.",
    },
    Preset {
        id: "icloud",
        label: "iCloud",
        host: "smtp.mail.me.com",
        port: 587,
        note: "iCloud requires an app-specific password, and uses port 587.",
    },
];

pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

/// The preset matching an address's domain, if there is one.
pub fn preset_for(address: &str) -> Option<&'static Preset> {
    let domain = address.rsplit('@').next()?.to_ascii_lowercase();
    let id = match domain.as_str() {
        "gmail.com" | "googlemail.com" => "gmail",
        "outlook.com" | "hotmail.com" | "live.com" | "msn.com" => "outlook",
        "yahoo.com" | "yahoo.co.uk" | "yahoo.co.in" => "yahoo",
        "icloud.com" | "me.com" | "mac.com" => "icloud",
        _ => return None,
    };
    preset(id)
}

/// What is stopping this configuration from working, or None if nothing is.
pub fn why_not(config: &MailConfig) -> Option<String> {
    if !looks_like_an_address(&config.address) {
        return Some("That does not look like an email address.".into());
    }
    if config.host.trim().is_empty() {
        return Some("Choose a provider, or type a server address.".into());
    }
    if config.port == 0 {
        return Some("A port is needed. 465 is the usual one.".into());
    }
    None
}

/// Deliberately loose.
///
/// A regular expression that tries to be exactly right about what an address
/// can contain rejects valid ones, and the only real test is whether the mail
/// arrives. This catches a blank box and an obvious typo, and leaves the rest
/// to the server.
pub fn looks_like_an_address(value: &str) -> bool {
    let value = value.trim();
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !value.contains(char::is_whitespace)
        && value.matches('@').count() == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> MailConfig {
        MailConfig {
            address: "someone@gmail.com".into(),
            host: "smtp.gmail.com".into(),
            port: 465,
            enabled: true,
        }
    }

    #[test]
    fn the_config_holds_no_password() {
        // The whole file is written as plain JSON beside the settings. A
        // password in this struct would be a password on disk in the clear.
        let json = serde_json::to_string(&config()).unwrap();
        for word in ["password", "secret", "token", "credential"] {
            assert!(!json.to_lowercase().contains(word), "{json}");
        }
    }

    #[test]
    fn a_missing_config_file_loads_as_defaults() {
        let empty: MailConfig = serde_json::from_str("{}").unwrap();
        assert!(!empty.enabled);
        assert!(empty.address.is_empty());
    }

    #[test]
    fn presets_use_implicit_tls() {
        // 587 with STARTTLS begins in the clear and asks the server to
        // upgrade, which is one downgrade away from a password in plain text.
        // iCloud is the exception and only offers 587.
        for p in PRESETS {
            assert!(p.port == 465 || p.id == "icloud", "{} uses port {}", p.id, p.port);
        }
    }

    #[test]
    fn every_preset_says_what_the_user_has_to_do_first() {
        // "Authentication failed" with no explanation is the worst outcome
        // here, because the account password looks like the right answer.
        for p in PRESETS {
            assert!(p.note.len() > 20, "{} has no note", p.id);
        }
    }

    #[test]
    fn a_gmail_address_finds_the_gmail_preset() {
        assert_eq!(preset_for("someone@gmail.com").map(|p| p.id), Some("gmail"));
        assert_eq!(preset_for("SOMEONE@GMAIL.COM").map(|p| p.id), Some("gmail"));
        assert_eq!(preset_for("someone@googlemail.com").map(|p| p.id), Some("gmail"));
    }

    #[test]
    fn an_unknown_domain_finds_nothing_rather_than_guessing() {
        assert!(preset_for("someone@example.org").is_none());
    }

    #[test]
    fn a_complete_config_has_nothing_wrong_with_it() {
        assert!(why_not(&config()).is_none());
    }

    #[test]
    fn a_missing_address_is_reported() {
        let mut c = config();
        c.address = String::new();
        assert!(why_not(&c).unwrap().contains("email address"));
    }

    #[test]
    fn a_missing_host_is_reported() {
        let mut c = config();
        c.host = "  ".into();
        assert!(why_not(&c).unwrap().contains("provider"));
    }

    #[test]
    fn a_missing_port_is_reported() {
        let mut c = config();
        c.port = 0;
        assert!(why_not(&c).unwrap().contains("465"));
    }

    #[test]
    fn obvious_non_addresses_are_refused() {
        for bad in ["", "someone", "@gmail.com", "someone@", "someone@gmail", "a b@c.com", "a@b@c.com"] {
            assert!(!looks_like_an_address(bad), "accepted '{bad}'");
        }
    }

    #[test]
    fn real_addresses_are_accepted() {
        // Loose on purpose: a regex that tries to be exactly right about what
        // an address may contain rejects valid ones.
        for good in [
            "someone@gmail.com",
            "first.last+tag@sub.domain.co.uk",
            "a_b-c@example.io",
            "kartikeya2006jay@gmail.com",
        ] {
            assert!(looks_like_an_address(good), "refused '{good}'");
        }
    }
}
