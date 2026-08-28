import type { MailPreset } from "../../platform";

/**
 * Known providers, mirrored from the Rust catalogue.
 *
 * Ports are what each provider actually listens on. 465 is implicit TLS and
 * preferred where it exists; 587 is STARTTLS, which is all Outlook and iCloud
 * offer. Neither is ever plaintext.
 */
export const MAIL_PRESETS: MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    note: "Gmail refuses your account password over SMTP. Turn on 2-Step Verification, then create an App Password and paste that here.",
  },
  {
    id: "outlook",
    label: "Outlook",
    host: "smtp-mail.outlook.com",
    port: 587,
    note: "Outlook needs an app password when two-factor sign-in is on, and Microsoft has been retiring password sign-in for personal accounts — if it is refused, the account may no longer allow it.",
  },
  {
    id: "yahoo",
    label: "Yahoo",
    host: "smtp.mail.yahoo.com",
    port: 465,
    note: "Yahoo requires an app password generated in Account Security.",
  },
  {
    id: "icloud",
    label: "iCloud",
    host: "smtp.mail.me.com",
    port: 587,
    note: "iCloud requires an app-specific password, and uses port 587.",
  },
];

/** The preset matching an address's domain, if there is one. */
export function presetFor(address: string): MailPreset | undefined {
  const domain = address.split("@").pop()?.toLowerCase() ?? "";
  const id =
    ["gmail.com", "googlemail.com"].includes(domain) ? "gmail"
    : ["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain) ? "outlook"
    : ["yahoo.com", "yahoo.co.uk", "yahoo.co.in"].includes(domain) ? "yahoo"
    : ["icloud.com", "me.com", "mac.com"].includes(domain) ? "icloud"
    : undefined;
  return MAIL_PRESETS.find((p) => p.id === id);
}

/**
 * Deliberately loose.
 *
 * A pattern that tries to be exactly right about what an address may contain
 * rejects valid ones, and the only real test is whether the mail arrives.
 * This catches a blank box and an obvious typo.
 */
export function looksLikeAnAddress(value: string): boolean {
  const v = value.trim();
  const at = v.split("@");
  if (at.length !== 2) return false;
  const [local, domain] = at;
  return (
    local.length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/\s/.test(v)
  );
}

/** What is stopping this from working, or null if nothing is. */
export function whyNot(config: {
  address: string;
  host: string;
  port: number;
}): string | null {
  if (!looksLikeAnAddress(config.address)) {
    return "That does not look like an email address.";
  }
  if (!config.host.trim()) return "Choose a provider, or type a server address.";
  if (!config.port) return "A port is needed. 465 is the usual one.";
  return null;
}

/** Whether the configured address has been proven with a one-time code. */
export function isVerified(config: {
  address: string;
  verified_address: string | null;
}): boolean {
  const address = config.address.trim();
  return address.length > 0 && config.verified_address === address;
}

/** Whether alerts can actually fire: a verified address, and the switch on. */
export function isMailReady(config: {
  address: string;
  verified_address: string | null;
  enabled: boolean;
}): boolean {
  return config.enabled && isVerified(config);
}
