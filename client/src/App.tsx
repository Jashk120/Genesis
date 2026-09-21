import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPage,
  deletePage,
  getPageBlocks,
  listPages,
  listWorkspaces,
  updatePage,
  type Page,
  type Workspace,
} from "./api";
import type { DeltaTree } from "./mapper";
import { PageTree } from "./components/PageTree";
import { PageEditor } from "./components/PageEditor";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [tree, setTree] = useState<DeltaTree | null>(null);
  const [status, setStatus] = useState<string>("");
  const [newTitle, setNewTitle] = useState<string>("");
  const pendingFlushRef = useRef<(() => Promise<void>) | null>(null);

  const refreshPages = useCallback(async (wsId: string) => {
    setPages(await listPages(wsId));
  }, []);

  useEffect(() => {
    listWorkspaces()
      .then((ws) => {
        setWorkspaces(ws);
        if (ws.length > 0 && ws[0] !== undefined) setWorkspaceId(ws[0].id);
      })
      .catch((err: unknown) => setStatus(`Failed to load workspaces: ${errMsg(err)}`));
  }, []);

  useEffect(() => {
    if (workspaceId === null) return;
    refreshPages(workspaceId).catch((err: unknown) =>
      setStatus(`Failed to load pages: ${errMsg(err)}`),
    );
  }, [workspaceId, refreshPages]);

  const openPage = useCallback(async (id: string) => {
    await pendingFlushRef.current?.().catch(() => undefined);
    setPageId(id);
    setTree(null);
    setStatus("");
    try {
      setTree(await getPageBlocks(id));
    } catch (err: unknown) {
      setStatus(`Failed to load blocks: ${errMsg(err)}`);
    }
  }, []);

  const handlePagesChanged = useCallback(() => {
    if (workspaceId === null) return;
    refreshPages(workspaceId).catch((err: unknown) =>
      setStatus(`Failed to reload pages: ${errMsg(err)}`),
    );
  }, [workspaceId, refreshPages]);

  const handleNavigate = useCallback(
    (id: string) => {
      void openPage(id);
    },
    [openPage],
  );

  async function handleCreate() {
    if (workspaceId === null || newTitle.trim() === "") return;
    try {
      const page = await createPage({ workspace_id: workspaceId, title: newTitle.trim() });
      setNewTitle("");
      await refreshPages(workspaceId);
      await openPage(page.id);
    } catch (err: unknown) {
      setStatus(`Create failed: ${errMsg(err)}`);
    }
  }

  async function handleDelete() {
    if (pageId === null || workspaceId === null) return;
    try {
      await deletePage(pageId);
      setPageId(null);
      setTree(null);
      await refreshPages(workspaceId);
    } catch (err: unknown) {
      setStatus(`Delete failed: ${errMsg(err)}`);
    }
  }

  async function handleRename(id: string, title: string) {
    if (workspaceId === null) return;
    try {
      await updatePage(id, { title });
      await refreshPages(workspaceId);
    } catch (err: unknown) {
      setStatus(`Rename failed: ${errMsg(err)}`);
    }
  }

  const selected = pages.find((p) => p.id === pageId) ?? null;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      <aside
        style={{ width: 280, borderRight: "1px solid #ddd", padding: 12, overflowY: "auto" }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Genesis</h2>
        <label style={{ display: "block", fontSize: 12, color: "#666" }}>
          Workspace
          <select
            value={workspaceId ?? ""}
            onChange={(e) => {
              setWorkspaceId(e.target.value === "" ? null : e.target.value);
              setPageId(null);
              setTree(null);
            }}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </label>
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Pages</h3>
        <PageTree pages={pages} selectedId={pageId} onSelect={(id) => void openPage(id)} />
        <div style={{ marginTop: 12, display: "flex", gap: 4 }}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New page title"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" onClick={() => void handleCreate()}>
            +
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 16, overflowY: "auto" }}>
        {status !== "" && (
          <p style={{ color: "#a00", fontSize: 13 }} role="alert">
            {status}
          </p>
        )}
        {selected === null ? (
          <p style={{ color: "#666" }}>Select a page to edit.</p>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <PageTitleInput
                key={selected.id}
                pageId={selected.id}
                title={selected.title}
                onRename={(title) => void handleRename(selected.id, title)}
              />
              <span style={{ color: "#999", fontSize: 12 }}>{selected.kind}</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => void handleDelete()}>
                Delete page
              </button>
            </div>
            {tree === null || workspaceId === null ? (
              <p style={{ color: "#666" }}>Loading blocks…</p>
            ) : (
              <PageEditor
                key={selected.id}
                pageId={selected.id}
                workspaceId={workspaceId}
                initialTree={tree}
                pages={pages}
                onNavigate={handleNavigate}
                onPagesChanged={handlePagesChanged}
                flushRef={pendingFlushRef}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function PageTitleInput({
  pageId,
  title,
  onRename,
}: {
  pageId: string;
  title: string;
  onRename: (title: string) => void;
}) {
  const [value, setValue] = useState(title);

  function commit() {
    const trimmed = value.trim();
    if (trimmed !== "" && trimmed !== title) onRename(trimmed);
    else setValue(title);
  }

  return (
    <input
      aria-label="Page title"
      data-testid="page-title-input"
      data-page-id={pageId}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setValue(title);
      }}
      style={{
        fontSize: 22,
        fontWeight: 700,
        margin: 0,
        padding: "2px 4px",
        border: "1px solid transparent",
        borderRadius: 4,
        minWidth: 0,
        flex: 1,
      }}
    />
  );
}
