/**
 * CURSORMOVEMENT.TS - Cursor Position Updates and Management
 *
 * This module handles all cursor-related functionality including movement calculations,
 * position management, and cursor rendering.
 *
 * Responsibilities:
 * - Single-finger cursor movement (direct delta application)
 * - Two-finger cursor movement with delta averaging (two algorithms available)
 * - Algorithm 1: Batched deltas - buffers and averages alternating finger movements
 * - Algorithm 2: Simple averaging - every delta produces movement, averaged with previous
 * - Adding points to the current stroke (normal mode and grid mode)
 * - Grid mode: snap to grid, interpolate between grid positions
 * - Stroke length threshold detection for gesture locking
 * - Cursor positioning: setCursorToDefaultPosition, clampCursorToView, panToKeepCursorInView
 * - Cursor screen/page position queries: getCursorScreenPos, getCursorPagePos
 * - UI interaction detection: isCursorInMenuRegion, getClickableElementAtCursor, simulateTapAtCursor
 * - Cursor rendering: updateCursorDiv
 *
 * Design: Uses a callback pattern for coordinate transforms and grid functions.
 * Reads/writes state.cursorPos, state.currentStroke, and position tracking state.
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { getPathLength } from './resample';
import {
    state,
    USE_BATCHED_DELTA_MECHANISM,
    getStrokeLenThreshold,
    TOOLBAR_HEIGHT,
    CONFINE_CURSOR_TO_CANVAS,
    CURSOR_SHAPE,
    DRAWING_CURSOR_SAME_AS_AIMING_CURSOR,
    // getSelectedStrokeIdx,  // commented out along with inner ring color logic
} from './state';
import { State, Event } from './stateMachine';

// ============================================================================
// TYPES
// ============================================================================

export interface CursorMovementCallbacks {
    screenDeltaToCanvasDelta: (screenDelta: Point) => Point;
    getGridCellSize: () => number;
    snapToGrid: (point: Point) => Point;
    screenToCanvas: (screenPos: Point) => Point;
    canvasToScreen: (canvasPos: Point) => Point;
    getPickerColor: () => string;
    getPickerSize: () => number;
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
    if (!state.cursorPos) return;

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
            state.cursorPos.x += canvasDelta.x;
            state.cursorPos.y += canvasDelta.y;
            panToKeepCursorInView();

            state.batchedDelta = null;
        }

        // Process current delta with lastDelta buffering
        if (deltaX !== 0 || deltaY !== 0 && movedPointerId !== null) {
            if (state.lastDelta !== null) {
                const sameFingerTwice = (state.lastDelta.pointerId === movedPointerId);

                if (sameFingerTwice) {
                    // Same finger moved twice - process first delta immediately
                    const canvasDelta = callbacks.screenDeltaToCanvasDelta(state.lastDelta);
                    state.cursorPos.x += canvasDelta.x;
                    state.cursorPos.y += canvasDelta.y;
                    panToKeepCursorInView();

                    // Store current delta for next iteration
                    state.lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
                } else {
                    // Different fingers - average them
                    const avgDelta = {
                        x: (state.lastDelta.x + deltaX) / 2,
                        y: (state.lastDelta.y + deltaY) / 2
                    };

                    const canvasDelta = callbacks.screenDeltaToCanvasDelta(avgDelta);
                    state.cursorPos.x += canvasDelta.x;
                    state.cursorPos.y += canvasDelta.y;
                    panToKeepCursorInView();

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
    if (!state.cursorPos) return;

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
    state.cursorPos.x += canvasDelta.x;
    state.cursorPos.y += canvasDelta.y;
    panToKeepCursorInView();
}

// ============================================================================
// MAIN CURSOR UPDATE FUNCTION
// ============================================================================

export function updateCursorPosition(): void {
    const positions = state.eventHandler.getFingerPositions();
    if (!state.cursorPos) return;

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
            state.cursorPos.x += canvasDelta.x;
            state.cursorPos.y += canvasDelta.y;
            panToKeepCursorInView();
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
    if (!state.currentStroke || !state.cursorPos) return;

    // In grid mode, defer adding points until finger is lifted
    // Cursor moves freely, but we track the snapped grid point for the preview line
    if (state.isGridMode) {
        if (!state.lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        // Always update the deferred point to the nearest grid intersection from cursor
        const gridPoint = callbacks.snapToGrid(state.cursorPos);

        // Only set deferred point if it's different from the last committed grid position
        if (gridPoint.x !== state.lastGridPosition.x || gridPoint.y !== state.lastGridPosition.y) {
            state.gridDeferredPoint = gridPoint;
        } else {
            // Cursor snapped to the same grid point as last committed - no deferred point
            state.gridDeferredPoint = null;
        }
        // Don't snap cursor - let it move freely
        // Don't update cursorAnchorPos here - we haven't actually committed the point yet
    } else {
        // Normal mode: add every point, but skip duplicates
        const points = state.currentStroke.points!;
        const lastPoint = points[points.length - 1];
        // Only add if different from last point
        if (lastPoint.x !== state.cursorPos.x || lastPoint.y !== state.cursorPos.y) {
            points.push({ ...state.cursorPos });
            // Update anchor for deselection distance check
            state.cursorAnchorPos = { ...state.cursorPos };
        }
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
            // Emit LONG_STROKE_DRAWN event to set the flag for stroke protection
            state.stateMachine.processEvent(Event.LONG_STROKE_DRAWN);
        }
    }
}

// ============================================================================
// CURSOR POSITIONING FUNCTIONS
// ============================================================================

function getDefaultCursorOffset(): Point {
    const maxDim = Math.max(state.canvas!.width, state.canvas!.height);
    const offset = maxDim / 8;
    const diagonalOffset = offset / Math.SQRT2;
    return {
        x: -diagonalOffset,
        y: -diagonalOffset
    };
}

export function setCursorToDefaultPosition(screenPos: Point): void {
    const offset = getDefaultCursorOffset();
    const targetScreenPos = {
        x: screenPos.x + offset.x,
        y: screenPos.y + offset.y
    };

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(state.canvas!.width - margin, targetScreenPos.x));
    // minY depends on confinement mode:
    // - confined: stay within canvas (margin from top)
    // - not confined: allow into toolbar area (negative Y in canvas space)
    const minY = CONFINE_CURSOR_TO_CANVAS ? margin : -TOOLBAR_HEIGHT + margin;
    const clampedY = Math.max(minY, Math.min(state.canvas!.height - margin, targetScreenPos.y));

    state.cursorPos = callbacks.screenToCanvas({ x: clampedX, y: clampedY });
}

export function clampCursorToView(): void {
    if (!state.cursorPos) return;
    const screenPos = callbacks.canvasToScreen(state.cursorPos);

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(state.canvas!.width - margin, screenPos.x));
    // minY depends on confinement mode
    const minY = CONFINE_CURSOR_TO_CANVAS ? margin : -TOOLBAR_HEIGHT + margin;
    const clampedY = Math.max(minY, Math.min(state.canvas!.height - margin, screenPos.y));

    if (clampedX !== screenPos.x || clampedY !== screenPos.y) {
        state.cursorPos = callbacks.screenToCanvas({ x: clampedX, y: clampedY });
    }
}

export function panToKeepCursorInView(): void {
    if (!state.cursorPos) return;
    const screenPos = callbacks.canvasToScreen(state.cursorPos);

    const margin = 10;
    // minY depends on confinement mode
    const minY = CONFINE_CURSOR_TO_CANVAS ? margin : -TOOLBAR_HEIGHT + margin;
    let panDeltaX = 0;
    let panDeltaY = 0;

    if (screenPos.x < margin) {
        panDeltaX = margin - screenPos.x;
    } else if (screenPos.x > state.canvas!.width - margin) {
        panDeltaX = (state.canvas!.width - margin) - screenPos.x;
    }

    if (screenPos.y < minY) {
        panDeltaY = minY - screenPos.y;
    } else if (screenPos.y > state.canvas!.height - margin) {
        panDeltaY = (state.canvas!.height - margin) - screenPos.y;
    }

    if (panDeltaX !== 0 || panDeltaY !== 0) {
        state.viewTransform.panX += panDeltaX;
        state.viewTransform.panY += panDeltaY;
    }
}

// ============================================================================
// CURSOR SCREEN/PAGE POSITION QUERIES
// ============================================================================

export function getCursorScreenPos(): Point {
    if (!state.cursorPos) {
        return { x: state.canvas!.width / 2, y: state.canvas!.height / 4 };
    }
    return callbacks.canvasToScreen(state.cursorPos);
}

/**
 * Get the page coordinates of the cursor tip.
 */
