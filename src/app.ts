import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { Event, Action } from './stateMachine';
import { Point } from './eventHandler';
import { getPathLength } from './resample';
import { fitStroke } from './shapeFitting';
import {
    state,
    initState,
    Stroke,
    StrokeSnapshot,
    USE_BATCHED_DELTA_MECHANISM,
    TOOLBAR_HEIGHT,
    getStrokeLenThreshold,
} from './state';
import {
    initPointerHandlers,
    setupPointerEventListeners,
} from './pointerHandlers';
import {
    initStrokeOperations,
    isGroup,
    forEachLeafStroke,
    transformStroke,
    updateDelButton,
    processDelete,
    processClear,
    duplicateSelectedStroke,
    groupHighlightedStrokes,
    ungroupSelectedStroke,
} from './strokeOperations';

// ============================================================================
// INITIALIZATION
// ============================================================================

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
initState(canvas);

// Aliases for frequently accessed state (for cleaner code)
const ctx = state.ctx!;
const dom = state.dom;

// ============================================================================
// STROKE HELPER FUNCTIONS (transform-related)
// ============================================================================

// Helper to get all points from a stroke (including groups) for transformation
function getAllPointsForTransform(stroke: Stroke): Point[] {
    const allPoints: Point[] = [];
    forEachLeafStroke(stroke, (leafStroke: Stroke) => {
        allPoints.push(...leafStroke.points!);
    });
    return allPoints;
}

function createStrokeSnapshot(stroke: Stroke): StrokeSnapshot[] {
    const snapshots: StrokeSnapshot[] = [];
    transformStroke(stroke, (leafStroke: Stroke) => {
        const snapshot: StrokeSnapshot = {
            points: leafStroke.points!.map(p => ({ ...p }))
        };
        if (leafStroke.fittedPoints) {
            snapshot.fittedPoints = leafStroke.fittedPoints.map(p => ({ ...p }));
        }
        if (leafStroke.originalPoints) {
            snapshot.originalPoints = leafStroke.originalPoints.map(p => ({ ...p }));
        }
        snapshots.push(snapshot);
    });
    return snapshots;
}

function applyTransformToStroke(
    stroke: Stroke,
    initialSnapshots: StrokeSnapshot[],
    center: Point,
    scaleFactor: number,
    rotationDelta: number,
    newCenter: Point
): void {
    let snapshotIndex = 0;
    transformStroke(stroke, (leafStroke: Stroke) => {
        const snapshot = initialSnapshots[snapshotIndex++];

        // Transform points
        const transformedPoints: Point[] = [];
        for (let i = 0; i < snapshot.points.length; i++) {
            const originalPoint = snapshot.points[i];
            const dx = originalPoint.x - center.x;
            const dy = originalPoint.y - center.y;

            const cos = Math.cos(rotationDelta);
            const sin = Math.sin(rotationDelta);
            const rotatedX = dx * cos - dy * sin;
            const rotatedY = dx * sin + dy * cos;

            const scaledX = rotatedX * scaleFactor;
            const scaledY = rotatedY * scaleFactor;

            transformedPoints.push({
                x: scaledX + newCenter.x,
                y: scaledY + newCenter.y
            });
        }
        leafStroke.points = transformedPoints;

        // Transform fittedPoints if they exist in snapshot
        if (snapshot.fittedPoints) {
            const transformedFittedPoints: Point[] = [];
            for (let i = 0; i < snapshot.fittedPoints.length; i++) {
                const fittedPoint = snapshot.fittedPoints[i];
                const dx = fittedPoint.x - center.x;
                const dy = fittedPoint.y - center.y;

                const cos = Math.cos(rotationDelta);
                const sin = Math.sin(rotationDelta);
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;

                const scaledX = rotatedX * scaleFactor;
                const scaledY = rotatedY * scaleFactor;

                transformedFittedPoints.push({
                    x: scaledX + newCenter.x,
                    y: scaledY + newCenter.y
                });
            }
            leafStroke.fittedPoints = transformedFittedPoints;
        }

        // Transform originalPoints if they exist in snapshot
        if (snapshot.originalPoints) {
            const transformedOriginalPoints: Point[] = [];
            for (let i = 0; i < snapshot.originalPoints.length; i++) {
                const origPoint = snapshot.originalPoints[i];
                const dx = origPoint.x - center.x;
                const dy = origPoint.y - center.y;

                const cos = Math.cos(rotationDelta);
                const sin = Math.sin(rotationDelta);
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;

                const scaledX = rotatedX * scaleFactor;
                const scaledY = rotatedY * scaleFactor;

                transformedOriginalPoints.push({
                    x: scaledX + newCenter.x,
                    y: scaledY + newCenter.y
                });
            }
            leafStroke.originalPoints = transformedOriginalPoints;
        }
    });
}

// ============================================================================
// CUSTOM UI COMPONENTS
// ============================================================================

