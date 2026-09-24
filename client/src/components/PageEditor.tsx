import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { genesisExtensions } from "./extensions";
import { SubPageContext } from "./SubPage";
import { BlockGutter } from "./BlockGutter";
import { FormatToolbar } from "./FormatToolbar";
import { FocusChrome } from "./FocusChrome";
import { FocusScope, getFocusScope } from "./FocusScope";
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
import { countTopLevelBlocks, rangeFromBlockIds, topLevelBlockIds } from "./focusRange";
import type { FocusRange } from "./focusUrl";
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
  focus: FocusRange | null;
  onEnterFocus: (range: FocusRange) => void;
  onExitFocus: () => void;
  onFocusRangeChanged: (range: FocusRange) => void;
}

export function PageEditor({
  pageId,
  workspaceId,
  initialTree,
  pages,
  onNavigate,
  onPagesChanged,
  flushRef,
  focus,
  onEnterFocus,
  onExitFocus,
  onFocusRangeChanged,
}: PageEditorProps) {
  const [saveState, setSaveState] = useState<EditorSaveState>("idle");
  const [saveError, setSaveError] = useState<string>("");
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const editorRef = useRef<Editor | null>(null);
  const readyRef = useRef(false);
  const savingRef = useRef(false);
  const pageIdRef = useRef(pageId);
  const pageBlockIdRef = useRef<string | undefined>(initialTree.data?.blockId);
  const persistRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const saverRef = useRef<DebouncedSaver | null>(null);
  const scopeActiveRef = useRef(false);
  const scopeEditorRef = useRef<Editor | null>(null);
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
    () => [
      ...genesisExtensions({
        workspaceId,
        parentPageId: pageId,
        onPagesChanged,
        onError: (message) => {
          setSaveError(`Sub-page failed: ${message}`);
          setSaveState("error");
        },
      }),
      FocusScope,
    ],
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

  // Apply (or clear) the focused-passage scope on the live editor. The editor
  // instance is never remounted for focus, so undo history stays shared with
  // the whole document.
  useEffect(() => {
    if (editor === null) return;
    if (scopeEditorRef.current !== editor) {
      scopeEditorRef.current = editor;
      scopeActiveRef.current = false;
    }
    if (focus === null) {
      if (getFocusScope(editor.state) !== null) editor.commands.clearFocusScope();
      scopeActiveRef.current = false;
      setFocusLabel(null);
      return;
    }
    const range = rangeFromBlockIds(editor.state.doc, focus.from, focus.to);
    if (range === null) {
      onExitFocus();
      return;
    }
    editor.commands.setFocusScope(range.from, range.to);
    if (!scopeActiveRef.current) {
      const near = Selection.near(editor.state.doc.resolve(range.from), 1);
      editor.view.dispatch(editor.state.tr.setSelection(near).scrollIntoView());
      editor.commands.focus();
      scopeActiveRef.current = true;
    }
    const count = countTopLevelBlocks(editor.state.doc, range);
    setFocusLabel(`Focused passage · ${count} ${count === 1 ? "block" : "blocks"}`);
  }, [editor, focus, onExitFocus]);

  // Keep the URL's block-id anchors in step with a scope that grew or shrank
  // from editing at its edges (App applies this with replaceState).
  useEffect(() => {
    if (editor === null || focus === null) return undefined;
    const target = focus;
    function syncRange(): void {
      if (editor === null) return;
      const range = getFocusScope(editor.state);
      if (range === null) {
        onExitFocus();
        return;
      }
      const { fromId, toId } = topLevelBlockIds(editor.state.doc, range.from, range.to);
      if (fromId === null || toId === null) return;
      if (fromId !== target.from || toId !== target.to) {
        onFocusRangeChanged({ from: fromId, to: toId });
      }
    }
    editor.on("transaction", syncRange);
    return () => {
      editor.off("transaction", syncRange);
    };
  }, [editor, focus, onExitFocus, onFocusRangeChanged]);

  useEffect(() => {
    if (focus === null) return undefined;
    const wrap = wrapRef.current;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (wrap !== null && !wrap.contains(event.target as Node)) return;
      event.preventDefault();
      onExitFocus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus, onExitFocus]);

  function handleFocusPassage(): void {
    const current = editorRef.current;
    if (current === null || current.isDestroyed) return;
    const { from, to } = current.state.selection;
    if (from === to) return;
    const { fromId, toId } = topLevelBlockIds(current.state.doc, from, to);
    if (fromId === null || toId === null) return;
    onEnterFocus({ from: fromId, to: toId });
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
      <div className="editor-wrap" ref={wrapRef}>
        <div className="editor-box">
          {focusLabel !== null && <FocusChrome label={focusLabel} onExit={onExitFocus} />}
          <EditorContent editor={editor} />
          <BlockGutter editor={editor} wrapRef={wrapRef} />
          <FormatToolbar
            editor={editor}
            onFocusPassage={focus === null ? handleFocusPassage : undefined}
          />
        </div>
        <EditorSaveStatus state={saveState} message={saveError} />
      </div>
    </SubPageContext.Provider>
  );
}
