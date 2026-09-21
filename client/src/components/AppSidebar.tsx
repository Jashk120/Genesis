import { useEffect, useRef, useState } from "react";
import type { Page, Workspace } from "../api";
import { PageTree } from "./PageTree";
import { IconChevronDown, IconLayers, IconPlus, IconSearch, IconUser } from "./icons";

export interface AppSidebarProps {
  workspaces: Workspace[];
  workspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  pages: Page[];
  selectedId: string | null;
  onSelectPage: (id: string) => void;
  onCreatePage: () => void;
  onOpenSearch: () => void;
}

/** AFFiNE-style left navigation panel. */
export function AppSidebar({
  workspaces,
  workspaceId,
  onSelectWorkspace,
  pages,
  selectedId,
  onSelectPage,
  onCreatePage,
  onOpenSearch,
}: AppSidebarProps) {
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);
  const current = workspaces.find((w) => w.id === workspaceId) ?? null;

  useEffect(() => {
    if (!wsOpen) return;
    function onDocDown(event: MouseEvent): void {
      if (wsRef.current !== null && !wsRef.current.contains(event.target as Node)) {
        setWsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [wsOpen]);

  return (
    <aside className="app-sidebar">
      <div className="sidebar-top">
        <div className="sidebar-workspace-row">
          <div className="ws-switch" ref={wsRef}>
            <button
              type="button"
              className="ws-button"
              aria-haspopup="menu"
              aria-expanded={wsOpen}
              onClick={() => setWsOpen((open) => !open)}
            >
              <span className="ws-avatar">{initial(current?.title ?? "G")}</span>
              <span className="ws-name">{current?.title ?? "Workspace"}</span>
              <IconChevronDown size={16} className="ws-chevron" />
            </button>
            {wsOpen && (
              <div className="menu-popover ws-menu" role="menu">
                <div className="menu-label">Workspaces</div>
                {workspaces.length === 0 && <div className="menu-empty">No workspaces</div>}
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    data-active={workspace.id === workspaceId ? "true" : "false"}
                    onClick={() => {
                      onSelectWorkspace(workspace.id);
                      setWsOpen(false);
                    }}
                  >
                    <span className="ws-avatar ws-avatar-sm">{initial(workspace.title)}</span>
                    <span className="menu-item-label">{workspace.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="icon-button" title="Account" aria-label="Account">
            <IconUser size={18} />
          </button>
        </div>

        <div className="sidebar-search-row">
          <button
            type="button"
            className="search-trigger"
            data-testid="sidebar-search"
            onClick={onOpenSearch}
          >
            <IconSearch size={16} />
            <span className="search-trigger-label">Search</span>
          </button>
          <button
            type="button"
            className="icon-button"
            title="New page"
            aria-label="New page"
            data-testid="sidebar-new-page"
            onClick={onCreatePage}
          >
            <IconPlus size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button type="button" className="menu-item" data-active="true">
            <IconLayers size={18} />
            <span className="menu-item-label">All Docs</span>
          </button>
        </nav>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Pages</div>
          <PageTree pages={pages} selectedId={selectedId} onSelect={onSelectPage} />
        </div>
      </div>
    </aside>
  );
}

function initial(title: string): string {
  const trimmed = title.trim();
  return trimmed === "" ? "G" : trimmed.slice(0, 1).toUpperCase();
}
