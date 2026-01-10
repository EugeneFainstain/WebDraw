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
    // NOTE: Don't restore debugMessages - we want to keep seeing debug output after undo
    // appState.debugMessages = cloned.debugMessages;
}

/**
 * Push current state to undo stack (call AFTER making changes).
 * Each snapshot represents a completed, coherent state.
 * Only pushes if the current state differs from the top of the stack.
 */
export function pushUndoSnapshot(): void {
    // Don't push duplicate snapshots
    if (undoStack.length > 0 && !statesDiffer(undoStack[undoStack.length - 1])) {
        return;
    }
    undoStack.push(captureSnapshot());
}

/**
 * Convert a snapshot to a comparable string (for state comparison).
 * Excludes debugMessages since those change during comparison and shouldn't affect undo.
 */
function snapshotToString(snapshot: AppState): string {
    // Create a serializable version (Set needs to be converted to Array for JSON)
    // Exclude debugMessages - they change during comparison and shouldn't affect undo logic
    const { debugMessages, ...rest } = snapshot;
    const serializable = {
        ...rest,
        highlightedStrokes: Array.from(snapshot.highlightedStrokes),
    };
    return JSON.stringify(serializable);
}

/**
 * Check if current app state differs from a snapshot.
 */
function statesDiffer(snapshot: AppState): boolean {
    const current = captureSnapshot();
    const currentStr = snapshotToString(current);
    const snapshotStr = snapshotToString(snapshot);
    return currentStr !== snapshotStr;
}

/**
 * Undo: restore a previous state.
 * Returns true if undo was performed, false if no previous state exists.
 *
 * Logic:
 * - If current state differs from top of stack → restore top (don't pop)
 *   This handles cases where state changed without a snapshot (cursor moved, etc.)
 * - If current state matches top of stack → pop and restore the one below
 *   This is the normal case right after an operation completed with a snapshot
 */
export function performUndo(): boolean {
    if (undoStack.length < 1) {
        return false;
    }

    const topSnapshot = undoStack[undoStack.length - 1];

    if (statesDiffer(topSnapshot)) {
        // Current state differs from top - restore top without popping
        restoreSnapshot(topSnapshot);
        return true;
    }

    // Current state matches top - need to go back one more
    if (undoStack.length < 2) {
        // Only one state on stack and we're already there
        return false;
    }

    // Pop current state and restore the previous one
    undoStack.pop();
    restoreSnapshot(undoStack[undoStack.length - 1]);
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
 * Check if undo is possible.
 * Undo is possible if:
 * - Current state differs from top of stack (can restore to top), OR
 * - There are at least 2 states on stack (can go back one)
 */
export function canUndo(): boolean {
    if (undoStack.length < 1) {
        return false;
    }
    if (undoStack.length >= 2) {
        return true;
    }
    // Only 1 state - can undo only if current state differs from it
    return statesDiffer(undoStack[0]);
}

// ============================================================================
// INITIALIZATION - Wire up to state.ts
// ============================================================================

// Register the clearUndoStack function with state.ts
// This allows resetState() to clear the undo stack without circular imports
setClearUndoStackFn(clearUndoStack);
