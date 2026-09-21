import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Page } from "../api";
import { IconInfo, IconMore, IconStar, IconTrash } from "./icons";

export interface DocumentHeaderProps {
  page: Page | null;
  onRename: (title: string) => void;
  onDelete: () => void;
}

/** AFFiNE-style document header: inline title, then right-adjacent actions. */
export function DocumentHeader({ page, onRename, onDelete }: DocumentHeaderProps) {
  const [favorite, setFavorite] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen && !infoOpen) return;
    function onDocDown(event: MouseEvent): void {
      if (actionsRef.current !== null && !actionsRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setInfoOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen, infoOpen]);

  if (page === null) {
    return (
      <header className="doc-header">
        <span className="doc-header-placeholder">Select a page</span>
      </header>
    );
  }

  return (
    <header className="doc-header">
      <TitleInput
        key={page.id}
        title={page.title}
        inputRef={titleRef}
        onRename={onRename}
      />

      <div className="doc-actions" ref={actionsRef}>
        <button
          type="button"
          className="icon-button"
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          onClick={() => setFavorite((value) => !value)}
        >
          <IconStar size={18} filled={favorite} />
        </button>

        <div className="doc-action-wrap">
          <button
            type="button"
            className="icon-button"
            title="Page info"
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            onClick={() => {
              setInfoOpen((open) => !open);
              setMenuOpen(false);
            }}
          >
            <IconInfo size={18} />
          </button>
          {infoOpen && (
            <div className="menu-popover info-popover" role="dialog">
              <div className="menu-label">Info</div>
              <dl className="info-list">
                <div className="info-row">
                  <dt>Kind</dt>
                  <dd>{page.kind}</dd>
                </div>
                <div className="info-row">
                  <dt>Page id</dt>
                  <dd className="info-mono">{page.id}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <div className="doc-action-wrap">
          <button
            type="button"
            className="icon-button"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
              setInfoOpen(false);
            }}
          >
            <IconMore size={18} />
          </button>
          {menuOpen && (
            <div className="menu-popover doc-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  titleRef.current?.focus();
                  titleRef.current?.select();
                }}
              >
                <span className="menu-item-label">Rename</span>
              </button>
              <div className="menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="menu-item menu-item-danger"
                data-testid="delete-page"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <IconTrash size={16} />
                <span className="menu-item-label">Delete page</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function TitleInput({
  title,
  inputRef,
  onRename,
}: {
  title: string;
  inputRef: RefObject<HTMLInputElement>;
  onRename: (title: string) => void;
}) {
  const [value, setValue] = useState(title);

  function commit(): void {
    const trimmed = value.trim();
    if (trimmed !== "" && trimmed !== title) onRename(trimmed);
    else setValue(title);
  }

  return (
    <input
      ref={inputRef}
      aria-label="Page title"
      data-testid="page-title-input"
      className="doc-title-input"
      placeholder="Untitled"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setValue(title);
      }}
    />
  );
}