export function getCursorPagePos(): { x: number, y: number } | null {
    if (!state.cursorPos) return null;
    const cursorScreenPos = getCursorScreenPos();
    return {
        x: cursorScreenPos.x,
        y: cursorScreenPos.y + TOOLBAR_HEIGHT
    };
}

// ============================================================================
// UI INTERACTION DETECTION
// ============================================================================

/**
 * Check if the cursor tip is in the menu region (above the canvas)
 * or over a UI element like an open popup.
 * Always returns false when cursor is confined to canvas.
 */
export function isCursorInMenuRegion(): boolean {
    // When cursor is confined to canvas, it can never be in menu region
    if (CONFINE_CURSOR_TO_CANVAS) return false;

    if (!state.cursorPos) return false;
    const cursorScreenPos = getCursorScreenPos();

    // Cursor is in menu region if Y is negative (above the canvas)
    if (cursorScreenPos.y < 0) return true;

    // Also check if cursor is over an open picker popup
    const pagePos = getCursorPagePos();
    if (pagePos) {
        const element = document.elementFromPoint(pagePos.x, pagePos.y);
        if (element) {
            // Check if we're over a popup or toolbar element
            const uiElement = element.closest('.toolbar, [style*="z-index: 1000"]');
            if (uiElement) return true;
        }
    }

    return false;
}

