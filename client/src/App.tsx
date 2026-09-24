import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPage,
  deletePage,
  getPage,
  getPageBlocks,
  listPages,
  listWorkspaces,
  updatePage,
  type Page,
  type Workspace,
} from "./api";
import type { DeltaTree } from "./mapper";
import { AppSidebar } from "./components/AppSidebar";
import { DocumentHeader } from "./components/DocumentHeader";
import { ExportMenu } from "./components/ExportMenu";
import { HistoryPanel } from "./components/HistoryPanel";
import { PageEditor } from "./components/PageEditor";
import { SearchPalette } from "./components/SearchPalette";
import { docUrl, focusUrl, parseAppUrl, type FocusRange } from "./components/focusUrl";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editorRev, setEditorRev] = useState(0);
  const [focus, setFocus] = useState<FocusRange | null>(null);
  const pendingFlushRef = useRef<(() => Promise<void>) | null>(null);
  const pageIdRef = useRef<string | null>(null);

  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  const pushUrl = useCallback((url: string) => {
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== url) window.history.pushState(null, "", url);
  }, []);

  const replaceUrl = useCallback((url: string) => {
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== url) window.history.replaceState(null, "", url);
  }, []);

  const refreshPages = useCallback(async (wsId: string) => {
    setPages(await listPages(wsId));
  }, []);

  useEffect(() => {
    listWorkspaces()
      .then((ws) => {
        setWorkspaces(ws);
        const hasUrlPage =
          parseAppUrl(window.location.pathname, window.location.search).pageId !== null;
        if (!hasUrlPage && ws.length > 0 && ws[0] !== undefined) setWorkspaceId(ws[0].id);
      })
      .catch((err: unknown) => setStatus(`Failed to load workspaces: ${errMsg(err)}`));
  }, []);

  useEffect(() => {
    if (workspaceId === null) return;
    refreshPages(workspaceId).catch((err: unknown) =>
      setStatus(`Failed to load pages: ${errMsg(err)}`),
    );
  }, [workspaceId, refreshPages]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      setWorkspaceId(id);
      setPageId(null);
      setTree(null);
      setStatus("");
      setHistoryOpen(false);
      setFocus(null);
      pushUrl("/");
    },
    [pushUrl],
  );

  const refreshWorkspaces = useCallback(async (selectId?: string) => {
    const ws = await listWorkspaces();
    setWorkspaces(ws);
    if (selectId !== undefined) {
      setWorkspaceId(selectId);
      setPageId(null);
      setTree(null);
      setStatus("");
      setFocus(null);
      pushUrl("/");
    } else if (ws.length > 0 && ws[0] !== undefined) {
      setWorkspaceId((current) =>
        current !== null && ws.some((w) => w.id === current) ? current : ws[0].id,
      );
    }
  }, [pushUrl]);

  const handleShowAllDocs = useCallback(() => {
    setPageId(null);
    setTree(null);
    setStatus("");
    setHistoryOpen(false);
    setFocus(null);
    pushUrl("/");
  }, [pushUrl]);

  const openPage = useCallback(async (id: string) => {
    await pendingFlushRef.current?.().catch(() => undefined);
    setPageId(id);
    setTree(null);
    setStatus("");
    setHistoryOpen(false);
    try {
      setTree(await getPageBlocks(id));
    } catch (err: unknown) {
      setStatus(`Failed to load blocks: ${errMsg(err)}`);
    }
  }, []);

  useEffect(() => {
    const target = parseAppUrl(window.location.pathname, window.location.search);
    if (target.pageId === null) return;
    void (async () => {
      try {
        const page = await getPage(target.pageId as string);
        setWorkspaceId(page.workspace_id);
        await openPage(page.id);
        setFocus(target.focus);
      } catch (err: unknown) {
        setStatus(`Failed to open page: ${errMsg(err)}`);
      }
    })();
  }, [openPage]);

  useEffect(() => {
    function onPopState(): void {
      const target = parseAppUrl(window.location.pathname, window.location.search);
      if (target.pageId === null) {
        setPageId(null);
        setTree(null);
        setFocus(null);
        setHistoryOpen(false);
        return;
      }
      void (async () => {
        if (target.pageId !== pageIdRef.current) {
          await openPage(target.pageId as string);
        }
        setFocus(target.focus);
      })();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openPage]);

  const handlePagesChanged = useCallback(() => {
    if (workspaceId === null) return;
    refreshPages(workspaceId).catch((err: unknown) =>
      setStatus(`Failed to reload pages: ${errMsg(err)}`),
    );
  }, [workspaceId, refreshPages]);

  const handleNavigate = useCallback(
    (id: string) => {
      setFocus(null);
      pushUrl(docUrl(id));
      void openPage(id);
    },
    [openPage, pushUrl],
  );

  const handleEnterFocus = useCallback(
    (range: FocusRange) => {
      if (pageId === null) return;
      setFocus(range);
      pushUrl(focusUrl(pageId, range));
    },
    [pageId, pushUrl],
  );

  const handleExitFocus = useCallback(() => {
    setFocus(null);
    if (pageId !== null) pushUrl(docUrl(pageId));
  }, [pageId, pushUrl]);

  const handleFocusRangeChanged = useCallback(
    (range: FocusRange) => {
      setFocus(range);
      if (pageId !== null) replaceUrl(focusUrl(pageId, range));
    },
    [pageId, replaceUrl],
  );

  async function handleCreate(parentId?: string) {
    if (workspaceId === null) return;
    try {
      const page = await createPage({
        workspace_id: workspaceId,
        parent_page_id: parentId ?? null,
        title: "Untitled",
      });
      await refreshPages(workspaceId);
      handleNavigate(page.id);
    } catch (err: unknown) {
      setStatus(`Create failed: ${errMsg(err)}`);
    }
  }

  async function handleDelete(id: string) {
    if (workspaceId === null) return;
    try {
      await deletePage(id);
      if (id === pageId) {
        setPageId(null);
        setTree(null);
        setFocus(null);
        pushUrl("/");
      }
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
  const showVersionTools =
    selected !== null && (selected.kind === "story" || selected.kind === "chapter");

  const handleRestored = useCallback(() => {
    if (pageId === null) return;
    const id = pageId;
    setTree(null);
    setStatus("");
    getPageBlocks(id)
      .then((blocks) => {
        setTree(blocks);
        setEditorRev((rev) => rev + 1);
      })
      .catch((err: unknown) => setStatus(`Failed to reload blocks: ${errMsg(err)}`));
  }, [pageId]);

  return (
    <div className="app-root">
      <AppSidebar
        workspaces={workspaces}
        workspaceId={workspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onWorkspacesChanged={(selectId) =>
          refreshWorkspaces(selectId).catch((err: unknown) =>
            setStatus(`Failed to reload workspaces: ${errMsg(err)}`),
          )
        }
        pages={pages}
        selectedId={pageId}
        onSelectPage={handleNavigate}
        onShowAllDocs={handleShowAllDocs}
        onCreatePage={() => void handleCreate()}
        onCreateChild={(parentId) => void handleCreate(parentId)}
        onRenamePage={(id, title) => void handleRename(id, title)}
        onDeletePage={(id) => void handleDelete(id)}
        onOpenSearch={() => setSearchOpen(true)}
      />

      <main className="app-main">
        <DocumentHeader
          page={selected}
          pages={pages}
          onNavigate={handleNavigate}
          onRename={(title) => {
            if (selected !== null) void handleRename(selected.id, title);
          }}
          onDelete={() => {
            if (selected !== null) void handleDelete(selected.id);
          }}
          showVersionTools={showVersionTools}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
          exportMenu={
            selected !== null && showVersionTools ? (
              <ExportMenu key={selected.id} pageId={selected.id} />
            ) : undefined
          }
        />

        <div className="doc-body">
        <div className="doc-scroll">
          <div className="doc-column">
            {status !== "" && (
              <p className="app-status" role="alert">
                {status}
              </p>
            )}
            {selected === null ? (
              <p className="app-hint">Select a page to edit, or create one with +.</p>
            ) : tree === null || workspaceId === null ? (
              <p className="app-hint">Loading blocks…</p>
            ) : (
              <PageEditor
                key={`${selected.id}:${editorRev}`}
                pageId={selected.id}
                workspaceId={workspaceId}
                initialTree={tree}
                pages={pages}
                onNavigate={handleNavigate}
                onPagesChanged={handlePagesChanged}
                flushRef={pendingFlushRef}
                focus={focus}
                onEnterFocus={handleEnterFocus}
                onExitFocus={handleExitFocus}
                onFocusRangeChanged={handleFocusRangeChanged}
              />
            )}
          </div>
        </div>
        {historyOpen && selected !== null && showVersionTools && (
          <HistoryPanel
            key={selected.id}
            pageId={selected.id}
            onRestored={handleRestored}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        </div>
      </main>

      <SearchPalette
        open={searchOpen}
        pages={pages}
        onClose={() => setSearchOpen(false)}
        onSelect={handleNavigate}
      />
    </div>
  );
}
