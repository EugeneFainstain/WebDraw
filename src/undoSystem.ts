/**
 * UNDO SYSTEM - Complete State Snapshot Management
 *
 * This module implements a "time machine" undo system that captures complete
 * state snapshots at operation boundaries. Each snapshot contains EVERYTHING -
 * strokes, view transform, cursor position, selection state, etc.
 *
 * Design:
 * - Uses structuredClone() for deep copying (native, handles nested structures)
 * - Undo stack lives outside AppState (only thing not snapshotted)
 * - Snapshots captured AFTER operations complete (each snapshot = completed coherent state)
 * - Undo pops current state and restores the previous one
 *
 * Usage:
 * - Call pushUndoSnapshot() AFTER any significant state change completes
 * - Call performUndo() to restore previous state
 * - Call clearUndoStack() on Clear All (page reload behavior)
 */

import { appState, AppState, setClearUndoStackFn } from './state';

// ============================================================================
// UNDO STACK - Lives outside AppState
// ============================================================================

let undoStack: AppState[] = [];

// ============================================================================
// SNAPSHOT FUNCTIONS
// ============================================================================

/**
 * Capture a complete snapshot of the current app state.
 * Uses structuredClone() for deep copying - handles nested objects, arrays, Sets, Maps.
 */
export function captureSnapshot(): AppState {
    return structuredClone(appState);
}

/**
 * Restore app state from a snapshot.
 * Replaces all appState properties with values from the snapshot.
 */
export function restoreSnapshot(snapshot: AppState): void {
    // Deep clone the snapshot to avoid reference issues
    const cloned = structuredClone(snapshot);

    // Restore all properties
    appState.strokeHistory = cloned.strokeHistory;
    appState.currentStroke = cloned.currentStroke;
    appState.cursorPos = cloned.cursorPos;
    appState.selectedStrokeIdx = cloned.selectedStrokeIdx;
    appState.selectedStrokePointIdx = cloned.selectedStrokePointIdx;
    appState.selectedStrokeCursorPos = cloned.selectedStrokeCursorPos;
    appState.cursorReadyToContinueStroke = cloned.cursorReadyToContinueStroke;
    appState.dragStartCursorPos = cloned.dragStartCursorPos;
    appState.transformSnapshot = cloned.transformSnapshot;
    appState.hasUndoableTransform = cloned.hasUndoableTransform;
    appState.lastGridPosition = cloned.lastGridPosition;
    appState.isGridMode = cloned.isGridMode;
    appState.selectionRectStart = cloned.selectionRectStart;
    appState.selectionRectEnd = cloned.selectionRectEnd;

    // Handle Set - clear and repopulate
    appState.highlightedStrokes.clear();
    for (const idx of cloned.highlightedStrokes) {
        appState.highlightedStrokes.add(idx);
    }

    appState.viewTransform = cloned.viewTransform;
    appState.transformStart = cloned.transformStart;

    // NOTE: We intentionally do NOT restore these transient pointer-tracking values:
    // - lastPrimaryPos, lastSecondaryPos, lastDelta, batchedDelta
    // - pointersOnUI
    // These are input-tracking state that gets set when fingers touch the screen.
    // Restoring them would cause cursor jumps on the next finger movement.

    appState.debugMessages = cloned.debugMessages;
}

/**
 * Push current state to undo stack (call AFTER making changes).
 * Each snapshot represents a completed, coherent state.
 */
export function pushUndoSnapshot(): void {
    undoStack.push(captureSnapshot());
}

/**
 * Undo: discard current state and restore the previous one.
 * Returns true if undo was performed, false if no previous state exists.
 *
 * With the "snapshot AFTER" approach:
 * - Stack contains completed states [S0, S1, S2, ...]
 * - Current state is always the top of the stack
 * - Undo pops the current state (discards it) and restores the one below
 * - Need at least 2 entries: one to discard, one to restore
 */
export function performUndo(): boolean {
    if (undoStack.length < 2) {
        // Need at least 2 states: current to discard, previous to restore
        return false;
    }

    // Pop and discard current state
    undoStack.pop();

    // Restore the previous state (but keep it on the stack - it's now "current")
    const previousState = undoStack[undoStack.length - 1];
    restoreSnapshot(previousState);
    return true;
}

/**
 * Clear the undo stack (for Clear All / page reload behavior).
 */
export function clearUndoStack(): void {
    undoStack = [];
}

/**
 * Get the current undo stack size (for debugging/UI).
 */
export function getUndoStackSize(): number {
    return undoStack.length;
}

/**
 * Check if undo is possible (need at least 2 states on stack).
 */
export function canUndo(): boolean {
    return undoStack.length >= 2;
}

// ============================================================================
// INITIALIZATION - Wire up to state.ts
// ============================================================================

// Register the clearUndoStack function with state.ts
// This allows resetState() to clear the undo stack without circular imports
setClearUndoStackFn(clearUndoStack);
