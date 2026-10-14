import type { Activity } from "./types";

/**
 * Undo/redo engine — spec §11. Snapshot-based, latest 20 operations.
 * Each logical operation (create/edit/move/resize/swap/delete/switch)
 * pushes one entry; import replacement uses its own restore point (V1).
 */
export interface HistoryEntry {
  label: string;
  activities: Activity[];
  at: string;
}

function cloneActivities(a: Activity[]): Activity[] {
  return a.map((x) => ({ ...x, reminderPreferences: x.reminderPreferences ? { ...x.reminderPreferences } : undefined }));
}

export class UndoStack {
  private undo: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  readonly limit = 20;

  get canUndo(): boolean {
    return this.undo.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undo.length ? this.undo[this.undo.length - 1].label : null;
  }

  /** Record state BEFORE a change. Call prior to committing. */
  checkpoint(label: string, current: Activity[]): void {
    this.undo.push({ label, activities: cloneActivities(current), at: new Date().toISOString() });
    if (this.undo.length > this.limit) this.undo.shift();
    this.redoStack = [];
  }

  performUndo(current: Activity[]): { label: string; activities: Activity[] } | null {
    const entry = this.undo.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, activities: cloneActivities(current), at: new Date().toISOString() });
    return entry;
  }

  performRedo(current: Activity[]): { label: string; activities: Activity[] } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undo.push({ label: entry.label, activities: cloneActivities(current), at: new Date().toISOString() });
    if (this.undo.length > this.limit) this.undo.shift();
    return entry;
  }

  clear(): void {
    this.undo = [];
    this.redoStack = [];
  }
}
