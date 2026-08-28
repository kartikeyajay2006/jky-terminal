import { useCallback, useEffect, useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { Select } from "../../components/Select";
import { getPlatform, type MailConfig } from "../../platform";
import { useDashboard } from "./dashboardStore";
import { formatLead } from "./EventRow";
import { upcoming } from "./upcoming";
import { MAIL_PRESETS, isVerified, presetFor, whyNot } from "./mailPresets";

const BLANK: MailConfig = {
  address: "",
  host: "",
  port: 465,
  enabled: false,
  verified_address: null,
};

function describeError(e: unknown): string {
  // Tauri rejects with a plain string, so `instanceof Error` throws the real
  // message away.
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function MailAlertsPanel() {
  const events = useDashboard((s) => s.events);
  const armed = upcoming(events).filter((e) => e.alert_minutes_before !== null);

  const [config, setConfig] = useState<MailConfig>(BLANK);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState<null | "saving" | "testing" | "sendingCode" | "verifying">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    const mail = getPlatform().mail;
    void mail.readConfig().then(setConfig).catch(() => {});
    void mail.hasPassword().then(setHasPassword).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const problem = whyNot(config);
  const verified = isVerified(config);
  const canEnable = problem === null && hasPassword && verified;

  function edit(patch: Partial<MailConfig>) {
    setSaid(null);
    setError(null);
    setConfig((c) => ({ ...c, ...patch }));
  }

  /** Filling in the address picks the provider, which is nearly always right. */
  function changeAddress(address: string) {
    const guess = presetFor(address);
    edit(guess ? { address, host: guess.host, port: guess.port } : { address });
    // A code sent to the old address proves nothing about this one.
    setOtpSent(false);
    setCode("");
  }

  function choosePreset(id: string) {
    const preset = MAIL_PRESETS.find((p) => p.id === id);
    if (preset) edit({ host: preset.host, port: preset.port });
  }

  async function save(next: MailConfig) {
    setBusy("saving");
    setError(null);
    setSaid(null);
    try {
      await getPlatform().mail.saveConfig(next);
      setConfig(next);
      setSaid(
        next.enabled
          ? "Alerts are on. A helper is registered with your system and will send them even when JKY Terminal is closed."
          : "Alerts are off, and the helper has been removed.",
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function storePassword() {
    const value = password.trim();
    if (!value) return;
    setError(null);
    setSaid(null);
    try {
      await getPlatform().mail.setPassword(value);
      // Cleared straight away. It is stored now, and holding it in a React
      // state that lives as long as the panel does buys nothing.
      setPassword("");
      setHasPassword(true);
      setSaid("App password stored in your system keychain.");
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function test() {
    setBusy("testing");
    setError(null);
    setSaid(null);
    try {
      await getPlatform().mail.sendTest(config);
      setSaid(`Sent. Check ${config.address}.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    setBusy("sendingCode");
    setError(null);
    setSaid(null);
    try {
      await getPlatform().mail.sendOtp(config);
      setOtpSent(true);
      setSaid(`A code was sent to ${config.address}. It expires in 10 minutes.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    const value = code.trim();
    if (!value) return;
    setBusy("verifying");
    setError(null);
    setSaid(null);
    try {
      const ok = await getPlatform().mail.verifyOtp(config, value);
      if (ok) {
        setConfig((c) => ({ ...c, verified_address: c.address }));
        setOtpSent(false);
        setCode("");
        setSaid("Email verified.");
      } else {
        setError("That code doesn't match. Check your email and try again.");
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  const preset = presetFor(config.address);

  return (
    <section className="panel" aria-labelledby="mail-heading">
      <PanelHead
        where="Mail Alerts"
        headingId="mail-heading"
        status={
          config.enabled ? (
            <>
              <b>{armed.length}</b> armed
            </>
          ) : (
            <>off</>
          )
        }
      />

      <div className="notice">
        <span className="notice__glyph" aria-hidden="true">
          ✉
        </span>
        <div>
          <p>
            Alerts are sent by a small helper registered with your operating
            system, so they arrive <strong>even while JKY Terminal is
            closed</strong>. Turning alerts off removes it.
          </p>
          <p>
            It cannot send anything while your computer is off. Nothing running
            on your machine can — that would need a server holding your mail
            password, which this app does not have and will not ask for.
          </p>
        </div>
      </div>

      <h3 className="dash__subhead">Where alerts go</h3>

      <form className="eventform" onSubmit={(e) => e.preventDefault()}>
        <div className="field-row">
          <label className="field-cell field-cell--grow">
            <span className="field-cell__label">
              Your email {verified && <span className="mail__stored">· verified</span>}
            </span>
            <input
              className="input"
              type="email"
              aria-label="Your email address"
              placeholder="you@gmail.com"
              value={config.address}
              onChange={(e) => changeAddress(e.target.value)}
            />
          </label>

          <div className="field-cell">
            <span className="field-cell__label" id="mail-provider-label">
              Provider
            </span>
            <Select
              label="Provider"
              value={MAIL_PRESETS.find((p) => p.host === config.host)?.id ?? ""}
              options={[
                { value: "", label: "Choose…" },
                ...MAIL_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ]}
              onChange={choosePreset}
            />
          </div>

          <label className="field-cell">
            <span className="field-cell__label">Port</span>
            <input
              className="input input--time"
              type="number"
              aria-label="Server port"
              value={config.port || ""}
              onChange={(e) => edit({ port: Number(e.target.value) })}
            />
          </label>
        </div>

        {preset && <p className="hint">{preset.note}</p>}

        <div className="field-row">
          <label className="field-cell field-cell--grow">
            <span className="field-cell__label">
              App password {hasPassword && <span className="mail__stored">· stored</span>}
            </span>
            <input
              className="input"
              type="password"
              aria-label="App password"
              placeholder={hasPassword ? "•••••••• — paste a new one to replace it" : "Paste the app password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button
            type="button"
            className="btn eventform__go"
            disabled={!password.trim()}
            onClick={() => void storePassword()}
          >
            Store
          </button>

          {hasPassword && (
            <button
              type="button"
              className="btn eventform__go"
              onClick={() => {
                void getPlatform()
                  .mail.deletePassword()
                  .then(() => {
                    setHasPassword(false);
                    setSaid("App password removed from the keychain.");
                  })
                  .catch((e) => setError(describeError(e)));
              }}
            >
              Remove
            </button>
          )}
        </div>

        <p className="hint">
          The password goes into your operating system&apos;s keychain and does
          not come back out. This window can store one, check that one exists,
          and delete it. There is no command that reads it.
        </p>
      </form>

      <h3 className="dash__subhead">Verify your email</h3>
      <p className="hint">
        A one-time code proves this inbox is really yours before anything can
        be sent to it.
      </p>

      {!verified ? (
        <div className="mail__actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null || problem !== null || !hasPassword}
            onClick={() => void sendCode()}
          >
            {busy === "sendingCode"
              ? "Sending…"
              : otpSent
                ? "Resend code"
                : "Send verification code"}
          </button>

          {otpSent && (
            <>
              <input
                className="input input--time"
                aria-label="Verification code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy !== null || !code.trim()}
                onClick={() => void verify()}
              >
                {busy === "verifying" ? "Verifying…" : "Verify"}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mail__actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null || problem !== null}
            onClick={() => void test()}
          >
            {busy === "testing" ? "Sending…" : "Send a test email"}
          </button>
        </div>
      )}

      <h3 className="dash__subhead">Delivery</h3>

      <div className="mail__actions">
        <label className="mail__switch">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={!canEnable && !config.enabled}
            onChange={(e) => void save({ ...config, enabled: e.target.checked })}
          />
          <span>Send alerts even when JKY Terminal is closed</span>
        </label>

        {!config.enabled && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy !== null || problem !== null}
            onClick={() => void save(config)}
          >
            {busy === "saving" ? "Saving…" : "Save settings"}
          </button>
        )}
      </div>

      {/* Nothing about this configuration is visible until something arrives:
          wrong port, wrong password and blocked outgoing mail all look
          identical from here. */}
      {problem && !config.enabled && <p className="hint">{problem}</p>}
      {problem === null && !hasPassword && (
        <p className="hint">Store an app password to turn alerts on.</p>
      )}
      {problem === null && hasPassword && !verified && (
        <p className="hint">Verify this address above to turn alerts on.</p>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {said && (
        <p className="hint" role="status">
          {said}
        </p>
      )}

      <h3 className="dash__subhead">Alerts you have set</h3>
      {armed.length === 0 ? (
        <p className="hint">
          None yet. Add an event under Calendar or Upcoming Events and choose a
          lead time.
        </p>
      ) : (
        <ul className="events" aria-label="Events with alerts">
          {armed.map((e) => (
            <li key={e.id} className="event">
              <span className="dot" data-colour={e.colour} aria-hidden="true" />
              <span className="event__title">{e.title}</span>
              <span className="event__alert">
                ✉ {formatLead(e.alert_minutes_before ?? 0)} before
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
