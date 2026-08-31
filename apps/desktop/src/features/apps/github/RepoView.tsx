import { useCallback, useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type {
  GitHubBranch,
  GitHubCommit,
  GitHubEntry,
  GitHubFile,
} from "../../../platform/types";
import { relativeDay } from "./GitHub";

type Tab = "files" | "commits" | "branches";

/** A size in the units a person reads. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * One repository: its files, its history and its branches.
 *
 * The file browser keeps a path rather than a stack, because the breadcrumb
 * has to be able to jump to any ancestor and not only to walk back one step —
 * a browser you can only reverse out of is one you leave and re-enter.
 */
export function RepoView({ repo, onBack }: { repo: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("files");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<GitHubEntry[] | null>(null);
  const [file, setFile] = useState<GitHubFile | null>(null);
  const [commits, setCommits] = useState<GitHubCommit[] | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const load = useCallback(
    async (at: string) => {
      setBusy(true);
      setError(null);
      setFile(null);
      try {
        setEntries(await getPlatform().apps.github.contents(repo, at));
      } catch (e) {
        setEntries(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [repo],
  );

  useEffect(() => {
    if (tab === "files") void load(path);
  }, [tab, path, load]);

  useEffect(() => {
    if (tab !== "commits" || commits) return;
    void getPlatform()
      .apps.github.commits(repo)
      .then(setCommits)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [tab, commits, repo]);

  useEffect(() => {
    if (tab !== "branches" || branches) return;
    void getPlatform()
      .apps.github.branches(repo)
      .then(setBranches)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [tab, branches, repo]);

  async function openFile(at: string) {
    setBusy(true);
    setError(null);
    try {
      setFile(await getPlatform().apps.github.file(repo, at));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function open(url: string) {
    void getPlatform().openExternal(url);
  }

  const segments = path === "" ? [] : path.split("/");

  return (
    <div className="gh">
      <div className="gh__head">
        <div>
          <button type="button" className="gh__link" onClick={onBack}>
            ← Back to your account
          </button>
          <h2 className="gh__login">{repo}</h2>
        </div>
        <button
          type="button"
          className="gh__ghost"
          onClick={() => open(`https://github.com/${repo}`)}
        >
          Open on GitHub
        </button>
      </div>

      <div className="gh__tabs" role="tablist" aria-label="Repository">
        {(["files", "commits", "branches"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="gh__tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {id}
          </button>
        ))}
      </div>

      {error && (
        <p className="gh__error" role="alert">
          {error}
        </p>
      )}

      {tab === "files" && (
        <>
          <nav className="gh__crumbs" aria-label="Path">
            <button
              type="button"
              className="gh__crumb"
              onClick={() => {
                setPath("");
                setFile(null);
              }}
            >
              root
            </button>
            {segments.map((segment, i) => (
              <button
                key={`${segment}-${i}`}
                type="button"
                className="gh__crumb"
                onClick={() => {
                  setPath(segments.slice(0, i + 1).join("/"));
                  setFile(null);
                }}
              >
                {segment}
              </button>
            ))}
          </nav>

          {file ? (
            <FileView file={file} onClose={() => setFile(null)} onOpen={open} />
          ) : (
            <>
              {busy && !entries && <p className="gh__quiet">Reading…</p>}
              {entries && entries.length === 0 && <p className="gh__quiet">Nothing here.</p>}
              {entries && entries.length > 0 && (
                <ul className="gh__list" aria-label="Files">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="gh__row gh__row--file"
                        onClick={() =>
                          entry.is_dir ? setPath(entry.path) : void openFile(entry.path)
                        }
                      >
                        <span className="gh__file-glyph" aria-hidden="true">
                          {entry.is_dir ? "▸" : "·"}
                        </span>
                        <span className="gh__file-name">{entry.name}</span>
                        {!entry.is_dir && (
                          <span className="gh__file-size">{fileSize(entry.size)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {tab === "commits" && (
        <>
          {!commits && <p className="gh__quiet">Reading the history…</p>}
          {commits && (
            <ul className="gh__list" aria-label="Commits">
              {commits.map((commit) => (
                <li key={commit.sha}>
                  <button
                    type="button"
                    className="gh__row"
                    onClick={() => open(commit.html_url)}
                  >
                    <span className="gh__row-main">
                      <span className="gh__row-title">{commit.subject}</span>
                      <span className="gh__row-sub">
                        <span className="gh__sha">{commit.short_sha}</span>
                        <span>{commit.author}</span>
                        {relativeDay(commit.date, now) && (
                          <span>{relativeDay(commit.date, now)}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "branches" && (
        <>
          {!branches && <p className="gh__quiet">Reading the branches…</p>}
          {branches && (
            <ul className="gh__list" aria-label="Branches">
              {branches.map((branch) => (
                <li key={branch.name}>
                  <button
                    type="button"
                    className="gh__row"
                    onClick={() => open(`https://github.com/${repo}/tree/${branch.name}`)}
                  >
                    <span className="gh__row-title">
                      {branch.name}
                      {branch.protected && <span className="gh__badge">protected</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One file's contents.
 *
 * Three outcomes, and they are not the same thing: text, something that is not
 * text, and something too big for the API to have sent. A panel that showed an
 * empty box for all three would be lying about two of them.
 */
function FileView({
  file,
  onClose,
  onOpen,
}: {
  file: GitHubFile;
  onClose: () => void;
  onOpen: (url: string) => void;
}) {
  return (
    <section className="gh__file" aria-label={`File ${file.name}`}>
      <div className="gh__file-bar">
        <span className="gh__file-name">{file.name}</span>
        <span className="gh__file-size">{fileSize(file.size)}</span>
        <button type="button" className="gh__link" onClick={() => onOpen(file.html_url)}>
          Open on GitHub
        </button>
        <button type="button" className="gh__link" onClick={onClose}>
          Close
        </button>
      </div>

      {file.too_large && (
        <p className="gh__quiet">
          Too large to show here — GitHub does not send the contents of files over a megabyte.
        </p>
      )}
      {file.is_binary && !file.too_large && (
        <p className="gh__quiet">This is not a text file, so there is nothing to read here.</p>
      )}
      {file.text !== null && <pre className="gh__code-block">{file.text}</pre>}
    </section>
  );
}
