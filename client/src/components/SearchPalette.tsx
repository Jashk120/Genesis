import { useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../api";
import { IconSearch } from "./icons";

export interface SearchPaletteProps {
  open: boolean;
  pages: Page[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

/** Cmd/Ctrl+K quick search — AFFiNE's sidebar search surface. */
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

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  function choose(at: number): void {
    const page = results[at];
    if (page === undefined) return;
    onSelect(page.id);
    onClose();
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Search pages"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <IconSearch size={18} />
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
        </div>
        <div className="palette-results">
          {results.length === 0 && <div className="palette-empty">No pages found</div>}
          {results.map((page, position) => (
            <button
              key={page.id}
              type="button"
              className="palette-item"
              data-active={position === index ? "true" : "false"}
              onMouseEnter={() => setIndex(position)}
              onClick={() => choose(position)}
            >
              <span className="palette-item-title">{page.title || "Untitled"}</span>
              <span className="palette-item-kind">{page.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
