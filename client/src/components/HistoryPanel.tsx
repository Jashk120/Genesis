import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createSnapshot,
  diffSnapshots,
  exportSnapshotUrl,
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  type DiffSummary,
  type Snapshot,
  type SnapshotMeta,
} from "../api";
import { DiffView } from "./DiffView";
import { IconDownload, IconEye, IconDiff, IconRestore } from "./icons";

export function versionTag(seq: number): string {
  return `V-${seq}`;
}

export function sortSnapshotsAsc(list: SnapshotMeta[]): SnapshotMeta[] {
  return [...list].sort((a, b) => a.seq - b.seq);
}

export function snapshotDisplayLabel(meta: SnapshotMeta): string {
  const label = (meta.label ?? "").trim();
  return label === "" ? "(untitled version)" : label;
}

export function formatBytes(size: number | null | undefined): string {
  if (size === null || size === undefined || Number.isNaN(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSnapshotDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "unknown date";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "unknown date";
  return new Date(iso).toLocaleString();
}

export function formatRowDiff(summary: DiffSummary): string {
  return `+${summary.added}/−${summary.removed}/~${summary.moved}/${summary.edited} edited`;
}

export function isConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export interface HistoryPanelProps {
  pageId: string;
  onRestored: () => void;
  onClose: () => void;
}

interface DiffTarget {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
}

export function HistoryPanel({ pageId, onRestored, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const list = await listSnapshots(pageId);
      setSnapshots(sortSnapshotsAsc(Array.isArray(list) ? list : []));
      setStatus("ready");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [pageId]);

  useEffect(() => {
    setDiffTarget(null);
    setPreview(null);
    setRestoreId(null);
    setCreateError("");
    setRestoreError("");
    void refresh();
  }, [pageId, refresh]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && diffTarget === null && preview === null && !previewLoading) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [diffTarget, onClose, preview, previewLoading]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setCreateError("");
    try {
      await createSnapshot(pageId, label.trim());
      setLabel("");
      await refresh();
    } catch (err: unknown) {
      if (isConflictError(err)) {
        setCreateError(
          "No changes since the last version, or a version with this label already exists.",
        );
      } else {
        setCreateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleView(meta: SnapshotMeta): Promise<void> {
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      setPreview(await getSnapshot(meta.id));
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleDiff(meta: SnapshotMeta): void {
    const idx = snapshots.findIndex((s) => s.id === meta.id);
    const previous = idx > 0 ? snapshots[idx - 1] : undefined;
    setDiffTarget({
      fromId: previous !== undefined ? previous.id : meta.id,
      toId: meta.id,
      fromLabel: previous !== undefined ? snapshotDisplayLabel(previous) : snapshotDisplayLabel(meta),
      toLabel: snapshotDisplayLabel(meta),
    });
  }

  async function handleRestore(meta: SnapshotMeta): Promise<void> {
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreSnapshot(meta.id);
      setRestoreId(null);
      onRestored();
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  }

  const baseOptions = snapshots.map((s) => ({
    id: s.id,
    label: `${versionTag(s.seq)} · ${snapshotDisplayLabel(s)}`,
  }));

  return (
    <aside className="history-panel" aria-label="Version history">
      <div className="history-head">
        <h2 className="history-title">History</h2>
        <button type="button" className="icon-button" aria-label="Close history" onClick={onClose}>
          ✕
        </button>
      </div>

      <form
        className="history-create"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <label className="history-create-label" htmlFor="history-label-input">
          Create version
        </label>
        <div className="history-create-row">
          <input
            id="history-label-input"
            className="ws-create-input"
            placeholder="Version label…"
            value={label}
            disabled={creating}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            type="submit"
            className="btn-primary btn-sm"
            disabled={creating || label.trim() === ""}
          >
            {creating ? "Saving…" : "Save"}
          </button>
        </div>
        {createError !== "" && (
          <p className="history-error" role="alert">
            {createError}
          </p>
        )}
      </form>

      <div className="history-list-wrap">
        {status === "loading" && <p className="app-hint">Loading versions…</p>}
        {status === "error" && (
          <div className="history-error-block" role="alert">
            <p className="history-error">Failed to load versions: {error}</p>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {status === "ready" && snapshots.length === 0 && (
          <p className="app-hint">No versions yet. Save the first version above.</p>
        )}
        {status === "ready" && snapshots.length > 0 && (
          <ul className="history-list">
            {[...snapshots].reverse().map((meta) => {
              const idx = snapshots.findIndex((s) => s.id === meta.id);
              const previous = idx > 0 ? snapshots[idx - 1] : undefined;
              return (
                <VersionRow
                  key={meta.id}
                  meta={meta}
                  previous={previous}
                  confirmingRestore={restoreId === meta.id}
                  onView={() => void handleView(meta)}
                  onDiff={() => handleDiff(meta)}
                  onRestoreRequest={() => {
                    setRestoreError("");
                    setRestoreId(meta.id);
                  }}
                  onRestoreCancel={() => setRestoreId(null)}
                  onRestoreConfirm={() => void handleRestore(meta)}
                  restoring={restoring}
                />
              );
            })}
          </ul>
        )}
        {restoreError !== "" && (
          <p className="history-error" role="alert">
            Restore failed: {restoreError}
          </p>
        )}
      </div>

      {(preview !== null || previewLoading || previewError !== "") && (
        <PreviewModal
          snapshot={preview}
          loading={previewLoading}
          error={previewError}
          onClose={() => {
            setPreview(null);
            setPreviewError("");
          }}
        />
      )}

      {diffTarget !== null && (
        <DiffView
          fromId={diffTarget.fromId}
          toId={diffTarget.toId}
          fromLabel={diffTarget.fromLabel}
          toLabel={diffTarget.toLabel}
          baseOptions={baseOptions}
          onBaseChange={(fromId) => {
            const base = snapshots.find((s) => s.id === fromId);
            if (base === undefined) return;
            setDiffTarget((current) =>
              current === null
                ? current
                : { ...current, fromId, fromLabel: snapshotDisplayLabel(base) },
            );
          }}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </aside>
  );
}

function VersionRow({
  meta,
  previous,
  confirmingRestore,
  restoring,
  onView,
  onDiff,
  onRestoreRequest,
  onRestoreCancel,
  onRestoreConfirm,
}: {
  meta: SnapshotMeta;
  previous: SnapshotMeta | undefined;
  confirmingRestore: boolean;
  restoring: boolean;
  onView: () => void;
  onDiff: () => void;
  onRestoreRequest: () => void;
  onRestoreCancel: () => void;
  onRestoreConfirm: () => void;
}) {
  const [rowDiff, setRowDiff] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (previous === undefined) {
      setRowDiff(null);
      return;
    }
    diffSnapshots(previous.id, meta.id, 1)
      .then((diff) => {
        if (!cancelled) setRowDiff(formatRowDiff(diff.summary));
      })
      .catch(() => {
        if (!cancelled) setRowDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.id, previous]);

  return (
    <li className="history-row">
      <div className="history-row-main">
        <span className="history-seq">{versionTag(meta.seq)}</span>
        <span className="history-row-label" title={snapshotDisplayLabel(meta)}>
          {snapshotDisplayLabel(meta)}
        </span>
      </div>
      <div className="history-row-meta">
        <span>{formatSnapshotDate(meta.created_at)}</span>
        {rowDiff !== null && <span aria-label="Changes since previous version">{rowDiff}</span>}
        <span>{formatBytes(meta.byte_size)}</span>
      </div>
      {!confirmingRestore && (
        <div className="history-row-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-label={`View ${snapshotDisplayLabel(meta)}`}
            title="View"
            onClick={onView}
          >
            <IconEye size={14} aria-hidden="true" /> View
          </button>
          {previous !== undefined && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label={`Diff ${snapshotDisplayLabel(meta)} against previous version`}
              title="Diff against previous version"
              onClick={onDiff}
            >
              <IconDiff size={14} aria-hidden="true" /> Diff
            </button>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-label={`Restore ${snapshotDisplayLabel(meta)}`}
            title="Restore"
            onClick={onRestoreRequest}
          >
            <IconRestore size={14} aria-hidden="true" /> Restore
          </button>
          <span className="history-export-links">
            <a
              className="history-export-link"
              href={exportSnapshotUrl(meta.id, "md")}
              download
              aria-label={`Export ${snapshotDisplayLabel(meta)} as Markdown`}
              title="Export Markdown"
            >
              <IconDownload size={14} aria-hidden="true" /> .md
            </a>
            <a
              className="history-export-link"
              href={exportSnapshotUrl(meta.id, "html")}
              download
              aria-label={`Export ${snapshotDisplayLabel(meta)} as HTML`}
              title="Export HTML"
            >
              .html
            </a>
          </span>
        </div>
      )}
      {confirmingRestore && (
        <div className="history-confirm" role="alertdialog" aria-label="Confirm restore">
          <span className="history-confirm-text">
            Restore {versionTag(meta.seq)}? Current content will be replaced.
          </span>
          <span className="confirm-row">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={restoring}
              onClick={onRestoreCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              aria-label={`Confirm restore ${snapshotDisplayLabel(meta)}`}
              disabled={restoring}
              onClick={onRestoreConfirm}
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function PreviewModal({
  snapshot,
  loading,
  error,
  onClose,
}: {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
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

  const pages = snapshot !== null && Array.isArray(snapshot.content?.pages)
    ? snapshot.content.pages
    : [];

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Version preview"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row diff-head">
          <div className="diff-title-block">
            <div className="diff-title">
              {snapshot !== null
                ? `${versionTag(snapshot.seq)} · ${snapshotDisplayLabel(snapshot)}`
                : "Version preview"}
            </div>
          </div>
          <div className="diff-head-actions">
            {snapshot !== null && (
              <>
                <a className="btn-ghost btn-sm" href={exportSnapshotUrl(snapshot.id, "md")} download>
                  .md
                </a>
                <a
                  className="btn-ghost btn-sm"
                  href={exportSnapshotUrl(snapshot.id, "html")}
                  download
                >
                  .html
                </a>
              </>
            )}
            <button type="button" className="icon-button" aria-label="Close preview" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="palette-results diff-body">
          {loading && <div className="palette-empty">Loading version…</div>}
          {!loading && error !== "" && (
            <div className="palette-empty" role="alert">
              Failed to load version: {error}
            </div>
          )}
          {!loading && error === "" && snapshot !== null && (
            <>
              <div className="diff-summary" aria-label="Version details">
                <span className="diff-chip">{formatSnapshotDate(snapshot.created_at)}</span>
                <span className="diff-chip">{formatBytes(snapshot.byte_size)}</span>
                {snapshot.block_count !== null && snapshot.block_count !== undefined && (
                  <span className="diff-chip">{snapshot.block_count} blocks</span>
                )}
              </div>
              {pages.length === 0 ? (
                <div className="palette-empty">This version contains no pages.</div>
              ) : (
                <ul className="preview-page-list">
                  {pages.map((page) => (
                    <li key={page.id} className="preview-page-row">
                      <span className="preview-page-title">{page.title || "Untitled"}</span>
                      <span className="palette-item-kind">{page.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
