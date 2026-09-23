import { useEffect, useRef, useState } from "react";
import {
  clusterExportUrl,
  exportPageUrl,
  historyBundleUrl,
  listSnapshots,
  type SnapshotMeta,
} from "../api";
import { snapshotDisplayLabel, versionTag } from "./HistoryPanel";
import { IconDownload } from "./icons";

export const HISTORY_ZIP_THRESHOLD = 10;

export function historyBundleKind(selectedCount: number, totalCount: number): string {
  const count = selectedCount === 0 ? totalCount : selectedCount;
  return count >= HISTORY_ZIP_THRESHOLD ? "zip archive" : "single file";
}

export interface ExportMenuProps {
  pageId: string;
}

export function ExportMenu({ pageId }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected([]);
    setOpen(false);
  }, [pageId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSnapshots(pageId)
      .then((list) => {
        if (!cancelled) setSnapshots(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSnapshots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pageId]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(event: MouseEvent): void {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  function toggleVersion(id: string): void {
    setSelected((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    );
  }

  const bundleKind = historyBundleKind(selected.length, snapshots.length);
  const bundleVersions = selected.length === 0 ? undefined : selected;

  return (
    <div className="doc-action-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-button"
        title="Export"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconDownload size={18} />
      </button>
      {open && (
        <div className="menu-popover doc-menu export-menu" role="menu" aria-label="Export options">
          <div className="menu-label">Export current</div>
          <a
            className="menu-item"
            role="menuitem"
            href={exportPageUrl(pageId, "md")}
            download
            aria-label="Export current page as Markdown"
          >
            <span className="menu-item-label">Markdown (.md)</span>
          </a>
          <a
            className="menu-item"
            role="menuitem"
            href={exportPageUrl(pageId, "html")}
            download
            aria-label="Export current page as HTML"
          >
            <span className="menu-item-label">HTML (.html)</span>
          </a>

          <div className="menu-divider" />
          <div className="menu-label">History bundle · {bundleKind}</div>
          {snapshots.length === 0 ? (
            <div className="menu-empty">No versions yet.</div>
          ) : (
            <div className="export-version-list" role="group" aria-label="Bundle versions">
              {snapshots.map((snapshot) => (
                <label key={snapshot.id} className="export-version-row">
                  <input
                    type="checkbox"
                    checked={selected.includes(snapshot.id)}
                    onChange={() => toggleVersion(snapshot.id)}
                    aria-label={`Include ${versionTag(snapshot.seq)} ${snapshotDisplayLabel(snapshot)} in bundle`}
                  />
                  <span className="export-version-tag">{versionTag(snapshot.seq)}</span>
                  <span className="menu-item-label">{snapshotDisplayLabel(snapshot)}</span>
                </label>
              ))}
            </div>
          )}
          <a
            className="menu-item"
            role="menuitem"
            href={historyBundleUrl(pageId, "md", bundleVersions)}
            download
            aria-label={`Export history bundle as Markdown (${bundleKind})`}
          >
            <span className="menu-item-label">
              Bundle Markdown ({bundleKind}
              {selected.length > 0 ? `, ${selected.length} selected` : ", all versions"})
            </span>
          </a>
          <a
            className="menu-item"
            role="menuitem"
            href={historyBundleUrl(pageId, "html", bundleVersions)}
            download
            aria-label={`Export history bundle as HTML (${bundleKind})`}
          >
            <span className="menu-item-label">
              Bundle HTML ({bundleKind}
              {selected.length > 0 ? `, ${selected.length} selected` : ", all versions"})
            </span>
          </a>

          <div className="menu-divider" />
          <div className="menu-label">Cluster export</div>
          <a
            className="menu-item"
            role="menuitem"
            href={clusterExportUrl(pageId, "md")}
            download
            aria-label="Export cluster as Markdown"
          >
            <span className="menu-item-label">Cluster Markdown (.md)</span>
          </a>
          <a
            className="menu-item"
            role="menuitem"
            href={clusterExportUrl(pageId, "html")}
            download
            aria-label="Export cluster as HTML"
          >
            <span className="menu-item-label">Cluster HTML (.html)</span>
          </a>
        </div>
      )}
    </div>
  );
}
