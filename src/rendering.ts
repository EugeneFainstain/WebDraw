/**
 * RENDERING.TS - Canvas Rendering and Visual Operations
 *
 * This module handles all visual output: coordinate transformations, grid drawing,
 * stroke rendering, selection rectangle display, and fullscreen management.
 *
 * Responsibilities:
 * - Coordinate transformations (screen <-> canvas)
 * - Grid mode: cell size, snapping, grid drawing
 * - Stroke drawing (including groups and fitted curves)
 * - Canvas redraw orchestration
 * - Selection rectangle rendering and hit testing
 * - Fullscreen and PWA detection
 *
 * Design: Uses a callback pattern for dependencies on app.ts functions.
 * Reads state directly from the singleton state object.
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { state, Stroke, TOOLBAR_HEIGHT } from './state';
import { isGroup, forEachLeafStroke } from './strokeOperations';

// ============================================================================
// TYPES
// ============================================================================

export interface RenderingCallbacks {
    getPickerColor: () => string;
    getPickerSize: () => number;
    setPickerGridActive: (active: boolean) => void;
    setPickerFitState: (enabled: boolean, active: boolean) => void;
    updateCursorDiv: () => void;
}

// Store callbacks - will be set during initialization
let callbacks: RenderingCallbacks;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initRendering(cb: RenderingCallbacks): void {
    callbacks = cb;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export function getMidpoint(p1: Point, p2: Point): Point {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

// ============================================================================
// COORDINATE TRANSFORMATIONS
// ============================================================================

export function screenToCanvas(screenPos: Point): Point {
    const cos = Math.cos(-state.viewTransform.rotation);
    const sin = Math.sin(-state.viewTransform.rotation);

    const x1 = screenPos.x - state.viewTransform.panX;
    const y1 = screenPos.y - state.viewTransform.panY;

    const cx = state.canvas!.width / 2;
    const cy = state.canvas!.height / 2;
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    const x3 = (x2 - cx) / state.viewTransform.scale + cx;
    const y3 = (y2 - cy) / state.viewTransform.scale + cy;

    return { x: x3, y: y3 };
}

export function canvasToScreen(canvasPos: Point): Point {
    const cx = state.canvas!.width / 2;
    const cy = state.canvas!.height / 2;

    const x1 = (canvasPos.x - cx) * state.viewTransform.scale + cx;
    const y1 = (canvasPos.y - cy) * state.viewTransform.scale + cy;

    const cos = Math.cos(state.viewTransform.rotation);
    const sin = Math.sin(state.viewTransform.rotation);
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    const x3 = x2 + state.viewTransform.panX;
    const y3 = y2 + state.viewTransform.panY;

    return { x: x3, y: y3 };
}

// Transform a delta/vector from screen space to canvas space
// Deltas only need rotation and scale, no translation
export function screenDeltaToCanvasDelta(screenDelta: Point): Point {
    const cos = Math.cos(-state.viewTransform.rotation);
    const sin = Math.sin(-state.viewTransform.rotation);
    const canvasDeltaX = (cos * screenDelta.x - sin * screenDelta.y) / state.viewTransform.scale;
    const canvasDeltaY = (sin * screenDelta.x + cos * screenDelta.y) / state.viewTransform.scale;
    return { x: canvasDeltaX, y: canvasDeltaY };
}

// Convert a screen-space vector length to canvas-space vector length
// Only scale matters for lengths, not rotation or translation
export function screenLengthToCanvasLength(screenLength: number): number {
    return screenLength / state.viewTransform.scale;
}

// ============================================================================
// GRID FUNCTIONS
// ============================================================================

export function getGridCellSize(): number {
    const defaultStrokeSize = 6;
    return defaultStrokeSize * 4;
}

export function snapToGrid(point: Point): Point {
    const cellSize = getGridCellSize();
    return {
        x: Math.round(point.x / cellSize) * cellSize,
        y: Math.round(point.y / cellSize) * cellSize
    };
}

function drawGrid(): void {
    const ctx = state.ctx!;
    const cellSize = getGridCellSize();

    ctx.strokeStyle = 'lightblue';
    ctx.lineWidth = screenLengthToCanvasLength(1);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    const topLeft = screenToCanvas({ x: 0, y: 0 });
    const topRight = screenToCanvas({ x: state.canvas!.width, y: 0 });
    const bottomLeft = screenToCanvas({ x: 0, y: state.canvas!.height });
    const bottomRight = screenToCanvas({ x: state.canvas!.width, y: state.canvas!.height });

    const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    const margin = cellSize * 2;
    const gridLeft = Math.floor((minX - margin) / cellSize) * cellSize;
    const gridRight = Math.ceil((maxX + margin) / cellSize) * cellSize;
    const gridTop = Math.floor((minY - margin) / cellSize) * cellSize;
    const gridBottom = Math.ceil((maxY + margin) / cellSize) * cellSize;

    for (let x = gridLeft; x <= gridRight; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, gridTop);
        ctx.lineTo(x, gridBottom);
        ctx.stroke();
    }

    for (let y = gridTop; y <= gridBottom; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(gridLeft, y);
        ctx.lineTo(gridRight, y);
        ctx.stroke();
    }
}

// ============================================================================
// DRAWING FUNCTIONS
// ============================================================================

function drawStroke(stroke: Stroke, isHighlighted: boolean = false): void {
    const ctx = state.ctx!;

    // If this is a group, draw all children recursively
    if (isGroup(stroke)) {
        for (const child of stroke.strokes!) {
            drawStroke(child, isHighlighted);
        }
        return;
    }

    // Determine which points to use - fitted or original
    const pointsToUse = (stroke.showingFitted && stroke.fittedPoints) ? stroke.fittedPoints : stroke.points!;

    const minSize = screenLengthToCanvasLength(1);
    const renderSize = Math.max(stroke.size!, minSize);

    if (pointsToUse.length < 2) {
        if (pointsToUse.length === 1) {
            // Draw highlighted version first (grey outline) for single point
            if (isHighlighted) {
                ctx.fillStyle = 'lightgrey';
                ctx.beginPath();
                ctx.arc(pointsToUse[0].x, pointsToUse[0].y, renderSize * 2 / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            // Draw normal version on top
            ctx.fillStyle = stroke.color!;
            ctx.beginPath();
            ctx.arc(pointsToUse[0].x, pointsToUse[0].y, renderSize / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    // Draw highlighted version first (grey outline with 2x thickness)
    if (isHighlighted) {
        ctx.strokeStyle = 'lightgrey';
        ctx.lineWidth = renderSize * 2;
        ctx.beginPath();
        ctx.moveTo(pointsToUse[0].x, pointsToUse[0].y);
        for (let i = 1; i < pointsToUse.length; i++) {
            ctx.lineTo(pointsToUse[i].x, pointsToUse[i].y);
        }
        ctx.stroke();
    }

    // Draw normal stroke on top
    ctx.strokeStyle = stroke.color!;
    ctx.lineWidth = renderSize;
    ctx.beginPath();
    ctx.moveTo(pointsToUse[0].x, pointsToUse[0].y);

    for (let i = 1; i < pointsToUse.length; i++) {
        ctx.lineTo(pointsToUse[i].x, pointsToUse[i].y);
    }
    ctx.stroke();
}

export function redraw(): void {
    const ctx = state.ctx!;

    ctx.clearRect(0, 0, state.canvas!.width, state.canvas!.height);

    // Apply view transform
    ctx.save();
    const cx = state.canvas!.width / 2;
    const cy = state.canvas!.height / 2;
    ctx.translate(state.viewTransform.panX, state.viewTransform.panY);
    ctx.translate(cx, cy);
    ctx.rotate(state.viewTransform.rotation);
    ctx.scale(state.viewTransform.scale, state.viewTransform.scale);
    ctx.translate(-cx, -cy);

    // Draw grid if grid mode is enabled
    if (state.isGridMode) {
        drawGrid();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw completed strokes (including groups)
    state.strokeHistory.forEach((stroke, index) => {
        const isHighlighted = state.highlightedStrokes.has(index);
        drawStroke(stroke, isHighlighted);
    });

    // Draw current in-progress stroke
    if (state.currentStroke) {
        drawStroke(state.currentStroke);
    }

    ctx.restore();

    // Draw selection rectangle (in screen space, aligned to screen axes)
    if (state.selectionRectStart && state.selectionRectEnd) {
        // Convert canvas coordinates to screen coordinates
        const screenStart = canvasToScreen(state.selectionRectStart);
        const screenEnd = canvasToScreen(state.selectionRectEnd);

        // Calculate screen-aligned rectangle bounds
        const minX = Math.min(screenStart.x, screenEnd.x);
        const maxX = Math.max(screenStart.x, screenEnd.x);
        const minY = Math.min(screenStart.y, screenEnd.y);
        const maxY = Math.max(screenStart.y, screenEnd.y);

        // Draw semi-transparent rectangle
        ctx.fillStyle = 'rgba(135, 206, 250, 0.3)'; // Light blue with 30% opacity
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

        // Draw rectangle border
        ctx.strokeStyle = 'rgba(30, 144, 255, 0.8)'; // Dodger blue with 80% opacity
        ctx.lineWidth = 2;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    }

    // Update CSS cursor div position and appearance
    callbacks.updateCursorDiv();

    // Update combined picker button states
    updateCombinedPickerButtonStates();
}

function updateCombinedPickerButtonStates(): void {
    // Update grid button state
    callbacks.setPickerGridActive(state.isGridMode);

    // Update fit button state
    if (state.selectedStrokeIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length) {
        const stroke = state.strokeHistory[state.selectedStrokeIdx];
        const isFitActive = stroke.showingFitted === true;
        callbacks.setPickerFitState(true, isFitActive);
    } else {
        callbacks.setPickerFitState(false, false);
    }
}

// ============================================================================
// SELECTION RECTANGLE
// ============================================================================

export function strokeIntersectsRectangle(stroke: Stroke, rectStart: Point, rectEnd: Point): boolean {
    // If this is a group, check if any child intersects
    if (isGroup(stroke)) {
        return stroke.strokes!.some(child => strokeIntersectsRectangle(child, rectStart, rectEnd));
    }

    // Convert rectangle corners to screen space to get screen-aligned bounds
    const screenStart = canvasToScreen(rectStart);
    const screenEnd = canvasToScreen(rectEnd);

    // Get screen-aligned rectangle bounds
    const minX = Math.min(screenStart.x, screenEnd.x);
    const maxX = Math.max(screenStart.x, screenEnd.x);
    const minY = Math.min(screenStart.y, screenEnd.y);
    const maxY = Math.max(screenStart.y, screenEnd.y);

    // Check if any point in the stroke (converted to screen space) is inside the screen-aligned rectangle
    for (const point of stroke.points!) {
        const screenPoint = canvasToScreen(point);
        if (screenPoint.x >= minX && screenPoint.x <= maxX && screenPoint.y >= minY && screenPoint.y <= maxY) {
            return true;
        }
    }

    return false;
}

export function updateHighlightedStrokes(): void {
    if (!state.selectionRectStart || !state.selectionRectEnd) {
        state.highlightedStrokes.clear();
        return;
    }

    // Update the set of highlighted strokes based on current rectangle
    state.highlightedStrokes.clear();
    for (let i = 0; i < state.strokeHistory.length; i++) {
        if (strokeIntersectsRectangle(state.strokeHistory[i], state.selectionRectStart, state.selectionRectEnd)) {
            state.highlightedStrokes.add(i);
        }
    }
}

export function applyColorAndSizeToHighlightedStrokes(): void {
    if (state.highlightedStrokes.size === 0) return;

    const currentColor = callbacks.getPickerColor();
    const currentSize = callbacks.getPickerSize();

    // Apply color and size to all highlighted strokes
    for (const index of state.highlightedStrokes) {
        if (index < state.strokeHistory.length) {
            state.strokeHistory[index].color = currentColor;
            state.strokeHistory[index].size = currentSize;
        }
    }
}

// ============================================================================
// FULLSCREEN FUNCTIONS
// ============================================================================

// Detect iOS (iPhone/iPad in Safari or any iOS browser)
export function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Check if running as standalone PWA (added to home screen)
export function isStandalone(): boolean {
    return (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
}

export function updateFullscreenIcon(): void {
    const dom = state.dom;
    const isFullscreen = !!document.fullscreenElement || isStandalone();
    dom.enterFullscreenIcon!.style.display = isFullscreen ? 'none' : 'block';
    dom.exitFullscreenIcon!.style.display = isFullscreen ? 'block' : 'none';

    // Disable button when running as standalone PWA on iOS (already fullscreen, can't exit)
    if (isIOS() && isStandalone()) {
        dom.fullscreenBtn!.disabled = true;
    }
}

export function hideIosTooltip(): void {
    state.dom.iosFullscreenTooltip!.classList.remove('visible');
}

// ============================================================================
// CANVAS RESIZE
// ============================================================================

export function resizeCanvas(clampCursorToView: () => void): void {
    state.canvas!.width = window.innerWidth;
    state.canvas!.height = window.innerHeight - TOOLBAR_HEIGHT;
    clampCursorToView();
    redraw();
}
