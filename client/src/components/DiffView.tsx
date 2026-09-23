import { useCallback, useEffect, useState } from "react";
import {
  diffSnapshots,
  exportDiffUrl,
  type Hunk,
  type HunkKind,
  type VersionDiff,
  type WordEditKind,
} from "../api";

export const HUNK_KIND_ORDER: HunkKind[] = ["added", "removed", "moved", "edited", "page_title"];

const PAGE_SIZE = 100;

export function wordEditClassName(kind: WordEditKind): string {
  if (kind === "del") return "diff-del";
  if (kind === "ins") return "diff-ins";
  return "diff-eq";
}

export function hunkKindLabel(kind: HunkKind): string {
  if (kind === "page_title") return "Renamed pages";
  if (kind === "added") return "Added";
  if (kind === "removed") return "Removed";
  if (kind === "moved") return "Moved";
  return "Edited";
}

export function hunkHeading(hunk: Hunk): string {
  const path = Array.isArray(hunk.path) ? hunk.path.filter((s) => s !== "") : [];
  if (path.length > 0) return path.join(" / ");
  return hunk.block_id !== "" ? hunk.block_id : "Untitled block";
}

export interface DiffBaseOption {
  id: string;
  label: string;
}

export interface DiffViewProps {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  baseOptions?: DiffBaseOption[];
  onBaseChange?: (fromId: string) => void;
  onClose: () => void;
}

export function DiffView({
  fromId,
  toId,
  fromLabel,
  toLabel,
  baseOptions,
  onBaseChange,
  onClose,
}: DiffViewProps) {
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError("");
    setStatus("loading");
    diffSnapshots(fromId, toId, PAGE_SIZE)
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fromId, toId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleLoadMore = useCallback(async () => {
    if (diff === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await diffSnapshots(fromId, toId, PAGE_SIZE, diff.hunks.length);
      setDiff((current) =>
        current === null
          ? next
          : { summary: next.summary, hunks: [...current.hunks, ...next.hunks], truncated: next.truncated },
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [diff, fromId, loadingMore, toId]);

  const groups = new Map<HunkKind, Hunk[]>();
  for (const hunk of diff?.hunks ?? []) {
    const kind: HunkKind =
      hunk.kind === "added" ||
      hunk.kind === "removed" ||
      hunk.kind === "moved" ||
      hunk.kind === "edited" ||
      hunk.kind === "page_title"
        ? hunk.kind
        : "edited";
    const list = groups.get(kind);
    if (list === undefined) groups.set(kind, [hunk]);
    else list.push(hunk);
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Diff ${fromLabel} to ${toLabel}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row diff-head">
          <div className="diff-title-block">
            <div className="diff-title">
              {fromLabel} <span aria-hidden="true">→</span> {toLabel}
            </div>
            {baseOptions !== undefined && baseOptions.length > 1 && onBaseChange !== undefined && (
              <label className="diff-base-row">
                <span className="diff-base-label">Compare from</span>
                <select
                  className="diff-base-select"
                  aria-label="Compare from version"
                  value={fromId}
                  onChange={(event) => onBaseChange(event.target.value)}
                >
                  {baseOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={option.id === toId}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="diff-head-actions">
            <a className="btn-ghost btn-sm" href={exportDiffUrl(fromId, toId, "md")} download>
              .md
            </a>
            <a className="btn-ghost btn-sm" href={exportDiffUrl(fromId, toId, "html")} download>
              .html
            </a>
            <button type="button" className="icon-button" aria-label="Close diff" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="palette-results diff-body">
          {status === "loading" && <div className="palette-empty">Loading diff…</div>}
          {status === "error" && (
            <div className="palette-empty" role="alert">
              Failed to load diff: {error}
            </div>
          )}
          {status === "ready" && diff !== null && (
            <>
              <div className="diff-summary" aria-label="Diff summary">
                <span className="diff-chip diff-chip-added">+{diff.summary.added} added</span>
                <span className="diff-chip diff-chip-removed">−{diff.summary.removed} removed</span>
                <span className="diff-chip diff-chip-moved">~{diff.summary.moved} moved</span>
                <span className="diff-chip diff-chip-edited">✎{diff.summary.edited} edited</span>
                <span className="diff-chip diff-chip-pages">
                  {diff.summary.pages_changed} pages changed
                </span>
              </div>
              {diff.hunks.length === 0 && (
                <div className="palette-empty">No changes between these versions.</div>
              )}
              {HUNK_KIND_ORDER.map((kind) => {
                const hunks = groups.get(kind);
                if (hunks === undefined || hunks.length === 0) return null;
                return (
                  <div key={kind} className="diff-group">
                    <div className="palette-group-label">
                      {hunkKindLabel(kind)} · {hunks.length}
                    </div>
                    {hunks.map((hunk) => (
                      <HunkCard key={`${hunk.page_id}:${hunk.block_id}`} hunk={hunk} />
                    ))}
                  </div>
                );
              })}
              {diff.truncated && (
                <div className="diff-truncated" role="status">
                  <span>Showing {diff.hunks.length} changes — more available.</span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={loadingMore}
                    onClick={() => void handleLoadMore()}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HunkCard({ hunk }: { hunk: Hunk }) {
  const edits = Array.isArray(hunk.word_edits) ? hunk.word_edits : [];
  return (
    <article className={`diff-hunk diff-hunk-${hunk.kind}`} aria-label={`${hunk.kind} change`}>
      <div className="diff-hunk-path">{hunkHeading(hunk)}</div>
      {hunk.kind === "moved" && hunk.moved_from !== null && (
        <div className="diff-moved-from">
          moved from {(hunk.moved_from.path ?? []).join(" / ") || hunk.moved_from.block_id}
        </div>
      )}
      {hunk.kind === "edited" && edits.length > 0 ? (
        <p className="diff-text">
          {edits.map((edit, i) => (
            <span key={i} className={wordEditClassName(edit.kind)}>
              {edit.text}
            </span>
          ))}
        </p>
      ) : (
        <>
          {hunk.before_text !== null && hunk.before_text !== undefined && hunk.before_text !== "" && (
            <p className="diff-text diff-before">{hunk.before_text}</p>
          )}
          {hunk.after_text !== null && hunk.after_text !== undefined && hunk.after_text !== "" && (
            <p className="diff-text diff-after">{hunk.after_text}</p>
          )}
        </>
      )}
    </article>
  );
}
