/**
 * POINTERHANDLERS.TS - Pointer/Touch Event Processing
 *
 * This module handles all low-level pointer and touch events from the browser.
 * It translates raw DOM events into application-level actions.
 *
 * Responsibilities:
 * - Handle pointerdown, pointermove, pointerup events
 * - Track pointers that start on UI elements (for drag detection)
 * - Prevent default touch behaviors on canvas
 * - Delegate to state machine and trigger appropriate callbacks
 *
 * Note: Double-tap and tap-and-a-half gestures are now handled entirely by
 * the state machine via timestamps and calculated functions.
 *
 * Design: Uses a callback pattern to avoid circular dependencies. All functions
 * that depend on app.ts logic are passed in via initPointerHandlers().
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { State, Action, Event as SMEvent } from './stateMachine';
import {
    state,
    UI_DRAG_THRESHOLD,
    getDeselectDistanceThreshold,
    resetPointerTrackingState,
} from './state';
import { isRadialMenuVisible, updateRadialMenuPosition } from './radialMenu';

// ============================================================================
// TYPES
// ============================================================================

export interface PointerHandlerCallbacks {
    getDistance: (p1: Point, p2: Point) => number;
    updateCursorPosition: () => void;
    addPointToStroke: () => void;
    applyThreeFingerTransform: () => void;
    updateHighlightedStrokes: () => void;
    redraw: () => void;
    handleActions: (actions: Action[]) => void;
    clampCursorToView: () => void;
    snapToGrid: (point: Point) => Point;
    updateUI: () => void;
    canvasToScreen: (canvasPos: Point) => Point;
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

/**
 * Check if cursor is far from the selected stroke anchor point.
 * Returns true if cursor should trigger stroke deselection.
 * Distance is measured in screen space for scale-independent behavior.
 */
function isCursorFarFromAnchor(): boolean {
    if (!state.cursorPos || !state.cursorAnchorPos) {
        return false;
    }

    // Convert both points to screen space for scale-independent distance check
    const cursorScreen = callbacks.canvasToScreen(state.cursorPos);
    const anchorScreen = callbacks.canvasToScreen(state.cursorAnchorPos);

    const distance = callbacks.getDistance(cursorScreen, anchorScreen);
    return distance > getDeselectDistanceThreshold();
}

// ============================================================================
// POINTER EVENT HANDLERS
// ============================================================================

export function handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const pos = getPointerPos(e);

    // Check if this started on a UI element (including radial menu buttons)
    if (target.closest('.toolbar, button, #combinedPicker, [style*="z-index: 1000"], #radialMenu')) {
        // Track this pointer - it might become a drag
        state.pointersOnUI.set(e.pointerId, { startX: e.clientX, startY: e.clientY });
        return;
    }

    e.preventDefault();

    // If radial menu is open and this is NOT the first finger, ignore the event
    // This blocks all multi-finger gestures (drawing, transform, etc.) while menu is open
    if (isRadialMenuVisible() && state.eventHandler.getFingerCount() > 0) {
        return;
    }

    // Capture pointer on document.body - this ensures we receive all events
    // regardless of where the touch started
    document.body.setPointerCapture(e.pointerId);

    // Pass to event handler - it will emit F1_DOWN/F2_DOWN/F3_DOWN and FINGER_DOWN
    // The state machine handles tap detection via timestamps
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

    // Handle state-specific continuous updates
    if (currentState === State.MovingCursor || currentState === State.Drawing) {
        callbacks.updateCursorPosition();

        // Update radial menu position if visible (buttons follow cursor)
        if (isRadialMenuVisible()) {
            updateRadialMenuPosition();
        }

        // Check if cursor moved far from anchor - emit CURSOR_MOVED_FAR event
        if (currentState === State.MovingCursor && state.stateMachine.isOnlyOneStrokeHighlighted()) {
            if (isCursorFarFromAnchor()) {
                // Emit event - state machine will handle deselection
                const result = state.stateMachine.processEvent(SMEvent.CURSOR_MOVED_FAR);
                callbacks.handleActions(result.actions);
            }
        }

        if (currentState === State.Drawing && state.currentStroke) {
            callbacks.addPointToStroke();
        }

        callbacks.redraw();
    } else if (currentState === State.Transform) {
        callbacks.applyThreeFingerTransform();
        callbacks.redraw();
    } else if (currentState === State.SelectionRectangle) {
        // Update cursor position and selection rectangle
        callbacks.updateCursorPosition();
        if (state.cursorPos && state.selectionRectStart) {
            state.selectionRectEnd = { ...state.cursorPos };
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

    // Pass to event handler - it will emit F1_UP/F2_UP/F3_UP and FINGER_UP
    // The state machine handles tap detection via timestamps
    state.eventHandler.handlePointerUp(e.pointerId);

    if (state.eventHandler.getFingerCount() <= 1) // Only 1 finger left or no fingers left
    {
        resetPointerTrackingState();
    }

    // Clean up movement tracking if all fingers are up
    if (state.eventHandler.getFingerCount() === 0) {
        // Mark transformation as complete if strokes were transformed
        if (state.transformStart && state.transformStart.strokeSnapshotsMap && state.transformSnapshot) {
            state.hasUndoableTransform = true;
            callbacks.updateUI();
        }
        state.transformStart = null;

        // Clamp cursor after transform
        callbacks.clampCursorToView();

        // Snap to grid in grid mode
        if (state.isGridMode && state.cursorPos) {
            state.cursorPos = callbacks.snapToGrid(state.cursorPos);
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