/**
 * Check if the cursor tip is over a clickable UI element (toolbar or popup).
 * Returns the clickable element if found, null otherwise.
 * Always returns null when cursor is confined to canvas.
 */
export function getClickableElementAtCursor(): HTMLElement | null {
    // When cursor is confined to canvas, it can't be over UI elements
    if (CONFINE_CURSOR_TO_CANVAS) return null;

    const pagePos = getCursorPagePos();
    if (!pagePos) return null;

    // Find the element at the cursor tip position
    const element = document.elementFromPoint(pagePos.x, pagePos.y);
    if (!element) return null;

    // Don't count canvas or its children as clickable UI
    if (element.closest('#drawingCanvas, #cursorDiv')) return null;

    // Find the closest clickable element - buttons, combined picker, or elements in popups
    return element.closest('button, [role="button"], #combinedPicker, div[style*="border-radius: 4px"][style*="cursor: pointer"]') as HTMLElement | null;
}

/**
 * Simulate a tap at the cursor tip position if it's over a UI element.
 * This allows users to tap anywhere on the screen to "click" menu buttons
 * using the cursor as the actual click location.
 * Returns true if a UI element was clicked, false otherwise.
 */
export function simulateTapAtCursor(): boolean {
    const clickable = getClickableElementAtCursor();
    if (clickable) {
        clickable.click();
        return true;
    }
    return false;
}

// ============================================================================
// CURSOR RENDERING
// ============================================================================