const combinedPicker = createCombinedPicker(
    dom.combinedPickerEl!,
    (color: string) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.color = color;
                    });
                }
            }
        } else if (state.selectedStrokeIdx !== null) {
            transformStroke(state.strokeHistory[state.selectedStrokeIdx], (stroke: Stroke) => {
                stroke.color = color;
            });
        }
        redraw();
    },
    (size: number) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.size = size;
                    });
                }
            }
        } else if (state.selectedStrokeIdx !== null) {
            transformStroke(state.strokeHistory[state.selectedStrokeIdx], (stroke: Stroke) => {
                stroke.size = size;
            });
        }
        redraw();
    },
    () => {
        // Grid toggle
        state.isGridMode = !state.isGridMode;

        if (state.isGridMode && state.cursorAnchor) {
            state.cursorAnchor = snapToGrid(state.cursorAnchor);
        }
        redraw();
    },
    () => {
        // Fit button
        // Only work if a stroke is selected
        if (state.selectedStrokeIdx === null || state.selectedStrokeIdx >= state.strokeHistory.length) {
            return;
        }

        const stroke = state.strokeHistory[state.selectedStrokeIdx];

        // Determine if we're toggling ON or OFF
        const turningOn = !stroke.showingFitted;

        // If turning ON and stroke hasn't been fitted yet, or if it's a polyline/polygon
        // that was fitted with a different stroke size, fit it now
        const isSizeDependentFit = stroke.fitType === 'polyline' || stroke.fitType?.startsWith('polygon-');
        const needsRefit = !stroke.fittedPoints ||
                          (isSizeDependentFit && stroke.fittedWithSize !== stroke.size!);

        if (turningOn && needsRefit) {
            fitStroke(stroke);
        }

        // Toggle display between fitted and original
        if (stroke.fittedPoints && stroke.originalPoints) {
            stroke.showingFitted = turningOn;
        }

        redraw();
    }
);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Helper function to update color and size pickers when a stroke is selected
function updatePickersForSelectedStroke() {
    if (state.selectedStrokeIdx !== null) {
        const stroke = state.strokeHistory[state.selectedStrokeIdx];
        // For groups, get the first leaf stroke's color and size
        if (isGroup(stroke)) {
            let firstColor: string | undefined;
            let firstSize: number | undefined;
            forEachLeafStroke(stroke, (s: Stroke) => {
                if (firstColor === undefined) {
                    firstColor = s.color;
                    firstSize = s.size;
                }
            });
            if (firstColor !== undefined && firstSize !== undefined) {
                combinedPicker.setColor(firstColor);
                combinedPicker.setSize(firstSize);
            }
        } else {
            combinedPicker.setColor(stroke.color!);
            combinedPicker.setSize(stroke.size!);
        }
    }
}

