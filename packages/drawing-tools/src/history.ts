import type { Drawing } from './types.js';

/** One drawing's state before and after a change (null = did not exist). */
export interface DrawingChange {
  readonly id: string;
  readonly before: Drawing | null;
  readonly after: Drawing | null;
}

/** Undo/redo stack of change sets. Drawings are immutable, so entries just keep object references. */
export class DrawingHistory {
  private undoStack: DrawingChange[][] = [];
  private redoStack: DrawingChange[][] = [];

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(changes: readonly DrawingChange[]): void {
    const effective = changes.filter((c) => c.before !== c.after);
    if (!effective.length) return;
    this.undoStack.push([...effective]);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the changes to apply to undo the last entry (already inverted). */
  undo(): DrawingChange[] | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry.map((c) => ({ id: c.id, before: c.after, after: c.before })).reverse();
  }

  redo(): DrawingChange[] | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