export function updateCursorDiv(): void {
    if (!state.cursorPos) {
        state.dom.cursorDiv!.style.display = 'none';
        return;
    }

    const currentState = state.stateMachine.getState();

    // Hide arrow cursor during transform operations (reticle stays visible)
    if (currentState === State.Transform && CURSOR_SHAPE === 'arrow') {
        state.dom.cursorDiv!.style.display = 'none';
        return;
    }

    const cursorScreenPos = getCursorScreenPos();

    // In confined mode, hide cursor if it would be above the canvas (in toolbar area)
    if (CONFINE_CURSOR_TO_CANVAS && cursorScreenPos.y < 0) {
        state.dom.cursorDiv!.style.display = 'none';
        return;
    }

    const strokeSize = callbacks.getPickerSize();
    const renderedSize = Math.max(strokeSize * state.viewTransform.scale, 1);
    const drawColor = callbacks.getPickerColor();
    const isWhite = drawColor.toUpperCase() === '#FFFFFF';

    // Check if we're in Drawing state and should show special drawing cursor
    const isDrawing = currentState === State.Drawing;
    const showDrawingCursor = isDrawing && !DRAWING_CURSOR_SAME_AS_AIMING_CURSOR;

    if (showDrawingCursor) {
        // Drawing state: show two concentric circle outlines
        // Inner circle: thin outline in drawing color (same as old inverse circle)
        // Outer circle: thick white outline behind it
        const innerOutlineWidth = 2;
        const innerRadius = renderedSize / 2 + innerOutlineWidth / 2;

        // Outer (white) circle: same thickness as inner, radius larger by inner stroke width
        const outerOutlineWidth = 2;
        const outerRadius = innerRadius + innerOutlineWidth;

        // SVG size needs to accommodate both circles
        const totalSize = (outerRadius + outerOutlineWidth / 2) * 2;
        const center = totalSize / 2;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize}" height="${totalSize}" style="display:block;">
            <circle cx="${center}" cy="${center}" r="${outerRadius}" fill="none" stroke="white" stroke-width="${outerOutlineWidth}"/>
            <circle cx="${center}" cy="${center}" r="${innerRadius}" fill="none" stroke="${drawColor}" stroke-width="${innerOutlineWidth}"/>
        </svg>`;

        state.dom.cursorDiv!.style.display = 'block';
        state.dom.cursorDiv!.style.left = `${cursorScreenPos.x - center}px`;
        state.dom.cursorDiv!.style.top = `${cursorScreenPos.y + TOOLBAR_HEIGHT - center}px`;
        state.dom.cursorDiv!.style.lineHeight = '0';
        state.dom.cursorDiv!.style.width = `${totalSize}px`;
        state.dom.cursorDiv!.style.height = `${totalSize}px`;
        state.dom.cursorDiv!.innerHTML = svg;
    } else {
        // Normal state: show arrow or reticle cursor based on CURSOR_SHAPE
        const outerColor = isWhite ? 'black' : drawColor;

        // Inner ring color based on anchor state:
        // - lime (green): cursor anchored at endpoint of stroke (can continue drawing)
        // - lightskyblue: cursor anchored at middle point of stroke (can't continue)
        // - white: cursor not anchored to any stroke point (free-floating)
        let innerColor = 'white';
        // const selectedIdx = getSelectedStrokeIdx();
        // if (selectedIdx !== null && state.selectedStrokePointIdx !== null) {
        //     const selectedStroke = state.strokeHistory[selectedIdx];
        //     if (selectedStroke && selectedStroke.points && !selectedStroke.strokes) {
        //         const lastPointIdx = selectedStroke.points.length - 1;
        //         const isAtEndpoint = state.selectedStrokePointIdx === 0 || state.selectedStrokePointIdx === lastPointIdx;
        //         innerColor = isAtEndpoint ? 'lime' : 'lightskyblue';
        //     } else {
        //         // Group stroke - show as selected but can't continue
        //         innerColor = 'lightskyblue';
        //     }
        // }

        // Scale cursor based on stroke size (base size ~48px, scales with stroke)
        // 2x larger than before
        const baseSize = 48;
        const scale = Math.max(0.5, (renderedSize + 8) / (baseSize / 2));
        const cursorSize = baseSize * scale;

        if (CURSOR_SHAPE === 'reticle') {
            // Reticle cursor - crosshair with activation point at center
            // Two layers: filler circle (back) + reticle lines/circles (front)
            // Original SVG centered at (97.83, 134.04), normalized to 124x124 viewBox with center at (62, 62)
            // Reticle is 2x larger than arrow cursor
            const reticleCursorSize = cursorSize * 2;
            const viewSize = 124;
            const halfView = viewSize / 2;

            // Reticle elements - outer circle with colored outline
            const outerRadius = 50.81;
            const reticleStrokeWidth = 8;
            // Filler circle (drawn behind) - same radius as outer circle, 2x stroke width
            const fillerStrokeWidth = reticleStrokeWidth * 2;

            // Center circles (like drawing cursor) - thin color circle with thin white behind
            const centerInnerOutlineWidth = 2;
            const centerInnerRadius = renderedSize / 2 + centerInnerOutlineWidth / 2;
            const centerOuterOutlineWidth = 2;
            const centerOuterRadius = centerInnerRadius + centerInnerOutlineWidth;
            // Scale center circles to viewBox units (reticleCursorSize pixels = viewSize units)
            const scaleToView = viewSize / reticleCursorSize;
            const centerInnerRadiusScaled = centerInnerRadius * scaleToView;
            const centerInnerOutlineScaled = centerInnerOutlineWidth * scaleToView;
            const centerOuterRadiusScaled = centerOuterRadius * scaleToView;
            const centerOuterOutlineScaled = centerOuterOutlineWidth * scaleToView;

            // Build SVG with filler behind, reticle on top, center circles in middle
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${reticleCursorSize}" height="${reticleCursorSize}">
                <!-- Filler circle (back) - shows anchor state, same radius as outer circle -->
                <circle cx="${halfView}" cy="${halfView}" r="${outerRadius}" fill="none" stroke="${innerColor}" stroke-width="${fillerStrokeWidth}" stroke-linecap="round"/>
                <!-- Reticle (front) - colored outline -->
                <circle cx="${halfView}" cy="${halfView}" r="${outerRadius}" fill="none" stroke="${outerColor}" stroke-width="${reticleStrokeWidth}" stroke-linecap="round"/>
                <!-- Center white circle (back) - thick white outline -->
                <circle cx="${halfView}" cy="${halfView}" r="${centerOuterRadiusScaled}" fill="none" stroke="white" stroke-width="${centerOuterOutlineScaled}"/>
                <!-- Center color circle (front) - thin drawing color outline -->
                <circle cx="${halfView}" cy="${halfView}" r="${centerInnerRadiusScaled}" fill="none" stroke="${drawColor}" stroke-width="${centerInnerOutlineScaled}"/>
            </svg>`;

            // Position with center at cursor position
            const centerOffset = reticleCursorSize / 2;
            state.dom.cursorDiv!.style.display = 'block';
            state.dom.cursorDiv!.style.left = `${cursorScreenPos.x - centerOffset}px`;
            state.dom.cursorDiv!.style.top = `${cursorScreenPos.y + TOOLBAR_HEIGHT - centerOffset}px`;
            state.dom.cursorDiv!.style.width = `${reticleCursorSize}px`;
            state.dom.cursorDiv!.style.height = `${reticleCursorSize}px`;
            state.dom.cursorDiv!.innerHTML = svg;
        } else {
            // Arrow cursor - Windows-style with tip at top-left
            const cursorPath = 'M 0 0 L 0 18 L 4 14 L 8 22 L 11 20 L 7 12 L 13 12 Z';

            // Filled cursor with colored outline:
            // - Fill: white/lime (inner color)
            // - Stroke: draw color (outer color)
            // viewBox starts at -1,-1 to accommodate stroke width around the tip
            // Stroke width is adjusted inversely to scale so it stays fixed at 2px on screen
            const svgScale = cursorSize / 17; // How much the SVG is scaled up
            const strokeWidth = 2 / svgScale; // Counter-scale to keep 2px on screen
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 17 26" width="${cursorSize}" height="${cursorSize * 26/17}">
                <path d="${cursorPath}" fill="${innerColor}" stroke="${outerColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
            </svg>`;

            // Position accounts for toolbar offset (canvas is 60px from top)
            // Offset by 1px (scaled) to align the tip precisely with the cursor position
            const tipOffset = cursorSize / 17; // 1 unit in SVG coords, scaled to actual size
            state.dom.cursorDiv!.style.display = 'block';
            state.dom.cursorDiv!.style.left = `${cursorScreenPos.x - tipOffset}px`;
            state.dom.cursorDiv!.style.top = `${cursorScreenPos.y + TOOLBAR_HEIGHT - tipOffset}px`;
            state.dom.cursorDiv!.style.width = `${cursorSize}px`;
            state.dom.cursorDiv!.style.height = `${cursorSize * 26/17}px`;
            state.dom.cursorDiv!.innerHTML = svg;
        }
    }
}
