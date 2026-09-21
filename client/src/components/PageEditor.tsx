import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { genesisExtensions } from "./extensions";
import { SubPageContext } from "./SubPage";
import { BlockGutter } from "./BlockGutter";
import { FormatToolbar } from "./FormatToolbar";
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
  const wrapRef = useRef<HTMLDivElement>(null);

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
      <div className="editor-wrap" ref={wrapRef}>
        <div className="editor-box">
          <EditorContent editor={editor} />
          <BlockGutter editor={editor} wrapRef={wrapRef} />
          <FormatToolbar editor={editor} />
        </div>
        {status !== "" && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#6f6f6f" }}>{status}</div>
        )}
      </div>
    </SubPageContext.Provider>
  );
}
