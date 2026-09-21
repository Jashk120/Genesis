import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { genesisExtensions } from "./extensions";
import { SubPageContext } from "./SubPage";
import { DebouncedSaver } from "./autosave";
import {
  deltaTreeToProseMirror,
  ensureBlockIds,
  proseMirrorToDeltaTree,
  type DeltaTree,
  type PMDoc,
} from "../mapper";
import { putPageBlocks } from "../api";
import type { Page } from "../api";

const AUTOSAVE_DELAY_MS = 700;

interface PageEditorProps {
  pageId: string;
  workspaceId: string;
  initialTree: DeltaTree;
  pages: Page[];
  onNavigate: (pageId: string) => void;
  onPagesChanged: () => void;
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
}

export function PageEditor({
  pageId,
  workspaceId,
  initialTree,
  pages,
  onNavigate,
  onPagesChanged,
  flushRef,
}: PageEditorProps) {
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const readyRef = useRef(false);
  const savingRef = useRef(false);
  const pageIdRef = useRef(pageId);
  const pageBlockIdRef = useRef<string | undefined>(initialTree.data?.blockId);
  const persistRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const saverRef = useRef<DebouncedSaver | null>(null);
  if (saverRef.current === null) {
    saverRef.current = new DebouncedSaver(AUTOSAVE_DELAY_MS, () => persistRef.current());
  }

  // Keep the root blockId outside the editor (doc nodes have no attrs).
  // Recomputed only when the open page changes.
  const pageBlockId = useMemo(
    () => initialTree.data?.blockId,
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by page
    [pageId],
  );
  const initialDoc = useMemo(
    () => deltaTreeToProseMirror(initialTree),
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by page
    [pageId],
  );

  const extensions = useMemo(
    () =>
      genesisExtensions({
        workspaceId,
        parentPageId: pageId,
        onPagesChanged,
        onError: (message) => setStatus(`Sub-page failed: ${message}`),
      }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by page
    [pageId, workspaceId],
  );

  const editor = useEditor(
    {
      extensions,
      content: initialDoc,
      onCreate: () => {
        readyRef.current = true;
      },
      onUpdate: () => {
        if (readyRef.current && editorRef.current !== null) {
          saverRef.current?.schedule();
        }
      },
    },
    [pageId],
  );

  async function runPersist(): Promise<void> {
    const current = editorRef.current;
    if (current === null || current.isDestroyed) return;
    if (savingRef.current) {
      saverRef.current?.schedule();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setStatus("Saving…");
    try {
      const json = current.getJSON() as PMDoc;
      const tree = ensureBlockIds(proseMirrorToDeltaTree(json));
      const withRoot: DeltaTree = {
        ...tree,
        data: { ...tree.data, blockId: pageBlockIdRef.current ?? tree.data?.blockId },
      };
      await putPageBlocks(pageIdRef.current, withRoot);
      setStatus("Saved.");
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    pageIdRef.current = pageId;
    pageBlockIdRef.current = pageBlockId;
    persistRef.current = runPersist;
    if (flushRef !== undefined) {
      flushRef.current = () => saverRef.current?.flush() ?? Promise.resolve();
    }
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor === null) return;
    return () => {
      void saverRef.current?.flush().catch(() => undefined);
    };
  }, [editor]);

  async function handleSave() {
    if (editor === null || savingRef.current) return;
    saverRef.current?.cancel();
    await persistRef.current();
  }

  const navigateSoon = useCallback(
    (id: string) => {
      void (async () => {
        await saverRef.current?.flush().catch(() => undefined);
        onNavigate(id);
      })();
    },
    [onNavigate],
  );

  return (
    <SubPageContext.Provider value={{ pages, onNavigate: navigateSoon }}>
      <div>
        <Toolbar
          onAction={(fn) => {
            if (editor) fn(editor);
          }}
          editorExists={editor !== null}
        />
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 4,
            padding: "8px 12px",
            minHeight: 240,
            marginTop: 8,
          }}
        >
          <EditorContent editor={editor} />
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={handleSave} disabled={!editor || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {status !== "" && <span style={{ fontSize: 13 }}>{status}</span>}
        </div>
      </div>
    </SubPageContext.Provider>
  );
}

function Toolbar({
  onAction,
  editorExists,
}: {
  onAction: (fn: (editor: Editor) => void) => void;
  editorExists: boolean;
}) {
  const btn = (label: string, fn: (editor: Editor) => void) => (
    <button
      key={label}
      type="button"
      disabled={!editorExists}
      onClick={() => onAction(fn)}
      style={{ marginRight: 4 }}
    >
      {label}
    </button>
  );
  return (
    <div>
      {btn("B", (e) => void e.chain().focus().toggleBold().run())}
      {btn("I", (e) => void e.chain().focus().toggleItalic().run())}
      {btn("<>", (e) => void e.chain().focus().toggleCode().run())}
      {btn("H1", (e) => void e.chain().focus().toggleHeading({ level: 1 }).run())}
      {btn("H2", (e) => void e.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn("• list", (e) => void e.chain().focus().toggleBulletList().run())}
      {btn("1. list", (e) => void e.chain().focus().toggleOrderedList().run())}
      {btn("Quote", (e) => void e.chain().focus().toggleBlockquote().run())}
      {btn("Code", (e) => void e.chain().focus().toggleCodeBlock().run())}
    </div>
  );
}
