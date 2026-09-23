import { useEffect, useRef, useState } from "react";
import type { Page, Workspace } from "../api";
import { createWorkspace } from "../api";
import { PageTree } from "./PageTree";
import {
  IconChevronDown,
  IconLayers,
  IconPlus,
  IconSearch,
  IconSettings,
  IconUser,
} from "./icons";

export interface AppSidebarProps {
  workspaces: Workspace[];
  workspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onWorkspacesChanged: (selectId?: string) => void;
  pages: Page[];
  selectedId: string | null;
  onSelectPage: (id: string) => void;
  onShowAllDocs: () => void;
  onCreatePage: () => void;
  onCreateChild: (parentId: string) => void;
  onRenamePage: (id: string, title: string) => void;
  onDeletePage: (id: string) => void;
  onOpenSearch: () => void;
}

export function AppSidebar({
  workspaces,
  workspaceId,
  onSelectWorkspace,
  onWorkspacesChanged,
  pages,
  selectedId,
  onSelectPage,
  onShowAllDocs,
  onCreatePage,
  onCreateChild,
  onRenamePage,
  onDeletePage,
  onOpenSearch,
}: AppSidebarProps) {
  const [wsOpen, setWsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creatingWs, setCreatingWs] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsError, setWsError] = useState("");
  const wsRef = useRef<HTMLDivElement>(null);
  const current = workspaces.find((w) => w.id === workspaceId) ?? null;

  useEffect(() => {
    if (!wsOpen) return;
    function onDocDown(event: MouseEvent): void {
      if (wsRef.current !== null && !wsRef.current.contains(event.target as Node)) {
        setWsOpen(false);
        setCreatingWs(false);
        setSettingsOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setWsOpen(false);
        setCreatingWs(false);
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [wsOpen]);

  async function handleCreateWorkspace(): Promise<void> {
    const title = wsName.trim();
    if (title === "") return;
    setWsError("");
    try {
      const ws = await createWorkspace(title);
      setWsName("");
      setCreatingWs(false);
      setWsOpen(false);
      onWorkspacesChanged(ws.id);
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="app-sidebar" aria-label="Sidebar">
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
              <span className="ws-avatar" aria-hidden="true">
                {initial(current?.title ?? "G")}
              </span>
              <span className="ws-name">{current?.title ?? "Workspace"}</span>
              <IconChevronDown size={16} className="ws-chevron" />
            </button>
            {wsOpen && (
              <div className="menu-popover ws-menu" role="menu" aria-label="Workspaces">
                {!settingsOpen && (
                  <>
                    <div className="menu-label">Workspaces</div>
                    {workspaces.length === 0 && (
                      <div className="menu-empty">No workspaces</div>
                    )}
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
                        <span className="ws-avatar ws-avatar-sm" aria-hidden="true">
                          {initial(workspace.title)}
                        </span>
                        <span className="menu-item-label">{workspace.title}</span>
                      </button>
                    ))}
                    <div className="menu-divider" />
                    {creatingWs ? (
                      <div className="ws-create-row">
                        <input
                          autoFocus
                          className="ws-create-input"
                          aria-label="New workspace name"
                          placeholder="Workspace name"
                          value={wsName}
                          onChange={(event) => setWsName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleCreateWorkspace();
                            if (event.key === "Escape") setCreatingWs(false);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => void handleCreateWorkspace()}
                        >
                          Create
                        </button>
                        {wsError !== "" && (
                          <div className="ws-create-error" role="alert">
                            {wsError}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => setCreatingWs(true)}
                      >
                        <IconPlus size={16} />
                        <span className="menu-item-label">New workspace</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <IconSettings size={16} />
                      <span className="menu-item-label">Settings</span>
                    </button>
                  </>
                )}
                {settingsOpen && (
                  <>
                    <div className="menu-label">Workspace settings</div>
                    <dl className="info-list">
                      <div className="info-row">
                        <dt>Name</dt>
                        <dd>{current?.title ?? "—"}</dd>
                      </div>
                      <div className="info-row">
                        <dt>Id</dt>
                        <dd className="info-mono info-truncate" title={current?.id ?? ""}>
                          {current?.id ?? "—"}
                        </dd>
                      </div>
                      <div className="info-row">
                        <dt>Pages</dt>
                        <dd>{pages.length}</dd>
                      </div>
                    </dl>
                    <div className="menu-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => setSettingsOpen(false)}
                    >
                      <span className="menu-item-label">Back</span>
                    </button>
                  </>
                )}
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
            aria-label="Search pages (Ctrl+K)"
            onClick={onOpenSearch}
          >
            <IconSearch size={16} />
            <span className="search-trigger-label">Search</span>
            <kbd className="search-trigger-kbd" aria-hidden="true">
              ⌘K
            </kbd>
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

        <nav className="sidebar-nav" aria-label="Primary">
          <button
            type="button"
            className="menu-item"
            data-active={selectedId === null ? "true" : "false"}
            aria-current={selectedId === null ? "page" : undefined}
            title="Show all docs"
            onClick={onShowAllDocs}
          >
            <IconLayers size={18} />
            <span className="menu-item-label">All Docs</span>
          </button>
        </nav>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Pages</div>
          {pages.length === 0 ? (
            <div className="sidebar-empty">
              <p className="sidebar-empty-text">No pages yet. Start your first doc.</p>
              <button type="button" className="btn-primary btn-sm" onClick={onCreatePage}>
                <IconPlus size={14} />
                <span>New page</span>
              </button>
            </div>
          ) : (
            <PageTree
              pages={pages}
              selectedId={selectedId}
              onSelect={onSelectPage}
              onCreateChild={onCreateChild}
              onRename={onRenamePage}
              onDelete={onDeletePage}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

function initial(title: string): string {
  const trimmed = title.trim();
  return trimmed === "" ? "G" : trimmed.slice(0, 1).toUpperCase();
}
