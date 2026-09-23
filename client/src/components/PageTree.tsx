import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Page } from "../api";
import {
  IconBook,
  IconChevronRight,
  IconDoc,
  IconFolder,
  IconMore,
  IconPlus,
  IconTrash,
} from "./icons";

export interface PageTreeProps {
  pages: Page[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function kindIcon(kind: string, size = 16): JSX.Element {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "folder") return <IconFolder size={size} />;
  if (normalized === "chapter" || normalized === "story") return <IconBook size={size} />;
  return <IconDoc size={size} />;
}

export function PageTree({
  pages,
  selectedId,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
}: PageTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const roots = pages.filter(
    (p) => p.parent_page_id === null || p.parent_page_id === undefined,
  );

  function toggleCollapse(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (pages.length === 0) return null;
  return (
    <ul className="page-tree" role="tree" aria-label="Pages">
      {roots.map((p) => (
        <TreeNode
          key={p.id}
          page={p}
          pages={pages}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onDelete={onDelete}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          depth={0}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  page,
  pages,
  selectedId,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  collapsed,
  onToggleCollapse,
  depth,
}: {
  page: Page;
  pages: Page[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  depth: number;
}) {
  const children = pages.filter((p) => p.parent_page_id === page.id);
  const isCollapsed = collapsed.has(page.id);
  const active = page.id === selectedId;
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menuOpen && !confirmDelete) return;
    function onDocDown(event: MouseEvent): void {
      if (rowRef.current !== null && !rowRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, confirmDelete]);

  return (
    <li
      ref={rowRef}
      role="treeitem"
      aria-expanded={children.length > 0 ? !isCollapsed : undefined}
      aria-selected={active}
      className="page-tree-node"
      style={{ "--tree-depth": depth } as CSSProperties}
    >
      <div className="page-row" data-active={active ? "true" : "false"}>
        {children.length > 0 ? (
          <button
            type="button"
            className="page-chevron"
            aria-label={isCollapsed ? `Expand ${page.title}` : `Collapse ${page.title}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapse(page.id)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="page-chevron-icon" data-collapsed={isCollapsed ? "true" : "false"}>
              <IconChevronRight size={14} />
            </span>
          </button>
        ) : (
          <span className="page-chevron page-chevron-spacer" aria-hidden="true" />
        )}
        {renaming ? (
          <>
            <span className="page-kind-icon" aria-hidden="true">
              {kindIcon(page.kind)}
            </span>
            <RenameInput
              initial={page.title}
              onCommit={(title) => {
                setRenaming(false);
                if (title.trim() !== "" && title.trim() !== page.title) {
                  onRename(page.id, title.trim());
                }
              }}
              onCancel={() => setRenaming(false)}
            />
          </>
        ) : (
          <button
            type="button"
            className="page-label"
            title={`${page.title || "Untitled"} (${page.kind})`}
            onClick={() => onSelect(page.id)}
            onDoubleClick={() => setRenaming(true)}
          >
            <span className="page-kind-icon" aria-hidden="true">
              {kindIcon(page.kind)}
            </span>
            <span className="page-title">{page.title || "(untitled)"}</span>
          </button>
        )}
        <span className="page-actions">
          <button
            type="button"
            className="page-action"
            aria-label={`Add a child page under ${page.title || "Untitled"}`}
            title="Add a child page"
            onClick={() => onCreateChild(page.id)}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className="page-action"
            aria-label={`More actions for ${page.title || "Untitled"}`}
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setConfirmDelete(false);
              setMenuOpen((open) => !open);
            }}
          >
            <IconMore size={14} />
          </button>
        </span>
        {menuOpen && !confirmDelete && (
          <div className="menu-popover page-row-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
            >
              <span className="menu-item-label">Rename</span>
            </button>
            <div className="menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={16} />
              <span className="menu-item-label">Delete page</span>
            </button>
          </div>
        )}
        {confirmDelete && (
          <div className="menu-popover page-row-menu" role="alertdialog" aria-label="Confirm delete">
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
                data-testid={`delete-page-${page.id}`}
                onClick={() => {
                  setConfirmDelete(false);
                  setMenuOpen(false);
                  onDelete(page.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
      {children.length > 0 && !isCollapsed && (
        <ul className="page-tree" role="group">
          {children.map((c) => (
            <TreeNode
              key={c.id}
              page={c}
              pages={pages}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      className="page-rename-input"
      aria-label="Rename page"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") onCancel();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
