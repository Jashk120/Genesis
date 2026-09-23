import { useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../api";
import { IconSearch } from "./icons";
import { kindIcon } from "./PageTree";

export interface SearchPaletteProps {
  open: boolean;
  pages: Page[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

function groupLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "folder") return "Folders";
  if (normalized === "chapter" || normalized === "story") return "Chapters";
  if (normalized === "note") return "Notes";
  return "Pages";
}

function HighlightedTitle({ title, query }: { title: string; query: string }) {
  const text = title === "" ? "Untitled" : title;
  const needle = query.trim();
  if (needle === "") return <span className="palette-item-title">{text}</span>;
  const lower = text.toLowerCase();
  const start = lower.indexOf(needle.toLowerCase());
  if (start < 0) return <span className="palette-item-title">{text}</span>;
  return (
    <span className="palette-item-title">
      {text.slice(0, start)}
      <mark className="palette-match">{text.slice(start, start + needle.length)}</mark>
      {text.slice(start + needle.length)}
    </span>
  );
}

export function SearchPalette({ open, pages, onClose, onSelect }: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches =
      needle === ""
        ? pages
        : pages.filter((page) => page.title.toLowerCase().includes(needle));
    return matches.slice(0, 50);
  }, [pages, query]);

  const groups = useMemo(() => {
    const order = new Map<string, Page[]>();
    for (const page of results) {
      const label = groupLabel(page.kind);
      const list = order.get(label);
      if (list === undefined) order.set(label, [page]);
      else list.push(page);
    }
    return [...order.entries()];
  }, [results]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open ]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const active = results[index];
    document
      .querySelector(`[data-palette-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
    void active;
  }, [index, open, results]);

  if (!open) return null;

  function choose(at: number): void {
    const page = results[at];
    if (page === undefined) return;
    onSelect(page.id);
    onClose();
  }

  let position = -1;

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <IconSearch size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search pages…"
            aria-label="Search pages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(index);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd className="kbd" aria-hidden="true">
            esc
          </kbd>
        </div>
        <div className="palette-results" role="listbox" aria-label="Matching pages">
          {results.length === 0 && (
            <div className="palette-empty">No results for &ldquo;{query.trim()}&rdquo;</div>
          )}
          {groups.map(([label, groupPages]) => (
            <div key={label} className="palette-group">
              <div className="palette-group-label">{label}</div>
              {groupPages.map((page) => {
                position += 1;
                const at = position;
                return (
                  <button
                    key={page.id}
                    type="button"
                    role="option"
                    aria-selected={at === index}
                    className="palette-item"
                    data-active={at === index ? "true" : "false"}
                    data-palette-index={at}
                    onMouseEnter={() => setIndex(at)}
                    onClick={() => choose(at)}
                  >
                    <span className="palette-item-icon" aria-hidden="true">
                      {kindIcon(page.kind, 18)}
                    </span>
                    <HighlightedTitle title={page.title} query={query} />
                    <span className="palette-item-kind">{page.kind}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-footer" aria-hidden="true">
          <span className="palette-hint">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            <span>navigate</span>
          </span>
          <span className="palette-hint">
            <kbd className="kbd">↵</kbd>
            <span>open</span>
          </span>
          <span className="palette-hint">
            <kbd className="kbd">esc</kbd>
            <span>close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
