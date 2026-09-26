import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { Page } from "../api";
import { IconEye, IconEyeOff, IconHistory, IconInfo, IconMore, IconStar, IconTrash } from "./icons";

export interface DocumentHeaderProps {
  page: Page | null;
  pages: Page[];
  onNavigate: (id: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  showVersionTools?: boolean;
  showVisibilityTools?: boolean;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  onRevealAll?: () => void;
  onHideAll?: () => void;
  exportMenu?: ReactNode;
}

function ancestorsOf(pages: Page[], page: Page): Page[] {
  const chain: Page[] = [];
  const seen = new Set<string>();
  let parentId = page.parent_page_id;
  while (parentId !== null && parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = pages.find((p) => p.id === parentId);
    if (parent === undefined) break;
    chain.unshift(parent);
    parentId = parent.parent_page_id;
  }
  return chain;
}

export function DocumentHeader({
  page,
  pages,
  onNavigate,
  onRename,
  onDelete,
  showVersionTools = false,
  showVisibilityTools = false,
  historyOpen = false,
  onToggleHistory,
  onRevealAll,
  onHideAll,
  exportMenu,
}: DocumentHeaderProps) {
  const [favorite, setFavorite] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const prevPageId = useRef<string | null>(null);

  if (page !== null && prevPageId.current !== page.id) {
    prevPageId.current = page.id;
  }

  useEffect(() => {
    setFavorite(false);
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(false);
  }, [page?.id]);

  useEffect(() => {
    if (!menuOpen && !infoOpen) return;
    function onDocDown(event: MouseEvent): void {
      if (actionsRef.current !== null && !actionsRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setInfoOpen(false);
        setConfirmDelete(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setInfoOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, infoOpen]);

  if (page === null) {
    return (
      <header className="doc-header">
        <span className="doc-header-placeholder">Select a page</span>
      </header>
    );
  }

  const ancestors = ancestorsOf(pages, page);
  const parent = page.parent_page_id
    ? (pages.find((p) => p.id === page.parent_page_id) ?? null)
    : null;

  return (
    <header className="doc-header">
      <div className="doc-title-block">
        {ancestors.length > 0 && (
          <nav className="doc-breadcrumb" aria-label="Breadcrumb">
            {ancestors.map((crumb, i) => (
              <span key={crumb.id} className="doc-crumb">
                {i > 0 && (
                  <span className="doc-crumb-sep" aria-hidden="true">
                    /
                  </span>
                )}
                <button
                  type="button"
                  className="doc-crumb-link"
                  title={crumb.title || "Untitled"}
                  onClick={() => onNavigate(crumb.id)}
                >
                  {crumb.title || "Untitled"}
                </button>
              </span>
            ))}
          </nav>
        )}
        <TitleInput
          key={page.id}
          title={page.title}
          inputRef={titleRef}
          onRename={onRename}
        />
      </div>

      <div className="doc-actions" ref={actionsRef}>
        {showVersionTools && onToggleHistory !== undefined && (
          <button
            type="button"
            className="icon-button"
            title={historyOpen ? "Close version history" : "Open version history"}
            aria-label={historyOpen ? "Close version history" : "Open version history"}
            aria-pressed={historyOpen}
            onClick={onToggleHistory}
          >
            <IconHistory size={18} />
          </button>
        )}
        {showVisibilityTools && onRevealAll !== undefined && (
          <button
            type="button"
            className="icon-button"
            title="Reveal all spoilers"
            aria-label="Reveal all spoilers"
            data-testid="reveal-all-spoilers"
            onClick={onRevealAll}
          >
            <IconEye size={18} />
          </button>
        )}
        {showVisibilityTools && onHideAll !== undefined && (
          <button
            type="button"
            className="icon-button"
            title="Hide all spoilers"
            aria-label="Hide all spoilers"
            data-testid="hide-all-spoilers"
            onClick={onHideAll}
          >
            <IconEyeOff size={18} />
          </button>
        )}
        {showVersionTools && exportMenu}
        <button
          type="button"
          className="icon-button"
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
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
            aria-label="Page info"
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            onClick={() => {
              setInfoOpen((open) => !open);
              setMenuOpen(false);
              setConfirmDelete(false);
            }}
          >
            <IconInfo size={18} />
          </button>
          {infoOpen && (
            <div className="menu-popover info-popover" role="dialog" aria-label="Page info">
              <div className="menu-label">Info</div>
              <dl className="info-list">
                <div className="info-row">
                  <dt>Kind</dt>
                  <dd>{page.kind}</dd>
                </div>
                <div className="info-row">
                  <dt>Page id</dt>
                  <dd className="info-mono info-truncate" title={page.id}>
                    {page.id}
                  </dd>
                </div>
                <div className="info-row">
                  <dt>Parent</dt>
                  <dd>{parent !== null ? parent.title || "Untitled" : "—"}</dd>
                </div>
                {page.ordinal !== undefined && (
                  <div className="info-row">
                    <dt>Order</dt>
                    <dd>{page.ordinal}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>

        <div className="doc-action-wrap">
          <button
            type="button"
            className="icon-button"
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
              setInfoOpen(false);
              setConfirmDelete(false);
            }}
          >
            <IconMore size={18} />
          </button>
          {menuOpen && (
            <div className="menu-popover doc-menu" role="menu" aria-label="Page actions">
              {!confirmDelete && (
                <>
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
                    onClick={() => setConfirmDelete(true)}
                  >
                    <IconTrash size={16} />
                    <span className="menu-item-label">Delete page</span>
                  </button>
                </>
              )}
              {confirmDelete && (
                <div role="alertdialog" aria-label="Confirm delete">
                  <div className="confirm-title">Delete this page?</div>
                  <div className="confirm-sub">{page.title || "Untitled"}</div>
                  <div className="confirm-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setConfirmDelete(false);
                        setMenuOpen(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      data-testid="confirm-delete-page"
                      onClick={() => {
                        setConfirmDelete(false);
                        setMenuOpen(false);
                        onDelete();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
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