function getAngle(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function getMidpoint(p1: Point, p2: Point): Point {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

function normalizeAngleDelta(delta: number): number {
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return delta;
}

function findClosestStrokeAndPoint(searchPos?: Point): { strokeIdx: number; pointIdx: number; point: Point } | null {
    if (state.strokeHistory.length === 0) {
        return null;
    }

    // Use provided search position, or fall back to cursor anchor
    const referencePos = searchPos || state.cursorAnchor;
    if (!referencePos) {
        return null;
    }

    let closestStrokeIdx = -1;
    let closestPointIdx = -1;
    let closestPointX = 0;
    let closestPointY = 0;
    let minDistanceSquared = Infinity;

    // Iterate through all strokes in history
    for (let i = 0; i < state.strokeHistory.length; i++) {
        const stroke = state.strokeHistory[i];

        // Find closest point in this stroke (or recursively in its children if it's a group)
        forEachLeafStroke(stroke, (leafStroke: Stroke) => {
            for (let j = 0; j < leafStroke.points!.length; j++) {
                const point = leafStroke.points![j];
                const dx = point.x - referencePos.x;
                const dy = point.y - referencePos.y;
                const distanceSquared = dx * dx + dy * dy;

                if (distanceSquared < minDistanceSquared) {
                    minDistanceSquared = distanceSquared;
                    closestStrokeIdx = i;
                    closestPointIdx = j;
                    closestPointX = point.x;
                    closestPointY = point.y;
                }
            }
        });
    }

    if (closestStrokeIdx === -1) {
        return null;
    }

    return {
        strokeIdx: closestStrokeIdx,
        pointIdx: closestPointIdx,
        point: { x: closestPointX, y: closestPointY }
    };
}

// ============================================================================
// COORDINATE TRANSFORMATIONS
// ============================================================================

function screenToCanvas(screenPos: Point): Point {
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

function canvasToScreen(canvasPos: Point): Point {
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
function screenDeltaToCanvasDelta(screenDelta: Point): Point {
    const cos = Math.cos(-state.viewTransform.rotation);
    const sin = Math.sin(-state.viewTransform.rotation);
    const canvasDeltaX = (cos * screenDelta.x - sin * screenDelta.y) / state.viewTransform.scale;
    const canvasDeltaY = (sin * screenDelta.x + cos * screenDelta.y) / state.viewTransform.scale;
    return { x: canvasDeltaX, y: canvasDeltaY };
}

// Convert a screen-space vector length to canvas-space vector length
// Only scale matters for lengths, not rotation or translation
function screenLengthToCanvasLength(screenLength: number): number {
    return screenLength / state.viewTransform.scale;
}

// ============================================================================
// GRID FUNCTIONS
// ============================================================================

function getGridCellSize(): number {
    const defaultStrokeSize = 6;
    return defaultStrokeSize * 4;
}

function snapToGrid(point: Point): Point {
    const cellSize = getGridCellSize();
    return {
        x: Math.round(point.x / cellSize) * cellSize,
        y: Math.round(point.y / cellSize) * cellSize
    };
}

function drawGrid() {
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
// CURSOR FUNCTIONS
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

function setCursorToDefaultPosition(screenPos: Point): void {
    const offset = getDefaultCursorOffset();
    const targetScreenPos = {
        x: screenPos.x + offset.x,
        y: screenPos.y + offset.y
    };

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(state.canvas!.width - margin, targetScreenPos.x));
    // Allow cursor to go into toolbar area (negative Y in canvas space)
    const clampedY = Math.max(-TOOLBAR_HEIGHT + margin, Math.min(state.canvas!.height - margin, targetScreenPos.y));

    state.cursorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
}

function clampCursorToView(): void {
    if (!state.cursorAnchor) return;
    const screenPos = canvasToScreen(state.cursorAnchor);

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(state.canvas!.width - margin, screenPos.x));
    // Allow cursor to go into toolbar area (negative Y in canvas space)
    const clampedY = Math.max(-TOOLBAR_HEIGHT + margin, Math.min(state.canvas!.height - margin, screenPos.y));

    if (clampedX !== screenPos.x || clampedY !== screenPos.y) {
        state.cursorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
    }
}

function panToKeepCursorInView(): void {
    if (!state.cursorAnchor) return;
    const screenPos = canvasToScreen(state.cursorAnchor);

    const margin = 10;
    const minY = -TOOLBAR_HEIGHT + margin; // Allow cursor into toolbar area
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

function getCursorScreenPos(): Point {
    if (!state.cursorAnchor) {
        return { x: state.canvas!.width / 2, y: state.canvas!.height / 4 };
    }
    return canvasToScreen(state.cursorAnchor);
}

/**
 * Get the page coordinates of the cursor tip.
 */
function getCursorPagePos(): { x: number, y: number } | null {
    if (!state.cursorAnchor) return null;
    const cursorScreenPos = getCursorScreenPos();
    return {
        x: cursorScreenPos.x,
        y: cursorScreenPos.y + TOOLBAR_HEIGHT
    };
}

/**
 * Check if the cursor tip is in the menu region (above the canvas)
 * or over a UI element like an open popup.
 */
function isCursorInMenuRegion(): boolean {
    if (!state.cursorAnchor) return false;
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
 */
function getClickableElementAtCursor(): HTMLElement | null {
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
function simulateTapAtCursor(): boolean {
    const clickable = getClickableElementAtCursor();
    if (clickable) {
        clickable.click();
        return true;
    }
    return false;
}

function updateCursorDiv(): void {
    if (!state.cursorAnchor) {
        dom.cursorDiv!.style.display = 'none';
        return;
    }

    const cursorPos = getCursorScreenPos();
    const strokeSize = combinedPicker.getSize();
    const renderedSize = Math.max(strokeSize * state.viewTransform.scale, 1);
    const drawColor = combinedPicker.getColor();
    const isWhite = drawColor.toUpperCase() === '#FFFFFF';
    const outerColor = isWhite ? 'black' : drawColor;

    // Inner ring color: lime if stroke selected, white otherwise
    const hasSelectedStroke = state.selectedStrokeIdx !== null;
    const innerColor = hasSelectedStroke ? 'lime' : 'white';

    // Scale cursor based on stroke size (base size ~48px, scales with stroke)
    // 2x larger than before
    const baseSize = 48;
    const scale = Math.max(0.5, (renderedSize + 8) / (baseSize / 2));
    const cursorSize = baseSize * scale;

    // Windows cursor arrow SVG path - tip starts at (0,0)
    // Path draws a classic Windows pointer arrow
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
    dom.cursorDiv!.style.display = 'block';
    dom.cursorDiv!.style.left = `${cursorPos.x - tipOffset}px`;
    dom.cursorDiv!.style.top = `${cursorPos.y + 60 - tipOffset}px`; // Add toolbar height
    dom.cursorDiv!.style.width = `${cursorSize}px`;
    dom.cursorDiv!.style.height = `${cursorSize * 26/17}px`;
    dom.cursorDiv!.innerHTML = svg;
}

// ============================================================================
// DRAWING FUNCTIONS
// ============================================================================

function drawStroke(stroke: Stroke, isHighlighted: boolean = false) {
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

function redraw() {
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
    updateCursorDiv();

    // Update combined picker button states
    updateCombinedPickerButtonStates();
}

function updateCombinedPickerButtonStates() {
    // Update grid button state
    combinedPicker.setGridActive(state.isGridMode);

    // Update fit button state
    if (state.selectedStrokeIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length) {
        const stroke = state.strokeHistory[state.selectedStrokeIdx];
        const isFitActive = stroke.showingFitted === true;
        combinedPicker.setFitState(true, isFitActive);
    } else {
        combinedPicker.setFitState(false, false);
    }
}

// ============================================================================
// TRANSFORM FUNCTIONS
// ============================================================================

function initThreeFingerTransform() {
    const positions = state.eventHandler.getFingerPositions();
    const fingerCount = state.eventHandler.getFingerCount();

    // 2-finger gesture: ONLY canvas zoom (never transforms selected stroke)
    // 3-finger gesture: ONLY selected stroke zoom (does nothing if no stroke selected)
    if (fingerCount === 2) {
        if (!positions.primary || !positions.secondary) return;

        // Two-finger transform - ALWAYS transforms canvas, never selected stroke
        const pivot = {
            x: (positions.primary.x + positions.secondary.x) / 2,
            y: (positions.primary.y + positions.secondary.y) / 2
        };

        const dist1 = getDistance(pivot, positions.primary);
        const dist2 = getDistance(pivot, positions.secondary);
        const initialScale = (dist1 + dist2) / 2;

        const angle1 = getAngle(pivot, positions.primary);
        const angle2 = getAngle(pivot, positions.secondary);

        state.transformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2],
            unwrappedRotation: 0,
            initialTransform: { ...state.viewTransform }
            // No strokeSnapshotsMap - 2-finger always transforms canvas
        };
    } else if (fingerCount >= 3) {
        // Three-finger transform - transforms selected stroke AND all highlighted strokes
        // Collect all stroke indices to transform
        const strokesToTransform = new Set<number>();

        // Add selected stroke if any
        if (state.selectedStrokeIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length) {
            strokesToTransform.add(state.selectedStrokeIdx);
        }

        // Add all highlighted strokes
        for (const idx of state.highlightedStrokes) {
            if (idx < state.strokeHistory.length) {
                strokesToTransform.add(idx);
            }
        }

        // If no strokes to transform, do nothing
        if (strokesToTransform.size === 0) {
            return;
        }

        if (!positions.primary || !positions.secondary || !positions.tertiary) return;

        const pivot = {
            x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
            y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
        };

        const dist1 = getDistance(pivot, positions.primary);
        const dist2 = getDistance(pivot, positions.secondary);
        const dist3 = getDistance(pivot, positions.tertiary);
        const initialScale = (dist1 + dist2 + dist3) / 3;

        const angle1 = getAngle(pivot, positions.primary);
        const angle2 = getAngle(pivot, positions.secondary);
        const angle3 = getAngle(pivot, positions.tertiary);

        // Create snapshots for all strokes and calculate combined bounding box
        const strokeSnapshotsMap = new Map<number, StrokeSnapshot[]>();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const idx of strokesToTransform) {
            const stroke = state.strokeHistory[idx];
            const snapshots = createStrokeSnapshot(stroke);
            strokeSnapshotsMap.set(idx, snapshots);

            // Update combined bounding box
            for (const snapshot of snapshots) {
                for (const point of snapshot.points) {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }
            }
        }

        const initialCombinedCenter = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };

        state.transformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2, angle3],
            unwrappedRotation: 0,
            initialTransform: { ...state.viewTransform },
            strokeSnapshotsMap,
            initialCombinedCenter
        };

        // Store transform snapshot for undo (only for selected stroke)
        if (!state.hasUndoableTransform && state.selectedStrokeIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length) {
            const allPoints = getAllPointsForTransform(state.strokeHistory[state.selectedStrokeIdx]);
            state.transformSnapshot = allPoints.map(p => ({ ...p }));
        }
    }
}

function applyThreeFingerTransform() {
    if (!state.transformStart) return;

    const positions = state.eventHandler.getFingerPositions();
    const fingerCount = state.eventHandler.getFingerCount();

    let currentPivot: Point;
    let currentScale: number;
    let averageDelta: number;

    // Support both 2-finger and 3-finger gestures
    if (fingerCount === 2 && positions.primary && positions.secondary) {
        // Two-finger transform
        currentPivot = {
            x: (positions.primary.x + positions.secondary.x) / 2,
            y: (positions.primary.y + positions.secondary.y) / 2
        };

        const dist1 = getDistance(currentPivot, positions.primary);
        const dist2 = getDistance(currentPivot, positions.secondary);
        currentScale = (dist1 + dist2) / 2;

        const angle1 = getAngle(currentPivot, positions.primary);
        const angle2 = getAngle(currentPivot, positions.secondary);

        const delta1 = normalizeAngleDelta(angle1 - state.transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - state.transformStart.fingerAngles[1]);

        averageDelta = (delta1 + delta2) / 2;
        state.transformStart.unwrappedRotation += averageDelta;

        state.transformStart.fingerAngles = [angle1, angle2];
    } else if (fingerCount >= 3 && positions.primary && positions.secondary && positions.tertiary) {
        // Three-finger transform
        currentPivot = {
            x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
            y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
        };

        const dist1 = getDistance(currentPivot, positions.primary);
        const dist2 = getDistance(currentPivot, positions.secondary);
        const dist3 = getDistance(currentPivot, positions.tertiary);
        currentScale = (dist1 + dist2 + dist3) / 3;

        const angle1 = getAngle(currentPivot, positions.primary);
        const angle2 = getAngle(currentPivot, positions.secondary);
        const angle3 = getAngle(currentPivot, positions.tertiary);

        const delta1 = normalizeAngleDelta(angle1 - state.transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - state.transformStart.fingerAngles[1]);
        const delta3 = normalizeAngleDelta(angle3 - state.transformStart.fingerAngles[2]);

        averageDelta = (delta1 + delta2 + delta3) / 3;
        state.transformStart.unwrappedRotation += averageDelta;

        state.transformStart.fingerAngles = [angle1, angle2, angle3];
    } else {
        return; // Invalid finger count
    }

    const scaleFactor = currentScale / state.transformStart.initialScale;
    const rotationDelta = state.transformStart.unwrappedRotation;

    // Gesture separation:
    // - 2-finger: ALWAYS transforms canvas (strokeSnapshotsMap is never set)
    // - 3-finger: ALWAYS transforms selected stroke + highlighted strokes (strokeSnapshotsMap is set)
    if (state.transformStart.strokeSnapshotsMap && state.transformStart.initialCombinedCenter) {
        // 3-finger transform: Transform all strokes in the map around the combined center
        const initialCenter = state.transformStart.initialCombinedCenter;

        const initialCanvasPivot = screenToCanvas(state.transformStart.pivot);
        const currentCanvasPivot = screenToCanvas(currentPivot);

        const panDeltaX = currentCanvasPivot.x - initialCanvasPivot.x;
        const panDeltaY = currentCanvasPivot.y - initialCanvasPivot.y;

        const newCenter = {
            x: initialCenter.x + panDeltaX,
            y: initialCenter.y + panDeltaY
        };

        // Apply transformation to each stroke in the map
        for (const [idx, snapshots] of state.transformStart.strokeSnapshotsMap) {
            if (idx < state.strokeHistory.length) {
                const stroke = state.strokeHistory[idx];
                applyTransformToStroke(
                    stroke,
                    snapshots,
                    initialCenter,
                    scaleFactor,
                    rotationDelta,
                    newCenter
                );
            }
        }

        // Update cursor to the transformed position of the same point on the selected stroke
        if (state.selectedStrokeIdx !== null && state.selectedStrokePointIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length) {
            const transformedPoints = getAllPointsForTransform(state.strokeHistory[state.selectedStrokeIdx]);
            if (state.selectedStrokePointIdx < transformedPoints.length) {
                state.cursorAnchor = { ...transformedPoints[state.selectedStrokePointIdx] };
            }
        }
    } else {
        // 2-finger transform: Transform the entire canvas view
        const newScale = state.transformStart.initialTransform.scale * scaleFactor;
        const newRotation = state.transformStart.initialTransform.rotation + rotationDelta;

        const startPivot = state.transformStart.pivot;
        const initT = state.transformStart.initialTransform;
        const cx = state.canvas!.width / 2;
        const cy = state.canvas!.height / 2;

        const cos0 = Math.cos(-initT.rotation);
        const sin0 = Math.sin(-initT.rotation);
        const sx1 = startPivot.x - initT.panX;
        const sy1 = startPivot.y - initT.panY;
        const sx2 = cos0 * (sx1 - cx) - sin0 * (sy1 - cy) + cx;
        const sy2 = sin0 * (sx1 - cx) + cos0 * (sy1 - cy) + cy;
        const canvasX = (sx2 - cx) / initT.scale + cx;
        const canvasY = (sy2 - cy) / initT.scale + cy;

        const cos1 = Math.cos(newRotation);
        const sin1 = Math.sin(newRotation);
        const tx1 = (canvasX - cx) * newScale + cx;
        const ty1 = (canvasY - cy) * newScale + cy;
        const tx2 = cos1 * (tx1 - cx) - sin1 * (ty1 - cy) + cx;
        const ty2 = sin1 * (tx1 - cx) + cos1 * (ty1 - cy) + cy;

        state.viewTransform.scale = newScale;
        state.viewTransform.rotation = newRotation;
        state.viewTransform.panX = currentPivot.x - tx2;
        state.viewTransform.panY = currentPivot.y - ty2;
    }
}

// ============================================================================
// SELECTION RECTANGLE
// ============================================================================

function strokeIntersectsRectangle(stroke: Stroke, rectStart: Point, rectEnd: Point): boolean {
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

function updateHighlightedStrokes(): void {
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

function applyColorAndSizeToHighlightedStrokes(): void {
    if (state.highlightedStrokes.size === 0) return;

    const currentColor = combinedPicker.getColor();
    const currentSize = combinedPicker.getSize();

    // Apply color and size to all highlighted strokes
    for (const index of state.highlightedStrokes) {
        if (index < state.strokeHistory.length) {
            state.strokeHistory[index].color = currentColor;
            state.strokeHistory[index].size = currentSize;
        }
    }
}

// ============================================================================
// CURSOR MOVEMENT
// ============================================================================

// Algorithm 1: Intricate batching mechanism
// Handles finger promotion and mode transitions with batched deltas
function updateCursorPositionWithBatching() {
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
            const canvasDelta = screenDeltaToCanvasDelta(state.batchedDelta);
            state.cursorAnchor.x += canvasDelta.x;
            state.cursorAnchor.y += canvasDelta.y;
            panToKeepCursorInView();

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
                    const canvasDelta = screenDeltaToCanvasDelta(state.lastDelta);
                    state.cursorAnchor.x += canvasDelta.x;
                    state.cursorAnchor.y += canvasDelta.y;
                    panToKeepCursorInView();

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

                    const canvasDelta = screenDeltaToCanvasDelta(avgDelta);
                    state.cursorAnchor.x += canvasDelta.x;
                    state.cursorAnchor.y += canvasDelta.y;
                    panToKeepCursorInView();

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
function updateCursorPositionSimple() {
    const positions = state.eventHandler.getFingerPositions();
    if (!state.cursorAnchor) return;

    if( !positions.primary || !positions.secondary ) return;

    // Prepare for 2-finger processing
    if( !state.lastPrimaryPos )
         state.lastPrimaryPos = positions.primary;

    if( !state.lastSecondaryPos )
         state.lastSecondaryPos = positions.secondary;

    if( !state.lastDelta )
         state.lastDelta = {x:0,y:0,pointerId:0}

    // Determine which finger moved and calculate its delta
    let movedPointerId = 0;
    let primaryDelta: Point = {x:0, y:0};
    let secondaryDelta: Point = {x:0, y:0};

    // Primary deltas
    primaryDelta.x = positions.primary.x - state.lastPrimaryPos.x;
    primaryDelta.y = positions.primary.y - state.lastPrimaryPos.y;
    if( primaryDelta.x || primaryDelta.y )
        movedPointerId += 1; // Primary finger moved

    // Secondary deltas
    secondaryDelta.x = positions.secondary.x - state.lastSecondaryPos.x;
    secondaryDelta.y = positions.secondary.y - state.lastSecondaryPos.y;
    if( secondaryDelta.x || secondaryDelta.y )
        movedPointerId += 2; // Secondary finger moved

    // "delta" will be the sum of deltas from both fingers - but only 1 should normally be non-zero...
    let delta : Point = { x:primaryDelta.x + secondaryDelta.x,
                          y:primaryDelta.y + secondaryDelta.y };

    // Lets calculate the final delta
    let finalDelta : Point = { x:0, y:0 };

    if( movedPointerId == 1 || movedPointerId == 2 ) // Only 1 finger has moved
    {
        if( movedPointerId == state.lastDelta.pointerId ) // The same finger moved as last time
        {
            // Note: if we are NOT dividing by 2 here - we get the same sensitivity
            //       for one finger as we get for two - but this is a somewhat discontinuos
            //       behavior - so we'll skip this for now (in the simple variant)
            finalDelta.x = delta.x / 2
            finalDelta.y = delta.y / 2
        }
        else  // A different finger moved compared to last time
        {
            // Divide by 4 = divide by 2 (average) × divide by 2 (we emit 2x more deltas than batched mode)
            // Unlike the batched algorithm which outputs every other delta, we output EVERY delta.
            // So when two fingers alternate at 10px each:
            //   Event A: delta=10, finalDelta=10/2=5px (same finger case above)
            //   Event B: delta=10, finalDelta=(10+10)/4=5px (this case - average with last)
            //   Total: 5+5=10px ✓ matches the speed when both fingers move together
            finalDelta.x = (delta.x + state.lastDelta.x) / 4
            finalDelta.y = (delta.y + state.lastDelta.y) / 4
        }
    }
    else
    if( movedPointerId == 3 ) // Both fingers moved - shouldn't really happen...
    {
        finalDelta.x = delta.x / 2
        finalDelta.y = delta.y / 2
    }

    // Update last positions
    state.lastPrimaryPos = positions.primary;
    state.lastSecondaryPos = positions.secondary;
    state.lastDelta = { x: delta.x, y: delta.y, pointerId: movedPointerId! };

    // Process finalDelta
    const canvasDelta = screenDeltaToCanvasDelta(finalDelta);
    state.cursorAnchor.x += canvasDelta.x;
    state.cursorAnchor.y += canvasDelta.y;
    panToKeepCursorInView();

    if (state.currentStroke && !state.isGridMode) {
        state.currentStroke.points!.push({ ...state.cursorAnchor });
    }
}

function updateCursorPosition() {
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
            const canvasDelta = screenDeltaToCanvasDelta({ x: deltaX, y: deltaY });
            state.cursorAnchor.x += canvasDelta.x;
            state.cursorAnchor.y += canvasDelta.y;
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

function addPointToStroke() {
    if (!state.currentStroke || !state.cursorAnchor) return;

    // In grid mode, only add points when moving a full cell size away
    if (state.isGridMode) {
        if (!state.lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        const cellSize = getGridCellSize();
        const threshold = cellSize * 0.9;

        const deltaFromLastX = Math.abs(state.cursorAnchor.x - state.lastGridPosition.x);
        const deltaFromLastY = Math.abs(state.cursorAnchor.y - state.lastGridPosition.y);

        if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
            const gridPoint = snapToGrid(state.cursorAnchor);

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

// ============================================================================
// ACTION HANDLERS
// ============================================================================

function handleActions(actions: Action[]): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (state.cursorAnchor) {
                    const startPoint = state.isGridMode ? snapToGrid(state.cursorAnchor) : state.cursorAnchor;
                    state.currentStroke = {
                        color: combinedPicker.getColor(),
                        size: combinedPicker.getSize(),
                        points: [{ ...startPoint }]
                    };
                    // In grid mode, initialize lastGridPosition to the start point
                    // but don't snap cursorAnchor - let it move freely
                    if (state.isGridMode) {
                        state.lastGridPosition = { ...startPoint };
                    } else {
                        state.lastGridPosition = null;
                    }
                }
                break;

            case Action.SAVE_STROKE:
                if (state.currentStroke && state.currentStroke.points!.length > 0) {
                    state.strokeHistory.push(state.currentStroke);
                    updateDelButton();
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.ABANDON_STROKE:
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.SELECT_STROKE:
                // SELECT_STROKE: Automatically select the stroke that was just drawn
                // Triggered after: Finishing a drawing (lifting second finger)
                // Behavior: Selects the last stroke in history (the one just completed)
                //           Cursor stays at its current position
                //           Marks as "fresh stroke" (Undo button will delete it)
                state.selectedStrokeCursorPos = state.cursorAnchor ? { ...state.cursorAnchor } : null;
                // Set selected stroke to the last stroke in history
                if (state.strokeHistory.length > 0) {
                    state.selectedStrokeIdx = state.strokeHistory.length - 1;
                    const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                    // Set cursor to the last point of the stroke
                    if (selectedStroke.points!.length > 0) {
                        state.selectedStrokePointIdx = selectedStroke.points!.length - 1;
                    }
                }
                // Clear transformation undo state when selecting new stroke
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // Mark as fresh stroke (just drew)
                state.isFreshStroke = true;
                updateDelButton();
                break;

            case Action.SELECT_CLOSEST_STROKE:
                // SELECT_CLOSEST_STROKE: Manually select stroke closest to cursor
                // Triggered by: Single tap (quick tap with no timeout or movement)
                // Behavior: Finds closest stroke to current cursor position
                //           Cursor jumps to the closest point on that stroke
                //           Marks as manual selection (Del button will delete it)
                //           Updates color/size pickers to match the selected stroke
                // Note: This is different from double-tap, which searches from tap location
                const closestResult = findClosestStrokeAndPoint();
                if (closestResult) {
                    // Move cursor to the closest point
                    state.cursorAnchor = closestResult.point;
                    // Select the stroke and store the point index
                    state.selectedStrokeIdx = closestResult.strokeIdx;
                    state.selectedStrokePointIdx = closestResult.pointIdx;
                    state.selectedStrokeCursorPos = { ...closestResult.point };
                    // Manual selection exits fresh stroke mode
                    state.isFreshStroke = false;
                    // Clear transformation undo state when manually selecting a stroke
                    state.transformSnapshot = null;
                    state.hasUndoableTransform = false;
                    // Update color and size pickers to match selected stroke
                    updatePickersForSelectedStroke();
                }
                updateDelButton();
                break;

            case Action.DESELECT_STROKE:
                state.selectedStrokeCursorPos = null;
                state.selectedStrokeIdx = null;
                state.selectedStrokePointIdx = null;
                // Clear transformation undo state on deselection
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // Don't change isFreshStroke - it persists through deselection
                // NOTE: Don't clearDebug() here - debug messages should persist
                updateDelButton();
                break;

            case Action.START_SELECTION_RECTANGLE:
                // Start selection rectangle at current cursor position
                if (state.cursorAnchor) {
                    state.selectionRectStart = { ...state.cursorAnchor };
                    state.selectionRectEnd = { ...state.cursorAnchor };
                    // Initialize position tracking for cursor movement
                    const positions = state.eventHandler.getFingerPositions();
                    state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
                    state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
                    // Update highlighted strokes (initially empty since single tap cleared them)
                    updateHighlightedStrokes();
                }
                break;

            case Action.UPDATE_SELECTION_RECTANGLE:
                // Update selection rectangle end point to current cursor position
                if (state.cursorAnchor && state.selectionRectStart) {
                    state.selectionRectEnd = { ...state.cursorAnchor };
                    // Update highlighted strokes in real-time
                    updateHighlightedStrokes();
                }
                break;

            case Action.APPLY_SELECTION_RECTANGLE:
                // Complete selection rectangle - keep strokes highlighted, don't apply colors yet
                state.selectionRectStart = null;
                state.selectionRectEnd = null;
                // Keep highlighted strokes (don't clear them)
                break;

            case Action.CANCEL_SELECTION_RECTANGLE:
                // Cancel selection rectangle
                state.selectionRectStart = null;
                state.selectionRectEnd = null;
                // Clear highlighted strokes
                state.highlightedStrokes.clear();
                break;

            case Action.CLEAR_HIGHLIGHTING:
                // Check if cursor is in the menu region
                if (isCursorInMenuRegion()) {
                    // Cursor is in menu region - try to tap a menu element
                    // Don't clear highlighting regardless (menu taps shouldn't affect canvas)
                    simulateTapAtCursor();
                } else {
                    // Cursor is in canvas region - clear highlighting as normal
                    state.highlightedStrokes.clear();
                }
                break;

            case Action.INIT_TRANSFORM:
                initThreeFingerTransform();
                break;

            case Action.PROCESS_DELETE:
                processDelete();
                break;

            case Action.PROCESS_CLEAR:
                processClear();
                break;

            case Action.ABORT_TOO_MANY_FINGERS:
                // Reset to idle
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.DO_NOTHING:
                // Explicitly do nothing
                break;
        }
    }
}

// ============================================================================
// STATE MACHINE EVENT CALLBACK
// ============================================================================

state.eventHandler.setEventCallback((event: Event) => {
    const result = state.stateMachine.processEvent(event);
    handleActions(result.actions);

    // Handle finger promotion discontinuity
    if (event === Event.FINGER_UP) {
        const promotionDelta = state.eventHandler.getAndClearPromotionDelta();
        if (promotionDelta) {
            // When fingers are promoted, we need to update the tracking positions
            // to match the new finger assignments, otherwise the next delta calculation
            // will use the old positions and create a jump
            const positions = state.eventHandler.getFingerPositions();
            state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
            state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
        }
    }

    redraw();
});

// ============================================================================
// CANVAS AND WINDOW
// ============================================================================

function resizeCanvas() {
    const toolbarHeight = 60;
    state.canvas!.width = window.innerWidth;
    state.canvas!.height = window.innerHeight - toolbarHeight;
    clampCursorToView();
    redraw();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Initialize stroke operations
initStrokeOperations({
    panToKeepCursorInView,
    findClosestStrokeAndPoint,
    screenToCanvas,
    updatePickersForSelectedStroke,
    redraw,
});

// Initialize and setup pointer handlers
initPointerHandlers({
    getDistance,
    isCursorInMenuRegion,
    updateCursorPosition,
    addPointToStroke,
    applyThreeFingerTransform,
    updateHighlightedStrokes,
    redraw,
    handleActions,
    clampCursorToView,
    snapToGrid,
    findClosestStrokeAndPoint,
    updateDelButton,
    updatePickersForSelectedStroke,
    isPickerOpen: () => combinedPicker.isOpen(),
    closePicker: () => combinedPicker.close(),
});
setupPointerEventListeners();

dom.delBtn!.addEventListener('click', () => state.eventHandler.handleDelete());
dom.clearBtn!.addEventListener('click', () => state.eventHandler.handleClear());

dom.btnDup!.addEventListener('click', () => {
    duplicateSelectedStroke();
});

dom.btnGroup!.addEventListener('click', () => {
    groupHighlightedStrokes();
});

dom.btnUngroup!.addEventListener('click', () => {
    ungroupSelectedStroke();
});

// Fullscreen toggle
// Detect iOS (iPhone/iPad in Safari or any iOS browser)
function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Check if running as standalone PWA (added to home screen)
function isStandalone(): boolean {
    return (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
}

function updateFullscreenIcon() {
    const isFullscreen = !!document.fullscreenElement || isStandalone();
    dom.enterFullscreenIcon!.style.display = isFullscreen ? 'none' : 'block';
    dom.exitFullscreenIcon!.style.display = isFullscreen ? 'block' : 'none';

    // Disable button when running as standalone PWA on iOS (already fullscreen, can't exit)
    if (isIOS() && isStandalone()) {
        dom.fullscreenBtn!.disabled = true;
    }
}

function hideIosTooltip() {
    dom.iosFullscreenTooltip!.classList.remove('visible');
}

dom.fullscreenBtn!.addEventListener('click', () => {
    if (isIOS() && !isStandalone()) {
        // On iOS (not in PWA mode), show the tooltip instead
        dom.iosFullscreenTooltip!.classList.toggle('visible');
    } else if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.documentElement.requestFullscreen();
    }
});

dom.iosTooltipClose!.addEventListener('click', () => {
    hideIosTooltip();
});

document.addEventListener('fullscreenchange', () => {
    updateFullscreenIcon();
    // Resize canvas after fullscreen change
    setTimeout(resizeCanvas, 100);
});

window.addEventListener('resize', resizeCanvas);

// ============================================================================
// STARTUP
// ============================================================================

resizeCanvas();
updateDelButton();
updateFullscreenIcon();
state.cursorAnchor = screenToCanvas({ x: state.canvas!.width / 2, y: state.canvas!.height / 2 });
redraw();
