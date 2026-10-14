import { useEffect } from "react";

export interface ToastData {
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}

/** Small non-intrusive toast with ~5s Undo opportunity (§11.2). */
export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button type="button" onClick={() => { toast.onUndo?.(); onDismiss(); }}>
          {toast.undoLabel ?? "Undo"}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">✕</button>
    </div>
  );
}
