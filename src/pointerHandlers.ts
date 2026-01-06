/**
 * POINTERHANDLERS.TS - Pointer/Touch Event Processing
 *
 * This module handles all low-level pointer and touch events from the browser.
 * It translates raw DOM events into application-level actions.
 *
 * Responsibilities:
 * - Handle pointerdown, pointermove, pointerup events
 * - Detect double-tap gestures for stroke selection
 * - Detect tap-and-a-half gestures for selection rectangles
 * - Track pointers that start on UI elements (for drag detection)
 * - Prevent default touch behaviors on canvas
 * - Delegate to state machine and trigger appropriate callbacks
 *
 * Design: Uses a callback pattern to avoid circular dependencies. All functions
 * that depend on app.ts logic are passed in via initPointerHandlers().
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { State, Action } from './stateMachine';
import {
    state,
    DOUBLE_TAP_DELAY,
    DOUBLE_TAP_MAX_DURATION,
    DOUBLE_TAP_DISTANCE,
    UI_DRAG_THRESHOLD,
} from './state';

// ============================================================================
// TYPES
// ============================================================================

export interface PointerHandlerCallbacks {
    getDistance: (p1: Point, p2: Point) => number;
    isCursorInMenuRegion: () => boolean;
    updateCursorPosition: () => void;
    addPointToStroke: () => void;
    applyThreeFingerTransform: () => void;
    updateHighlightedStrokes: () => void;
    redraw: () => void;
    handleActions: (actions: Action[]) => void;
    clampCursorToView: () => void;
    snapToGrid: (point: Point) => Point;
    findClosestStrokeAndPoint: (searchPos?: Point) => { strokeIdx: number; pointIdx: number; point: Point } | null;
    updateUI: () => void;
    updatePickersForSelectedStroke: () => void;
    isPickerOpen: () => boolean;
    closePicker: () => void;
}

// Store callbacks - will be set during initialization
let callbacks: PointerHandlerCallbacks;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initPointerHandlers(cb: PointerHandlerCallbacks): void {
    callbacks = cb;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPointerPos(e: PointerEvent): Point {
    const rect = state.canvas!.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// ============================================================================
// POINTER EVENT HANDLERS
// ============================================================================

export function handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const pos = getPointerPos(e);
    const now = Date.now();

    // Check if this started on a UI element
    if (target.closest('.toolbar, button, #combinedPicker, [style*="z-index: 1000"]')) {
        // Track this pointer - it might become a drag
        state.pointersOnUI.set(e.pointerId, { startX: e.clientX, startY: e.clientY });
        return;
    }

    e.preventDefault();

    // Only track taps when no fingers are down (single finger gestures)
    if (state.eventHandler.getFingerCount() === 0) {
        // Check if this is the second tap down (could be double-tap or tap-and-a-half)
        if (state.firstTapUpTime > 0 &&
            now - state.firstTapUpTime < DOUBLE_TAP_DELAY &&
            state.firstTapDownPos !== null &&
            callbacks.getDistance(pos, state.firstTapDownPos) < DOUBLE_TAP_DISTANCE) {
            // This is the second tap down - record it and mark as tracking double-tap
            state.secondTapDownTime = now;
            state.secondTapDownPos = pos;
            state.isTrackingDoubleTap = true;

            // Check if we should enter tap-and-a-half mode (selection rectangle)
            // Tap-and-a-half: User intends to drag, so second tap should be held longer
            // We'll check on pointer move or pointer up if it's double-tap vs tap-and-a-half
        } else {
            // This is the first tap down - record it
            state.firstTapDownTime = now;
            state.firstTapDownPos = pos;
            state.firstTapUpTime = 0;  // Reset up time
            state.secondTapDownTime = 0;
            state.secondTapDownPos = null;
            state.isTrackingDoubleTap = false;
        }
    }

    // Capture pointer on document.body - this ensures we receive all events
    // regardless of where the touch started
    document.body.setPointerCapture(e.pointerId);

    // Pass to event handler
    state.eventHandler.handlePointerDown(e.pointerId, pos);
}

export function handlePointerMove(e: PointerEvent): void {
    const pos = getPointerPos(e);

    // Check if this pointer started on UI and should be converted to a drag
    const uiPointer = state.pointersOnUI.get(e.pointerId);
    if (uiPointer) {
        const dx = e.clientX - uiPointer.startX;
        const dy = e.clientY - uiPointer.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > UI_DRAG_THRESHOLD) {
            // Convert to canvas drag - remove from UI tracking and initialize as pointer down
            state.pointersOnUI.delete(e.pointerId);
            e.preventDefault();

            // Initialize this pointer in the event handler
            state.eventHandler.handlePointerDown(e.pointerId, pos);
            document.body.setPointerCapture(e.pointerId);
        }
        return; // Don't process as move yet
    }

    e.preventDefault();
    state.eventHandler.handlePointerMove(e.pointerId, pos);

    const currentState = state.stateMachine.getState();

    // Tap-and-a-half detection: if user is holding second tap and moves, enter selection rectangle
    if (state.isTrackingDoubleTap && currentState === State.MovingCursor) {
        const now = Date.now();
        // If second tap is held longer than double-tap max duration, it's tap-and-a-half
        if (now - state.secondTapDownTime > DOUBLE_TAP_MAX_DURATION) {
            // Enter selection rectangle mode
            state.stateMachine.enterSelectionRectangle();
            state.isTrackingDoubleTap = false;
            // Trigger the START_SELECTION_RECTANGLE action manually
            callbacks.handleActions([Action.START_SELECTION_RECTANGLE, Action.DESELECT_STROKE]);
        }
    }

    // Handle state-specific continuous updates
    if (currentState === State.MovingCursor || currentState === State.Drawing) {
        callbacks.updateCursorPosition();

        if (currentState === State.Drawing && state.currentStroke) {
            callbacks.addPointToStroke();
        }

        callbacks.redraw();
    } else if (currentState === State.Transform) {
        callbacks.applyThreeFingerTransform();
        callbacks.redraw();
    } else if (currentState === State.SelectionRectangle) {
        // Clear double-tap tracking since we're now dragging a selection rectangle
        state.secondTapDownTime = 0;
        state.secondTapDownPos = null;
        state.isTrackingDoubleTap = false;

        // Update cursor position and selection rectangle
        callbacks.updateCursorPosition();
        if (state.cursorAnchor && state.selectionRectStart) {
            state.selectionRectEnd = { ...state.cursorAnchor };
            // Update highlighted strokes in real-time as the rectangle changes
            callbacks.updateHighlightedStrokes();
        }
        callbacks.redraw();
    }
}

export function handlePointerUp(e: PointerEvent): void {
    // Clean up UI pointer tracking if this pointer was on UI
    if (state.pointersOnUI.has(e.pointerId)) {
        state.pointersOnUI.delete(e.pointerId);
        return; // This was a UI tap, don't process as canvas event
    }

    e.preventDefault();

    const pos = getPointerPos(e);
    const now = Date.now();

    state.eventHandler.handlePointerUp(e.pointerId);

    if (state.eventHandler.getFingerCount() <= 1) // Only 1 finger left or no fingers left
    {
        state.lastPrimaryPos = null;
        state.lastSecondaryPos = null;
        state.lastDelta = null;
        state.batchedDelta = null;
    }

    // Clean up movement tracking if all fingers are up
    if (state.eventHandler.getFingerCount() === 0) {
        // Close combined picker on tap (quick touch and release)
        // Check if this was a quick single tap (not part of double-tap sequence)
        // But don't close if cursor is in menu region (user is interacting with menu)
        if (state.firstTapDownTime > 0 && state.firstTapDownPos !== null &&
            callbacks.getDistance(pos, state.firstTapDownPos) < DOUBLE_TAP_DISTANCE &&
            now - state.firstTapDownTime < DOUBLE_TAP_MAX_DURATION &&
            !state.isTrackingDoubleTap &&
            !callbacks.isCursorInMenuRegion()) {
            // This is a single tap completion - close the picker if it's open
            if (callbacks.isPickerOpen()) {
                callbacks.closePicker();
            }
        }
        // Check for double-tap completion (second finger lift)
        if (state.secondTapDownTime > 0 &&
            state.secondTapDownPos !== null &&
            callbacks.getDistance(pos, state.secondTapDownPos) < DOUBLE_TAP_DISTANCE &&
            now - state.secondTapDownTime < DOUBLE_TAP_MAX_DURATION) {  // Second tap must be quick
            // Valid double-tap completed!
            // DOUBLE-TAP SELECTION: Select stroke closest to the cursor position
            const result = state.cursorAnchor ? callbacks.findClosestStrokeAndPoint(state.cursorAnchor) : null;
            if (result) {
                // Move cursor to the closest point
                state.cursorAnchor = result.point;
                // Select the stroke and store the point index
                state.selectedStrokeIdx = result.strokeIdx;
                state.selectedStrokePointIdx = result.pointIdx;
                state.selectedStrokeCursorPos = { ...result.point };
                // Manual selection exits fresh stroke mode
                state.isFreshStroke = false;
                // Clear transformation undo state when manually selecting a stroke
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // Highlight the selected stroke
                state.highlightedStrokes.clear();
                state.highlightedStrokes.add(result.strokeIdx);
                // Update state machine to reflect selection
                state.stateMachine.setStrokeSelected(true);
                callbacks.updateUI();
                // Update color and size pickers to match selected stroke
                callbacks.updatePickersForSelectedStroke();
            }
            // Reset double-tap tracking
            state.firstTapDownTime = 0;
            state.firstTapDownPos = null;
            state.firstTapUpTime = 0;
            state.secondTapDownTime = 0;
            state.secondTapDownPos = null;
            state.isTrackingDoubleTap = false;
        } else if (state.firstTapDownTime > 0 && state.firstTapDownPos !== null &&
                   callbacks.getDistance(pos, state.firstTapDownPos) < DOUBLE_TAP_DISTANCE &&
                   now - state.firstTapDownTime < DOUBLE_TAP_MAX_DURATION) {  // First tap must be quick
            // First tap completed successfully - record the up time
            state.firstTapUpTime = now;
            state.isTrackingDoubleTap = false;
        } else {
            // Movement was too far or some other condition - reset tracking
            state.firstTapDownTime = 0;
            state.firstTapDownPos = null;
            state.firstTapUpTime = 0;
            state.secondTapDownTime = 0;
            state.secondTapDownPos = null;
            state.isTrackingDoubleTap = false;
        }

        // Mark transformation as complete if strokes were transformed
        if (state.transformStart && state.transformStart.strokeSnapshotsMap && state.transformSnapshot) {
            state.hasUndoableTransform = true;
            callbacks.updateUI();
        }
        state.transformStart = null;

        // Clamp cursor after transform
        callbacks.clampCursorToView();

        // Snap to grid in grid mode
        if (state.isGridMode && state.cursorAnchor) {
            state.cursorAnchor = callbacks.snapToGrid(state.cursorAnchor);
        }

        callbacks.redraw();
    }
}

// ============================================================================
// TOUCH EVENT HELPERS
// ============================================================================

export function shouldPreventDefault(e: TouchEvent): boolean {
    const target = e.target as HTMLElement;
    // Don't prevent default for toolbar buttons, picker, or popups
    if (target.closest('.toolbar, button, #combinedPicker, [style*="z-index: 1000"]')) {
        return false;
    }
    return true;
}

// ============================================================================
// EVENT LISTENER SETUP
// ============================================================================

export function setupPointerEventListeners(): void {
    // Attach pointer events to document so dragging works even when starting over menu/picker
    // The handlePointerDown function will capture the pointer to continue receiving events
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    // Prevent default touch behavior, but only for canvas area (not toolbar/UI elements)
    document.addEventListener('touchstart', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchcancel', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
}
