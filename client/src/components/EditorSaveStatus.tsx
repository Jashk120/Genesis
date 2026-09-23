import { useEffect, useState } from "react";

export type EditorSaveState = "idle" | "saving" | "saved" | "error";

interface EditorSaveStatusProps {
  state: EditorSaveState;
  message?: string;
}

const SAVED_VISIBLE_MS = 1500;

export function EditorSaveStatus({ state, message }: EditorSaveStatusProps) {
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (state !== "saved") {
      setSavedVisible(false);
      return undefined;
    }
    setSavedVisible(true);
    const timer = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === "idle" || (state === "saved" && !savedVisible)) return null;

  if (state === "error") {
    return (
      <div className="editor-save-status" data-state="error" role="alert">
        {message ?? "Save failed"}
      </div>
    );
  }

  return (
    <div className="editor-save-status" data-state={state} role="status">
      {state === "saving" ? "Saving…" : "Saved."}
    </div>
  );
}
