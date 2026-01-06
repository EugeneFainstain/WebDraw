/**
 * CURSORMOVEMENT.TS - Cursor Position Updates and Stroke Point Addition
 *
 * This module handles cursor movement calculations for single-finger and two-finger
 * drawing modes, translating screen-space finger movements into canvas-space cursor deltas.
 *
 * Responsibilities:
 * - Single-finger cursor movement (direct delta application)
 * - Two-finger cursor movement with delta averaging (two algorithms available)
 * - Algorithm 1: Batched deltas - buffers and averages alternating finger movements
 * - Algorithm 2: Simple averaging - every delta produces movement, averaged with previous
 * - Adding points to the current stroke (normal mode and grid mode)
 * - Grid mode: snap to grid, interpolate between grid positions
 * - Stroke length threshold detection for gesture locking
 *
 * Design: Uses a callback pattern for coordinate transforms and grid functions.
 * Reads/writes state.cursorAnchor, state.currentStroke, and position tracking state.
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { getPathLength } from './resample';
import {
    state,
    USE_BATCHED_DELTA_MECHANISM,
    getStrokeLenThreshold,
} from './state';

// ============================================================================
// TYPES
// ============================================================================

export interface CursorMovementCallbacks {
    screenDeltaToCanvasDelta: (screenDelta: Point) => Point;
    panToKeepCursorInView: () => void;
    getGridCellSize: () => number;
    snapToGrid: (point: Point) => Point;
}

// Store callbacks - will be set during initialization
let callbacks: CursorMovementCallbacks;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initCursorMovement(cb: CursorMovementCallbacks): void {
    callbacks = cb;
}

// ============================================================================
// CURSOR POSITION ALGORITHMS
// ============================================================================

// Algorithm 1: Intricate batching mechanism
// Handles finger promotion and mode transitions with batched deltas
function updateCursorPositionWithBatching(): void {
    const positions = state.eventHandler.getFingerPositions();
    if (!state.cursorAnchor) return;

    // Determine which finger moved
    let movedPointerId: number | null = null;
    let deltaX = 0;
    let deltaY = 0;

    if (positions.primary && state.lastPrimaryPos) {
        const primaryDeltaX = positions.primary.x - state.lastPrimaryPos.x;
        const primaryDeltaY = positions.primary.y - state.lastPrimaryPos.y;
        if (primaryDeltaX !== 0 || primaryDeltaY !== 0) {
            deltaX = primaryDeltaX;
            deltaY = primaryDeltaY;
            movedPointerId = 1; // Primary finger
        }
    }

    if (positions.secondary && state.lastSecondaryPos) {
        const secondaryDeltaX = positions.secondary.x - state.lastSecondaryPos.x;
        const secondaryDeltaY = positions.secondary.y - state.lastSecondaryPos.y;
        if (secondaryDeltaX !== 0 || secondaryDeltaY !== 0) {
            if (movedPointerId !== null) {
                // Both fingers moved - average them
                deltaX = (deltaX + secondaryDeltaX) / 2;
                deltaY = (deltaY + secondaryDeltaY) / 2;
                movedPointerId = 3; // Both fingers
            } else {
                deltaX = secondaryDeltaX;
                deltaY = secondaryDeltaY;
                movedPointerId = 2; // Secondary finger
            }
        }
    }

    // Update last positions
    state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
    state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;

    // Two-finger mode: buffer and average alternating finger movements
    if (positions.primary && positions.secondary) {
        // Process batched delta first
        if (state.batchedDelta !== null) {
            const canvasDelta = callbacks.screenDeltaToCanvasDelta(state.batchedDelta);
            state.cursorAnchor.x += canvasDelta.x;
            state.cursorAnchor.y += canvasDelta.y;
            callbacks.panToKeepCursorInView();

            if (state.currentStroke && !state.isGridMode) {
                state.currentStroke.points!.push({ ...state.cursorAnchor });
            }

            state.batchedDelta = null;
        }

        // Process current delta with lastDelta buffering
        if (deltaX !== 0 || deltaY !== 0 && movedPointerId !== null) {
            if (state.lastDelta !== null) {
                const sameFingerTwice = (state.lastDelta.pointerId === movedPointerId);

                if (sameFingerTwice) {
                    // Same finger moved twice - process first delta immediately
                    const canvasDelta = callbacks.screenDeltaToCanvasDelta(state.lastDelta);
                    state.cursorAnchor.x += canvasDelta.x;
                    state.cursorAnchor.y += canvasDelta.y;
                    callbacks.panToKeepCursorInView();

                    if (state.currentStroke && !state.isGridMode) {
                        state.currentStroke.points!.push({ ...state.cursorAnchor });
                    }

                    // Store current delta for next iteration
                    state.lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
                } else {
                    // Different fingers - average them
                    const avgDelta = {
                        x: (state.lastDelta.x + deltaX) / 2,
                        y: (state.lastDelta.y + deltaY) / 2
                    };

                    const canvasDelta = callbacks.screenDeltaToCanvasDelta(avgDelta);
                    state.cursorAnchor.x += canvasDelta.x;
                    state.cursorAnchor.y += canvasDelta.y;
                    callbacks.panToKeepCursorInView();

                    if (state.currentStroke && !state.isGridMode) {
                        state.currentStroke.points!.push({ ...state.cursorAnchor });
                    }

                    // Clear the buffer
                    state.lastDelta = null;
                }
            } else {
                // First delta - buffer it and wait for next
                state.lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
            }
        }
    }
}

// Algorithm 2: Simple averaging mechanism
// Every delta produces movement - averaged with last delta from OTHER finger, or halved if same finger
function updateCursorPositionSimple(): void {
    const positions = state.eventHandler.getFingerPositions();
    if (!state.cursorAnchor) return;

    if (!positions.primary || !positions.secondary) return;

    // Prepare for 2-finger processing
    if (!state.lastPrimaryPos)
        state.lastPrimaryPos = positions.primary;

    if (!state.lastSecondaryPos)
        state.lastSecondaryPos = positions.secondary;

    if (!state.lastDelta)
        state.lastDelta = { x: 0, y: 0, pointerId: 0 };

    // Determine which finger moved and calculate its delta
    let movedPointerId = 0;
    let primaryDelta: Point = { x: 0, y: 0 };
    let secondaryDelta: Point = { x: 0, y: 0 };

    // Primary deltas
    primaryDelta.x = positions.primary.x - state.lastPrimaryPos.x;
    primaryDelta.y = positions.primary.y - state.lastPrimaryPos.y;
    if (primaryDelta.x || primaryDelta.y)
        movedPointerId += 1; // Primary finger moved

    // Secondary deltas
    secondaryDelta.x = positions.secondary.x - state.lastSecondaryPos.x;
    secondaryDelta.y = positions.secondary.y - state.lastSecondaryPos.y;
    if (secondaryDelta.x || secondaryDelta.y)
        movedPointerId += 2; // Secondary finger moved

    // "delta" will be the sum of deltas from both fingers - but only 1 should normally be non-zero...
    let delta: Point = {
        x: primaryDelta.x + secondaryDelta.x,
        y: primaryDelta.y + secondaryDelta.y
    };

    // Lets calculate the final delta
    let finalDelta: Point = { x: 0, y: 0 };

    if (movedPointerId == 1 || movedPointerId == 2) // Only 1 finger has moved
    {
        if (movedPointerId == state.lastDelta.pointerId) // The same finger moved as last time
        {
            // Note: if we are NOT dividing by 2 here - we get the same sensitivity
            //       for one finger as we get for two - but this is a somewhat discontinuos
            //       behavior - so we'll skip this for now (in the simple variant)
            finalDelta.x = delta.x / 2;
            finalDelta.y = delta.y / 2;
        }
        else // A different finger moved compared to last time
        {
            // Divide by 4 = divide by 2 (average) × divide by 2 (we emit 2x more deltas than batched mode)
            // Unlike the batched algorithm which outputs every other delta, we output EVERY delta.
            // So when two fingers alternate at 10px each:
            //   Event A: delta=10, finalDelta=10/2=5px (same finger case above)
            //   Event B: delta=10, finalDelta=(10+10)/4=5px (this case - average with last)
            //   Total: 5+5=10px ✓ matches the speed when both fingers move together
            finalDelta.x = (delta.x + state.lastDelta.x) / 4;
            finalDelta.y = (delta.y + state.lastDelta.y) / 4;
        }
    }
    else if (movedPointerId == 3) // Both fingers moved - shouldn't really happen...
    {
        finalDelta.x = delta.x / 2;
        finalDelta.y = delta.y / 2;
    }

    // Update last positions
    state.lastPrimaryPos = positions.primary;
    state.lastSecondaryPos = positions.secondary;
    state.lastDelta = { x: delta.x, y: delta.y, pointerId: movedPointerId! };

    // Process finalDelta
    const canvasDelta = callbacks.screenDeltaToCanvasDelta(finalDelta);
    state.cursorAnchor.x += canvasDelta.x;
    state.cursorAnchor.y += canvasDelta.y;
    callbacks.panToKeepCursorInView();

    if (state.currentStroke && !state.isGridMode) {
        state.currentStroke.points!.push({ ...state.cursorAnchor });
    }
}

// ============================================================================
// MAIN CURSOR UPDATE FUNCTION
// ============================================================================

export function updateCursorPosition(): void {
    const positions = state.eventHandler.getFingerPositions();
    if (!state.cursorAnchor) return;

    // Single finger mode - handle directly without algorithm complexity
    if (!positions.secondary) {
        // Calculate delta
        let deltaX = 0;
        let deltaY = 0;

        if (positions.primary && state.lastPrimaryPos) {
            deltaX = positions.primary.x - state.lastPrimaryPos.x;
            deltaY = positions.primary.y - state.lastPrimaryPos.y;
        }

        // Update last position
        state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
        state.lastSecondaryPos = null;

        // Process delta immediately
        if (deltaX !== 0 || deltaY !== 0) {
            const canvasDelta = callbacks.screenDeltaToCanvasDelta({ x: deltaX, y: deltaY });
            state.cursorAnchor.x += canvasDelta.x;
            state.cursorAnchor.y += canvasDelta.y;
            callbacks.panToKeepCursorInView();
        }

        state.lastDelta = null;
        return;
    }

    // Two-finger mode - use the appropriate algorithm
    if (USE_BATCHED_DELTA_MECHANISM) {
        updateCursorPositionWithBatching();
    } else {
        updateCursorPositionSimple();
    }
}

// ============================================================================
// STROKE POINT ADDITION
// ============================================================================

export function addPointToStroke(): void {
    if (!state.currentStroke || !state.cursorAnchor) return;

    // In grid mode, only add points when moving a full cell size away
    if (state.isGridMode) {
        if (!state.lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        const cellSize = callbacks.getGridCellSize();
        const threshold = cellSize * 0.9;

        const deltaFromLastX = Math.abs(state.cursorAnchor.x - state.lastGridPosition.x);
        const deltaFromLastY = Math.abs(state.cursorAnchor.y - state.lastGridPosition.y);

        if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
            const gridPoint = callbacks.snapToGrid(state.cursorAnchor);

            // Add 9 interpolated points between last grid position and new grid point
            const numInterpolated = 9;
            for (let i = 1; i <= numInterpolated; i++) {
                const t = i / (numInterpolated + 1);
                const interpPoint = {
                    x: state.lastGridPosition.x + t * (gridPoint.x - state.lastGridPosition.x),
                    y: state.lastGridPosition.y + t * (gridPoint.y - state.lastGridPosition.y)
                };
                state.currentStroke.points!.push(interpPoint);
            }

            // Add the actual grid point
            state.currentStroke.points!.push(gridPoint);
            state.lastGridPosition = gridPoint;
            // Snap the cursor to the grid point while drawing
            state.cursorAnchor = { ...gridPoint };
        }
    } else {
        // Normal mode: add every point
        state.currentStroke.points!.push({ ...state.cursorAnchor });
    }

    // Check if stroke is long enough to lock the gesture as drawing
    // This prevents the stroke from being abandoned if a pinch gesture is detected
    if (state.currentStroke.points && state.currentStroke.points.length > 1 && !state.eventHandler.isGestureLockedAsDrawing()) {
        const strokeLength = getPathLength(state.currentStroke.points);
        // Convert threshold from screen-space to canvas-space by dividing by current zoom scale
        // When zoomed in (scale > 1), the threshold in canvas units becomes smaller
        // When zoomed out (scale < 1), the threshold in canvas units becomes larger
        const canvasSpaceThreshold = getStrokeLenThreshold() / state.viewTransform.scale;
        if (strokeLength >= canvasSpaceThreshold) {
            state.eventHandler.lockGestureAsDrawing();
        }
    }
}
