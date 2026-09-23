import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { genesisExtensions } from "./extensions";
import { SubPageContext } from "./SubPage";
import { BlockGutter } from "./BlockGutter";
import { FormatToolbar } from "./FormatToolbar";
import { DebouncedSaver } from "./autosave";
import { EditorSaveStatus, type EditorSaveState } from "./EditorSaveStatus";
import {
  assignMissingBlockIds,
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
  const [saveState, setSaveState] = useState<EditorSaveState>("idle");
  const [saveError, setSaveError] = useState<string>("");
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

  // Root blockId fallback, recomputed only when the open page changes. The
  // live doc now carries attrs.blockId itself (BlockId extension); runPersist
  // prefers the ref and refreshes it from each successful save.
  const pageBlockId = useMemo(
    () => initialTree.data?.blockId,
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by page
    [pageId],
  );
  const initialDoc = useMemo(
    () => assignMissingBlockIds(deltaTreeToProseMirror(initialTree)).doc,
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by page
    [pageId],
  );

  const extensions = useMemo(
    () =>
      genesisExtensions({
        workspaceId,
        parentPageId: pageId,
        onPagesChanged,
        onError: (message) => {
          setSaveError(`Sub-page failed: ${message}`);
          setSaveState("error");
        },
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
    setSaveState("saving");
    try {
      const json = current.getJSON() as PMDoc;
      const tree = ensureBlockIds(proseMirrorToDeltaTree(json));
      const withRoot: DeltaTree = {
        ...tree,
        data: { ...tree.data, blockId: pageBlockIdRef.current ?? tree.data?.blockId },
      };
      await putPageBlocks(pageIdRef.current, withRoot);
      // The root id is assigned once (plugin + initial doc fill) and the
      // server preserves it; remember it so the next save sends the same id
      // instead of minting a fresh one.
      pageBlockIdRef.current = withRoot.data?.blockId;
      setSaveState("saved");
    } catch (err) {
      setSaveError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      setSaveState("error");
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
        <EditorSaveStatus state={saveState} message={saveError} />
      </div>
    </SubPageContext.Provider>
  );
}
