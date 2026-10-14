import type { Category, Timetable } from "./types";

/**
 * Undo/redo engine — spec §11. Snapshot-based, latest 20 operations.
 * Snapshots cover all timetables + categories so import, category edits
 * and timetable add/rename/delete are recoverable. Week records and the
 * running timer are deliberately excluded (they are records, not edits).
 */
export interface Snapshot {
  timetables: Timetable[];
  categories: Category[];
}

export interface HistoryEntry {
  label: string;
  snapshot: Snapshot;
  at: string;
}

function cloneSnapshot(s: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(s)) as Snapshot;
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
  checkpoint(label: string, current: Snapshot): void {
    this.undo.push({ label, snapshot: cloneSnapshot(current), at: new Date().toISOString() });
    if (this.undo.length > this.limit) this.undo.shift();
    this.redoStack = [];
  }

  performUndo(current: Snapshot): { label: string; snapshot: Snapshot } | null {
    const entry = this.undo.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, snapshot: cloneSnapshot(current), at: new Date().toISOString() });
    return entry;
  }

  performRedo(current: Snapshot): { label: string; snapshot: Snapshot } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undo.push({ label: entry.label, snapshot: cloneSnapshot(current), at: new Date().toISOString() });
    if (this.undo.length > this.limit) this.undo.shift();
    return entry;
  }

  clear(): void {
    this.undo = [];
    this.redoStack = [];
  }
}
