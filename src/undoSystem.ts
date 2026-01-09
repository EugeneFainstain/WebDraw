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
 * - Snapshots captured BEFORE operations, restored on undo
 *
 * Usage:
 * - Call pushUndoSnapshot() BEFORE any significant state change
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
    appState.lastPrimaryPos = cloned.lastPrimaryPos;
    appState.lastSecondaryPos = cloned.lastSecondaryPos;
    appState.lastDelta = cloned.lastDelta;
    appState.batchedDelta = cloned.batchedDelta;

    // Handle Map - clear and repopulate
    appState.pointersOnUI.clear();
    for (const [key, value] of cloned.pointersOnUI) {
        appState.pointersOnUI.set(key, value);
    }

    appState.debugMessages = cloned.debugMessages;
}

/**
 * Push current state to undo stack (call BEFORE making changes).
 */
export function pushUndoSnapshot(): void {
    undoStack.push(captureSnapshot());
}

/**
 * Pop and restore previous state (the actual undo operation).
 * Returns true if undo was performed, false if stack was empty.
 */
export function performUndo(): boolean {
    if (undoStack.length === 0) {
        return false;
    }

    const previousState = undoStack.pop()!;
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

// ============================================================================
// INITIALIZATION - Wire up to state.ts
// ============================================================================

// Register the clearUndoStack function with state.ts
// This allows resetState() to clear the undo stack without circular imports
setClearUndoStackFn(clearUndoStack);
