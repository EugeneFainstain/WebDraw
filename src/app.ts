import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { StateMachine, State, Event, Action, TransitionResult } from './stateMachine';
import { EventHandler, Point } from './eventHandler';
import { resampleStroke, getPathLength } from './resample';
import { fitCircle, generateCirclePoints, isMostlyClosed } from './fitters/circleFitter';
import { fitEllipse, generateEllipsePoints } from './fitters/ellipseFitter';
import { fitSquare, fitSquareConstrained, generateRectanglePoints } from './fitters/squareFitter';
import { fitPolyline, generatePolylinePoints } from './fitters/polylineFitter';
import { fitEquilateralPolygon, generateEquilateralPolygonPoints } from './fitters/equilateralPolygonFitter';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Two-finger drawing mode: control delta averaging behavior
// true = Use intricate batching mechanism (handles finger promotion, mode transitions)
// false = Simple averaging of every 2 consecutive deltas (regardless of finger ID)
const USE_BATCHED_DELTA_MECHANISM = false; //true;

// Stroke length threshold for locking two-finger gesture as drawing (in millimeters)
// Once a stroke reaches this length, it's locked as a drawing gesture and won't
// be converted to a zoom/pan/rotate gesture even if fingers start pinching
const STROKE_LEN_THRESHOLD_MM = 4; // mm - same as MOVEMENT_THRESHOLD_MM in eventHandler.ts

// Convert millimeters to screen pixels based on device DPI
// Assumes 96 DPI as default (standard for web), adjusted by devicePixelRatio
// 1 inch = 25.4 mm, so pixels = (mm / 25.4) * DPI * devicePixelRatio
function mmToPixels(mm: number): number {
    const dpi = 96; // Standard web DPI
    const pixelRatio = window.devicePixelRatio || 1;
    return (mm / 25.4) * dpi * pixelRatio;
}

const STROKE_LEN_THRESHOLD = mmToPixels(STROKE_LEN_THRESHOLD_MM); // pixels

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const combinedPickerEl = document.getElementById('combinedPicker') as HTMLElement;
const delBtn = document.getElementById('delBtn') as HTMLButtonElement;
const undoIcon = document.getElementById('undoIcon') as unknown as SVGElement;
const deleteIcon = document.getElementById('deleteIcon') as unknown as SVGElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const btnDup = document.getElementById('btnDup') as HTMLButtonElement;
const btnGroup = document.getElementById('btnGroup') as HTMLButtonElement;
const btnUngroup = document.getElementById('btnUngroup') as HTMLButtonElement;
const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement;
const enterFullscreenIcon = document.getElementById('enterFullscreenIcon') as unknown as SVGElement;
const exitFullscreenIcon = document.getElementById('exitFullscreenIcon') as unknown as SVGElement;
const iosFullscreenTooltip = document.getElementById('iosFullscreenTooltip') as HTMLElement;
const iosTooltipClose = document.getElementById('iosTooltipClose') as HTMLButtonElement;
const debugOverlay = document.getElementById('debugOverlay') as HTMLElement;
const cursorDiv = document.getElementById('cursorDiv') as HTMLElement;

// Debug helper
let debugMessages: string[] = [];
function showDebug(message: string) {
    debugMessages.push(message);
    debugOverlay.textContent = debugMessages.join('\n---\n');
    debugOverlay.style.display = 'block';
}

function clearDebug() {
    debugOverlay.style.display = 'none';
    debugMessages = [];
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface Stroke {
    color?: string;               // Color (undefined for groups)
    size?: number;                // Size (undefined for groups)
    points?: Point[];             // Currently displayed points (undefined for groups)
    originalPoints?: Point[];     // Original hand-drawn points
    fittedPoints?: Point[];       // Fitted analytical curve points
    fitType?: string;             // Type of fit: 'circle', 'ellipse', 'line', etc.
    showingFitted?: boolean;      // True if currently showing fitted version
    fittedWithSize?: number;      // Stroke size used when fitting (for polylines)
    strokes?: Stroke[];           // Child strokes (if this is a group)
}

// Helper to check if a stroke is a group
function isGroup(stroke: Stroke): boolean {
    return stroke.strokes !== undefined && stroke.strokes.length > 0;
}

// Helper functions for working with hierarchical strokes

function forEachLeafStroke(stroke: Stroke, callback: (s: Stroke) => void): void {
    if (isGroup(stroke)) {
        for (const child of stroke.strokes!) {
            forEachLeafStroke(child, callback);
        }
    } else {
        callback(stroke);
    }
}

function transformStroke(stroke: Stroke, transformFunc: (s: Stroke) => void): void {
    if (isGroup(stroke)) {
        for (const child of stroke.strokes!) {
            transformStroke(child, transformFunc);
        }
    } else {
        transformFunc(stroke);
    }
}

function cloneStroke(stroke: Stroke): Stroke {
    if (isGroup(stroke)) {
        return {
            strokes: stroke.strokes!.map(child => cloneStroke(child))
        };
    } else {
        const cloned: Stroke = {
            color: stroke.color!,
            size: stroke.size!,
            points: stroke.points!.map(p => ({ ...p }))
        };
        if (stroke.originalPoints) {
            cloned.originalPoints = stroke.originalPoints.map(p => ({ ...p }));
        }
        if (stroke.fittedPoints) {
            cloned.fittedPoints = stroke.fittedPoints.map(p => ({ ...p }));
        }
        if (stroke.fitType) {
            cloned.fitType = stroke.fitType;
        }
        if (stroke.showingFitted !== undefined) {
            cloned.showingFitted = stroke.showingFitted;
        }
        if (stroke.fittedWithSize !== undefined) {
            cloned.fittedWithSize = stroke.fittedWithSize;
        }
        return cloned;
    }
}

// Helper to get all points from a stroke (including groups) for transformation
function getAllPointsForTransform(stroke: Stroke): Point[] {
    const allPoints: Point[] = [];
    forEachLeafStroke(stroke, (leafStroke: Stroke) => {
        allPoints.push(...leafStroke.points!);
    });
    return allPoints;
}

// Helper to apply transformation to all points in a stroke (including groups)
// Store initial state of all point arrays for a stroke
interface StrokeSnapshot {
    points: Point[];
    fittedPoints?: Point[];
    originalPoints?: Point[];
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
// STATE MACHINE AND EVENT HANDLER
// ============================================================================

const stateMachine = new StateMachine();
const eventHandler = new EventHandler();

// ============================================================================
// APPLICATION STATE
// ============================================================================

// History for undo functionality (strokes can be hierarchical/grouped)
let strokeHistory: Stroke[] = [];

// Current stroke being drawn
let currentStroke: Stroke | null = null;

// Cursor anchor point (in canvas coordinates)
let cursorAnchor: Point | null = null;

// Selected stroke index (null = no selection, number = index in strokeHistory)
let selectedStrokeIdx: number | null = null;

// Index of the point within the selected stroke where the cursor is positioned
let selectedStrokePointIdx: number | null = null;

// Reference position for selected stroke tracking
let selectedStrokeCursorPos: Point | null = null;

// Track if we're in "fresh stroke" mode (just drew, not manually selected)
let isFreshStroke: boolean = false;

// Track transformation undo state
let transformSnapshot: Point[] | null = null;  // Original points before transformation
let hasUndoableTransform: boolean = false;     // True if selected stroke has been transformed

// Track last grid position for grid mode
let lastGridPosition: Point | null = null;

// Grid mode state
let isGridMode: boolean = false;

// Selection rectangle state
let selectionRectStart: Point | null = null;
let selectionRectEnd: Point | null = null;

// Highlighted strokes (indices of strokes currently highlighted by selection rectangle)
let highlightedStrokes: Set<number> = new Set();

// View transform (for 3-finger canvas transformation)
let viewTransform = {
    scale: 1,
    rotation: 0,  // in radians
    panX: 0,
    panY: 0
};

// Transform state for 3-finger gesture
let transformStart: {
    pivot: Point;
    initialScale: number;
    fingerAngles: number[];
    unwrappedRotation: number;
    initialTransform: typeof viewTransform;
    initialStrokeSnapshots?: StrokeSnapshot[];  // For selected stroke transformation
} | null = null;

// Movement tracking for continuous updates
let lastPrimaryPos: Point | null = null;
let lastSecondaryPos: Point | null = null;
let lastDelta: { x: number, y: number, pointerId: number } | null = null;
let batchedDelta: { x: number, y: number } | null = null;

// Double-tap detection for stroke selection
let firstTapDownTime = 0;
let firstTapDownPos: Point | null = null;
let firstTapUpTime = 0;
let secondTapDownTime = 0;
let secondTapDownPos: Point | null = null;
let isTrackingDoubleTap = false; // True when we're waiting to see if second tap completes
const DOUBLE_TAP_DELAY = 300; // ms - max time between first lift and second down
const DOUBLE_TAP_MAX_DURATION = 200; // ms - max time the second tap can be held before it's not a tap
const DOUBLE_TAP_DISTANCE = 50; // pixels - max distance between taps

// ============================================================================
// CUSTOM UI COMPONENTS
// ============================================================================

const combinedPicker = createCombinedPicker(
    combinedPickerEl,
    (color: string) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (highlightedStrokes.size > 0) {
            for (const index of highlightedStrokes) {
                if (index < strokeHistory.length) {
                    transformStroke(strokeHistory[index], (stroke: Stroke) => {
                        stroke.color = color;
                    });
                }
            }
        } else if (selectedStrokeIdx !== null) {
            transformStroke(strokeHistory[selectedStrokeIdx], (stroke: Stroke) => {
                stroke.color = color;
            });
        }
        redraw();
    },
    (size: number) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (highlightedStrokes.size > 0) {
            for (const index of highlightedStrokes) {
                if (index < strokeHistory.length) {
                    transformStroke(strokeHistory[index], (stroke: Stroke) => {
                        stroke.size = size;
                    });
                }
            }
        } else if (selectedStrokeIdx !== null) {
            transformStroke(strokeHistory[selectedStrokeIdx], (stroke: Stroke) => {
                stroke.size = size;
            });
        }
        redraw();
    },
    () => {
        // Grid toggle
        isGridMode = !isGridMode;

        if (isGridMode && cursorAnchor) {
            cursorAnchor = snapToGrid(cursorAnchor);
        }
        redraw();
    },
    () => {
        // Fit button
        // Only work if a stroke is selected
        if (selectedStrokeIdx === null || selectedStrokeIdx >= strokeHistory.length) {
            return;
        }

        const stroke = strokeHistory[selectedStrokeIdx];

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
    if (selectedStrokeIdx !== null) {
        const stroke = strokeHistory[selectedStrokeIdx];
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
    if (strokeHistory.length === 0) {
        return null;
    }

    // Use provided search position, or fall back to cursor anchor
    const referencePos = searchPos || cursorAnchor;
    if (!referencePos) {
        return null;
    }

    let closestStrokeIdx = -1;
    let closestPointIdx = -1;
    let closestPointX = 0;
    let closestPointY = 0;
    let minDistanceSquared = Infinity;

    // Iterate through all strokes in history
    for (let i = 0; i < strokeHistory.length; i++) {
        const stroke = strokeHistory[i];

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
    const cos = Math.cos(-viewTransform.rotation);
    const sin = Math.sin(-viewTransform.rotation);

    const x1 = screenPos.x - viewTransform.panX;
    const y1 = screenPos.y - viewTransform.panY;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    const x3 = (x2 - cx) / viewTransform.scale + cx;
    const y3 = (y2 - cy) / viewTransform.scale + cy;

    return { x: x3, y: y3 };
}

function canvasToScreen(canvasPos: Point): Point {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const x1 = (canvasPos.x - cx) * viewTransform.scale + cx;
    const y1 = (canvasPos.y - cy) * viewTransform.scale + cy;

    const cos = Math.cos(viewTransform.rotation);
    const sin = Math.sin(viewTransform.rotation);
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    const x3 = x2 + viewTransform.panX;
    const y3 = y2 + viewTransform.panY;

    return { x: x3, y: y3 };
}

// Transform a delta/vector from screen space to canvas space
// Deltas only need rotation and scale, no translation
function screenDeltaToCanvasDelta(screenDelta: Point): Point {
    const cos = Math.cos(-viewTransform.rotation);
    const sin = Math.sin(-viewTransform.rotation);
    const canvasDeltaX = (cos * screenDelta.x - sin * screenDelta.y) / viewTransform.scale;
    const canvasDeltaY = (sin * screenDelta.x + cos * screenDelta.y) / viewTransform.scale;
    return { x: canvasDeltaX, y: canvasDeltaY };
}

// Convert a screen-space vector length to canvas-space vector length
// Only scale matters for lengths, not rotation or translation
function screenLengthToCanvasLength(screenLength: number): number {
    return screenLength / viewTransform.scale;
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
    const topRight = screenToCanvas({ x: canvas.width, y: 0 });
    const bottomLeft = screenToCanvas({ x: 0, y: canvas.height });
    const bottomRight = screenToCanvas({ x: canvas.width, y: canvas.height });

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
    const maxDim = Math.max(canvas.width, canvas.height);
    const offset = maxDim / 8;
    const diagonalOffset = offset / Math.SQRT2;
    return {
        x: -diagonalOffset,
        y: -diagonalOffset
    };
}

// Toolbar height - cursor can extend into this area
const TOOLBAR_HEIGHT = 60;

function setCursorToDefaultPosition(screenPos: Point): void {
    const offset = getDefaultCursorOffset();
    const targetScreenPos = {
        x: screenPos.x + offset.x,
        y: screenPos.y + offset.y
    };

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, targetScreenPos.x));
    // Allow cursor to go into toolbar area (negative Y in canvas space)
    const clampedY = Math.max(-TOOLBAR_HEIGHT + margin, Math.min(canvas.height - margin, targetScreenPos.y));

    cursorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
}

function clampCursorToView(): void {
    if (!cursorAnchor) return;
    const screenPos = canvasToScreen(cursorAnchor);

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, screenPos.x));
    // Allow cursor to go into toolbar area (negative Y in canvas space)
    const clampedY = Math.max(-TOOLBAR_HEIGHT + margin, Math.min(canvas.height - margin, screenPos.y));

    if (clampedX !== screenPos.x || clampedY !== screenPos.y) {
        cursorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
    }
}

function panToKeepCursorInView(): void {
    if (!cursorAnchor) return;
    const screenPos = canvasToScreen(cursorAnchor);

    const margin = 10;
    const minY = -TOOLBAR_HEIGHT + margin; // Allow cursor into toolbar area
    let panDeltaX = 0;
    let panDeltaY = 0;

    if (screenPos.x < margin) {
        panDeltaX = margin - screenPos.x;
    } else if (screenPos.x > canvas.width - margin) {
        panDeltaX = (canvas.width - margin) - screenPos.x;
    }

    if (screenPos.y < minY) {
        panDeltaY = minY - screenPos.y;
    } else if (screenPos.y > canvas.height - margin) {
        panDeltaY = (canvas.height - margin) - screenPos.y;
    }

    if (panDeltaX !== 0 || panDeltaY !== 0) {
        viewTransform.panX += panDeltaX;
        viewTransform.panY += panDeltaY;
    }
}

function getCursorScreenPos(): Point {
    if (!cursorAnchor) {
        return { x: canvas.width / 2, y: canvas.height / 4 };
    }
    return canvasToScreen(cursorAnchor);
}

/**
 * Get the page coordinates of the cursor tip.
 */
function getCursorPagePos(): { x: number, y: number } | null {
    if (!cursorAnchor) return null;
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
    if (!cursorAnchor) return false;
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
    if (!cursorAnchor) {
        cursorDiv.style.display = 'none';
        return;
    }

    const cursorPos = getCursorScreenPos();
    const strokeSize = combinedPicker.getSize();
    const renderedSize = Math.max(strokeSize * viewTransform.scale, 1);
    const drawColor = combinedPicker.getColor();
    const isWhite = drawColor.toUpperCase() === '#FFFFFF';
    const outerColor = isWhite ? 'black' : drawColor;

    // Inner ring color: lime if stroke selected, white otherwise
    const hasSelectedStroke = selectedStrokeIdx !== null;
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
    cursorDiv.style.display = 'block';
    cursorDiv.style.left = `${cursorPos.x - tipOffset}px`;
    cursorDiv.style.top = `${cursorPos.y + 60 - tipOffset}px`; // Add toolbar height
    cursorDiv.style.width = `${cursorSize}px`;
    cursorDiv.style.height = `${cursorSize * 26/17}px`;
    cursorDiv.innerHTML = svg;
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply view transform
    ctx.save();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.translate(viewTransform.panX, viewTransform.panY);
    ctx.translate(cx, cy);
    ctx.rotate(viewTransform.rotation);
    ctx.scale(viewTransform.scale, viewTransform.scale);
    ctx.translate(-cx, -cy);

    // Draw grid if grid mode is enabled
    if (isGridMode) {
        drawGrid();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw completed strokes (including groups)
    strokeHistory.forEach((stroke, index) => {
        const isHighlighted = highlightedStrokes.has(index);
        drawStroke(stroke, isHighlighted);
    });

    // Draw current in-progress stroke
    if (currentStroke) {
        drawStroke(currentStroke);
    }

    ctx.restore();

    // Draw selection rectangle (in screen space, aligned to screen axes)
    if (selectionRectStart && selectionRectEnd) {
        // Convert canvas coordinates to screen coordinates
        const screenStart = canvasToScreen(selectionRectStart);
        const screenEnd = canvasToScreen(selectionRectEnd);

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
    combinedPicker.setGridActive(isGridMode);

    // Update fit button state
    if (selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
        const stroke = strokeHistory[selectedStrokeIdx];
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
    const positions = eventHandler.getFingerPositions();
    const fingerCount = eventHandler.getFingerCount();

    // Support both 2-finger and 3-finger gestures
    if (fingerCount === 2) {
        if (!positions.primary || !positions.secondary) return;

        // Two-finger transform
        const pivot = {
            x: (positions.primary.x + positions.secondary.x) / 2,
            y: (positions.primary.y + positions.secondary.y) / 2
        };

        const dist1 = getDistance(pivot, positions.primary);
        const dist2 = getDistance(pivot, positions.secondary);
        const initialScale = (dist1 + dist2) / 2;

        const angle1 = getAngle(pivot, positions.primary);
        const angle2 = getAngle(pivot, positions.secondary);

        const baseTransformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2],
            unwrappedRotation: 0,
            initialTransform: { ...viewTransform }
        };

        // If a stroke is selected, store initial stroke points for transformation
        if (selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
            const selectedStroke = strokeHistory[selectedStrokeIdx];
            const strokeSnapshots = createStrokeSnapshot(selectedStroke);
            transformStart = {
                ...baseTransformStart,
                initialStrokeSnapshots: strokeSnapshots
            };

            if (!hasUndoableTransform) {
                const allPoints = getAllPointsForTransform(selectedStroke);
                transformSnapshot = allPoints.map(p => ({ ...p }));
            }
        } else {
            transformStart = baseTransformStart;
        }
    } else if (fingerCount >= 3) {
        if (!positions.primary || !positions.secondary || !positions.tertiary) return;

        // Three-finger transform
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

        const baseTransformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2, angle3],
            unwrappedRotation: 0,
            initialTransform: { ...viewTransform }
        };

        // If a stroke is selected, store initial stroke points for transformation
        if (selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
            const selectedStroke = strokeHistory[selectedStrokeIdx];
            const strokeSnapshots = createStrokeSnapshot(selectedStroke);
            transformStart = {
                ...baseTransformStart,
                initialStrokeSnapshots: strokeSnapshots
            };

            if (!hasUndoableTransform) {
                const allPoints = getAllPointsForTransform(selectedStroke);
                transformSnapshot = allPoints.map(p => ({ ...p }));
            }
        } else {
            transformStart = baseTransformStart;
        }
    }
}

function applyThreeFingerTransform() {
    if (!transformStart) return;

    const positions = eventHandler.getFingerPositions();
    const fingerCount = eventHandler.getFingerCount();

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

        const delta1 = normalizeAngleDelta(angle1 - transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - transformStart.fingerAngles[1]);

        averageDelta = (delta1 + delta2) / 2;
        transformStart.unwrappedRotation += averageDelta;

        transformStart.fingerAngles = [angle1, angle2];
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

        const delta1 = normalizeAngleDelta(angle1 - transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - transformStart.fingerAngles[1]);
        const delta3 = normalizeAngleDelta(angle3 - transformStart.fingerAngles[2]);

        averageDelta = (delta1 + delta2 + delta3) / 3;
        transformStart.unwrappedRotation += averageDelta;

        transformStart.fingerAngles = [angle1, angle2, angle3];
    } else {
        return; // Invalid finger count
    }

    const scaleFactor = currentScale / transformStart.initialScale;
    const rotationDelta = transformStart.unwrappedRotation;

    // Check if we're transforming a selected stroke or the entire canvas
    if (transformStart.initialStrokeSnapshots && selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
        // Transform only the selected stroke (works for both single strokes and groups)
        const selectedStroke = strokeHistory[selectedStrokeIdx];

        // Calculate bounding box from all points in the snapshots
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const snapshot of transformStart.initialStrokeSnapshots) {
            for (const point of snapshot.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }
        const initialStrokeCenter = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };

        const initialCanvasPivot = screenToCanvas(transformStart.pivot);
        const currentCanvasPivot = screenToCanvas(currentPivot);

        const panDeltaX = currentCanvasPivot.x - initialCanvasPivot.x;
        const panDeltaY = currentCanvasPivot.y - initialCanvasPivot.y;

        const newStrokeCenter = {
            x: initialStrokeCenter.x + panDeltaX,
            y: initialStrokeCenter.y + panDeltaY
        };

        // Apply transformation to all points in the stroke (handles groups recursively)
        applyTransformToStroke(
            selectedStroke,
            transformStart.initialStrokeSnapshots,
            initialStrokeCenter,
            scaleFactor,
            rotationDelta,
            newStrokeCenter
        );

        // Update cursor to the transformed position of the same point
        if (selectedStrokePointIdx !== null) {
            const transformedPoints = getAllPointsForTransform(selectedStroke);
            if (selectedStrokePointIdx < transformedPoints.length) {
                cursorAnchor = { ...transformedPoints[selectedStrokePointIdx] };
            }
        }
    } else {
        // Transform the entire canvas view
        const newScale = transformStart.initialTransform.scale * scaleFactor;
        const newRotation = transformStart.initialTransform.rotation + rotationDelta;

        const startPivot = transformStart.pivot;
        const initT = transformStart.initialTransform;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

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

        viewTransform.scale = newScale;
        viewTransform.rotation = newRotation;
        viewTransform.panX = currentPivot.x - tx2;
        viewTransform.panY = currentPivot.y - ty2;
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
    if (!selectionRectStart || !selectionRectEnd) {
        highlightedStrokes.clear();
        return;
    }

    // Update the set of highlighted strokes based on current rectangle
    highlightedStrokes.clear();
    for (let i = 0; i < strokeHistory.length; i++) {
        if (strokeIntersectsRectangle(strokeHistory[i], selectionRectStart, selectionRectEnd)) {
            highlightedStrokes.add(i);
        }
    }
}

function applyColorAndSizeToHighlightedStrokes(): void {
    if (highlightedStrokes.size === 0) return;

    const currentColor = combinedPicker.getColor();
    const currentSize = combinedPicker.getSize();

    // Apply color and size to all highlighted strokes
    for (const index of highlightedStrokes) {
        if (index < strokeHistory.length) {
            strokeHistory[index].color = currentColor;
            strokeHistory[index].size = currentSize;
        }
    }
}

// ============================================================================
// CURSOR MOVEMENT
// ============================================================================

// Algorithm 1: Intricate batching mechanism
// Handles finger promotion and mode transitions with batched deltas
function updateCursorPositionWithBatching() {
    const positions = eventHandler.getFingerPositions();
    if (!cursorAnchor) return;

    // Determine which finger moved
    let movedPointerId: number | null = null;
    let deltaX = 0;
    let deltaY = 0;

    if (positions.primary && lastPrimaryPos) {
        const primaryDeltaX = positions.primary.x - lastPrimaryPos.x;
        const primaryDeltaY = positions.primary.y - lastPrimaryPos.y;
        if (primaryDeltaX !== 0 || primaryDeltaY !== 0) {
            deltaX = primaryDeltaX;
            deltaY = primaryDeltaY;
            movedPointerId = 1; // Primary finger
        }
    }

    if (positions.secondary && lastSecondaryPos) {
        const secondaryDeltaX = positions.secondary.x - lastSecondaryPos.x;
        const secondaryDeltaY = positions.secondary.y - lastSecondaryPos.y;
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
    lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
    lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;

    // Two-finger mode: buffer and average alternating finger movements
    if (positions.primary && positions.secondary) {
        // Process batched delta first
        if (batchedDelta !== null) {
            const canvasDelta = screenDeltaToCanvasDelta(batchedDelta);
            cursorAnchor.x += canvasDelta.x;
            cursorAnchor.y += canvasDelta.y;
            panToKeepCursorInView();

            if (currentStroke && !isGridMode) {
                currentStroke.points!.push({ ...cursorAnchor });
            }

            batchedDelta = null;
        }

        // Process current delta with lastDelta buffering
        if (deltaX !== 0 || deltaY !== 0 && movedPointerId !== null) {
            if (lastDelta !== null) {
                const sameFingerTwice = (lastDelta.pointerId === movedPointerId);

                if (sameFingerTwice) {
                    // Same finger moved twice - process first delta immediately
                    const canvasDelta = screenDeltaToCanvasDelta(lastDelta);
                    cursorAnchor.x += canvasDelta.x;
                    cursorAnchor.y += canvasDelta.y;
                    panToKeepCursorInView();

                    if (currentStroke && !isGridMode) {
                        currentStroke.points!.push({ ...cursorAnchor });
                    }

                    // Store current delta for next iteration
                    lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
                } else {
                    // Different fingers - average them
                    const avgDelta = {
                        x: (lastDelta.x + deltaX) / 2,
                        y: (lastDelta.y + deltaY) / 2
                    };

                    const canvasDelta = screenDeltaToCanvasDelta(avgDelta);
                    cursorAnchor.x += canvasDelta.x;
                    cursorAnchor.y += canvasDelta.y;
                    panToKeepCursorInView();

                    if (currentStroke && !isGridMode) {
                        currentStroke.points!.push({ ...cursorAnchor });
                    }

                    // Clear the buffer
                    lastDelta = null;
                }
            } else {
                // First delta - buffer it and wait for next
                lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
            }
        }
    }
}

// Algorithm 2: Simple averaging mechanism
// Every delta produces movement - averaged with last delta from OTHER finger, or halved if same finger
function updateCursorPositionSimple() {
    const positions = eventHandler.getFingerPositions();
    if (!cursorAnchor) return;

    if( !positions.primary || !positions.secondary ) return;

    // Prepare for 2-finger processing
    if( !lastPrimaryPos )
         lastPrimaryPos = positions.primary;

    if( !lastSecondaryPos )
         lastSecondaryPos = positions.secondary;

    if( !lastDelta )
         lastDelta = {x:0,y:0,pointerId:0}

    // Determine which finger moved and calculate its delta
    let movedPointerId = 0;
    let primaryDelta: Point = {x:0, y:0};
    let secondaryDelta: Point = {x:0, y:0};

    // Primary deltas
    primaryDelta.x = positions.primary.x - lastPrimaryPos.x;
    primaryDelta.y = positions.primary.y - lastPrimaryPos.y;
    if( primaryDelta.x || primaryDelta.y )
        movedPointerId += 1; // Primary finger moved

    // Secondary deltas
    secondaryDelta.x = positions.secondary.x - lastSecondaryPos.x;
    secondaryDelta.y = positions.secondary.y - lastSecondaryPos.y;
    if( secondaryDelta.x || secondaryDelta.y )
        movedPointerId += 2; // Secondary finger moved

    // "delta" will be the sum of deltas from both fingers - but only 1 should normally be non-zero...
    let delta : Point = { x:primaryDelta.x + secondaryDelta.x,
                          y:primaryDelta.y + secondaryDelta.y };

    // Lets calculate the final delta
    let finalDelta : Point = { x:0, y:0 };

    if( movedPointerId == 1 || movedPointerId == 2 ) // Only 1 finger has moved
    {
        if( movedPointerId == lastDelta.pointerId ) // The same finger moved as last time
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
            finalDelta.x = (delta.x + lastDelta.x) / 4
            finalDelta.y = (delta.y + lastDelta.y) / 4
        }
    }
    else
    if( movedPointerId == 3 ) // Both fingers moved - shouldn't really happen...
    {
        finalDelta.x = delta.x / 2
        finalDelta.y = delta.y / 2
    }

    // Update last positions
    lastPrimaryPos = positions.primary;
    lastSecondaryPos = positions.secondary;
    lastDelta = { x: delta.x, y: delta.y, pointerId: movedPointerId! };    

    // Process finalDelta
    const canvasDelta = screenDeltaToCanvasDelta(finalDelta);
    cursorAnchor.x += canvasDelta.x;
    cursorAnchor.y += canvasDelta.y;
    panToKeepCursorInView();

    if (currentStroke && !isGridMode) {
        currentStroke.points!.push({ ...cursorAnchor });
    }
}

function updateCursorPosition() {
    const positions = eventHandler.getFingerPositions();
    if (!cursorAnchor) return;

    // Single finger mode - handle directly without algorithm complexity
    if (!positions.secondary) {
        // Calculate delta
        let deltaX = 0;
        let deltaY = 0;

        if (positions.primary && lastPrimaryPos) {
            deltaX = positions.primary.x - lastPrimaryPos.x;
            deltaY = positions.primary.y - lastPrimaryPos.y;
        }

        // Update last position
        lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
        lastSecondaryPos = null;

        // Process delta immediately
        if (deltaX !== 0 || deltaY !== 0) {
            const canvasDelta = screenDeltaToCanvasDelta({ x: deltaX, y: deltaY });
            cursorAnchor.x += canvasDelta.x;
            cursorAnchor.y += canvasDelta.y;
            panToKeepCursorInView();
        }

        lastDelta = null;
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
    if (!currentStroke || !cursorAnchor) return;

    // In grid mode, only add points when moving a full cell size away
    if (isGridMode) {
        if (!lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        const cellSize = getGridCellSize();
        const threshold = cellSize * 0.9;

        const deltaFromLastX = Math.abs(cursorAnchor.x - lastGridPosition.x);
        const deltaFromLastY = Math.abs(cursorAnchor.y - lastGridPosition.y);

        if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
            const gridPoint = snapToGrid(cursorAnchor);

            // Add 9 interpolated points between last grid position and new grid point
            const numInterpolated = 9;
            for (let i = 1; i <= numInterpolated; i++) {
                const t = i / (numInterpolated + 1);
                const interpPoint = {
                    x: lastGridPosition.x + t * (gridPoint.x - lastGridPosition.x),
                    y: lastGridPosition.y + t * (gridPoint.y - lastGridPosition.y)
                };
                currentStroke.points!.push(interpPoint);
            }

            // Add the actual grid point
            currentStroke.points!.push(gridPoint);
            lastGridPosition = gridPoint;
            // Snap the cursor to the grid point while drawing
            cursorAnchor = { ...gridPoint };
        }
    } else {
        // Normal mode: add every point
        currentStroke.points!.push({ ...cursorAnchor });
    }

    // Check if stroke is long enough to lock the gesture as drawing
    // This prevents the stroke from being abandoned if a pinch gesture is detected
    if (currentStroke.points && currentStroke.points.length > 1 && !eventHandler.isGestureLockedAsDrawing()) {
        const strokeLength = getPathLength(currentStroke.points);
        // Convert threshold from screen-space to canvas-space by dividing by current zoom scale
        // When zoomed in (scale > 1), the threshold in canvas units becomes smaller
        // When zoomed out (scale < 1), the threshold in canvas units becomes larger
        const canvasSpaceThreshold = STROKE_LEN_THRESHOLD / viewTransform.scale;
        if (strokeLength >= canvasSpaceThreshold) {
            eventHandler.lockGestureAsDrawing();
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
                if (cursorAnchor) {
                    const startPoint = isGridMode ? snapToGrid(cursorAnchor) : cursorAnchor;
                    currentStroke = {
                        color: combinedPicker.getColor(),
                        size: combinedPicker.getSize(),
                        points: [{ ...startPoint }]
                    };
                    // In grid mode, initialize lastGridPosition to the start point
                    // but don't snap cursorAnchor - let it move freely
                    if (isGridMode) {
                        lastGridPosition = { ...startPoint };
                    } else {
                        lastGridPosition = null;
                    }
                }
                break;

            case Action.SAVE_STROKE:
                if (currentStroke && currentStroke.points!.length > 0) {
                    strokeHistory.push(currentStroke);
                    updateDelButton();
                }
                currentStroke = null;
                lastGridPosition = null;
                break;

            case Action.ABANDON_STROKE:
                currentStroke = null;
                lastGridPosition = null;
                break;

            case Action.SELECT_STROKE:
                // SELECT_STROKE: Automatically select the stroke that was just drawn
                // Triggered after: Finishing a drawing (lifting second finger)
                // Behavior: Selects the last stroke in history (the one just completed)
                //           Cursor stays at its current position
                //           Marks as "fresh stroke" (Undo button will delete it)
                selectedStrokeCursorPos = cursorAnchor ? { ...cursorAnchor } : null;
                // Set selected stroke to the last stroke in history
                if (strokeHistory.length > 0) {
                    selectedStrokeIdx = strokeHistory.length - 1;
                    const selectedStroke = strokeHistory[selectedStrokeIdx];
                    // Set cursor to the last point of the stroke
                    if (selectedStroke.points!.length > 0) {
                        selectedStrokePointIdx = selectedStroke.points!.length - 1;
                    }
                }
                // Clear transformation undo state when selecting new stroke
                transformSnapshot = null;
                hasUndoableTransform = false;
                // Mark as fresh stroke (just drew)
                isFreshStroke = true;
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
                    cursorAnchor = closestResult.point;
                    // Select the stroke and store the point index
                    selectedStrokeIdx = closestResult.strokeIdx;
                    selectedStrokePointIdx = closestResult.pointIdx;
                    selectedStrokeCursorPos = { ...closestResult.point };
                    // Manual selection exits fresh stroke mode
                    isFreshStroke = false;
                    // Clear transformation undo state when manually selecting a stroke
                    transformSnapshot = null;
                    hasUndoableTransform = false;
                    // Update color and size pickers to match selected stroke
                    updatePickersForSelectedStroke();
                }
                updateDelButton();
                break;

            case Action.DESELECT_STROKE:
                selectedStrokeCursorPos = null;
                selectedStrokeIdx = null;
                selectedStrokePointIdx = null;
                // Clear transformation undo state on deselection
                transformSnapshot = null;
                hasUndoableTransform = false;
                // Don't change isFreshStroke - it persists through deselection
                // NOTE: Don't clearDebug() here - debug messages should persist
                updateDelButton();
                break;

            case Action.START_SELECTION_RECTANGLE:
                // Start selection rectangle at current cursor position
                if (cursorAnchor) {
                    selectionRectStart = { ...cursorAnchor };
                    selectionRectEnd = { ...cursorAnchor };
                    // Initialize position tracking for cursor movement
                    const positions = eventHandler.getFingerPositions();
                    lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
                    lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
                    // Update highlighted strokes (initially empty since single tap cleared them)
                    updateHighlightedStrokes();
                }
                break;

            case Action.UPDATE_SELECTION_RECTANGLE:
                // Update selection rectangle end point to current cursor position
                if (cursorAnchor && selectionRectStart) {
                    selectionRectEnd = { ...cursorAnchor };
                    // Update highlighted strokes in real-time
                    updateHighlightedStrokes();
                }
                break;

            case Action.APPLY_SELECTION_RECTANGLE:
                // Complete selection rectangle - keep strokes highlighted, don't apply colors yet
                selectionRectStart = null;
                selectionRectEnd = null;
                // Keep highlighted strokes (don't clear them)
                break;

            case Action.CANCEL_SELECTION_RECTANGLE:
                // Cancel selection rectangle
                selectionRectStart = null;
                selectionRectEnd = null;
                // Clear highlighted strokes
                highlightedStrokes.clear();
                break;

            case Action.CLEAR_HIGHLIGHTING:
                // Check if cursor is in the menu region
                if (isCursorInMenuRegion()) {
                    // Cursor is in menu region - try to tap a menu element
                    // Don't clear highlighting regardless (menu taps shouldn't affect canvas)
                    simulateTapAtCursor();
                } else {
                    // Cursor is in canvas region - clear highlighting as normal
                    highlightedStrokes.clear();
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
                currentStroke = null;
                lastGridPosition = null;
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

eventHandler.setEventCallback((event: Event) => {
    const result = stateMachine.processEvent(event);
    handleActions(result.actions);

    // Handle finger promotion discontinuity
    if (event === Event.FINGER_UP) {
        const promotionDelta = eventHandler.getAndClearPromotionDelta();
        if (promotionDelta) {
            // When fingers are promoted, we need to update the tracking positions
            // to match the new finger assignments, otherwise the next delta calculation
            // will use the old positions and create a jump
            const positions = eventHandler.getFingerPositions();
            lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
            lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
        }
    }

    redraw();
});

// ============================================================================
// SHAPE FITTING
// ============================================================================

// Master debug flag - set to false to disable all shape fitting debug overlay
const DEBUG_SHAPE_FITTING = false;

// Debug flags for each fitter (only used if DEBUG_SHAPE_FITTING is true)
const DEBUG_CIRCLE_ELLIPSE = false;
const DEBUG_SQUARE_RECTANGLE = false;
const DEBUG_POLYGON_STAR = true;
const DEBUG_POLYLINE = false;

function fitStroke(stroke: Stroke): void {
    if (stroke.points!.length < 3) {
        showDebug('Too few points!');
        return; // Not enough points to fit
    }

    // Store original points if not already stored
    if (!stroke.originalPoints) {
        stroke.originalPoints = stroke.points!.map(p => ({ ...p }));
    }

    // TEMPORARY: Skip resampling to avoid cutting corners on grid-drawn shapes
    const points = stroke.originalPoints;

    // Check if stroke is mostly closed
    const closureInfo = isMostlyClosed(points);

    if (closureInfo.closed) {
        // Fit all shapes: circle, ellipse, square/rectangle, and equilateral polygon
        const circleFit = fitCircle(points);
        const ellipseFit = fitEllipse(points);
        const squareFit = fitSquare(points);
        const polygonFit = fitEquilateralPolygon(points, stroke.size!);

        if (!circleFit || !ellipseFit || !squareFit) {
            showDebug('One or more fits failed!');
            return;
        }

        // Display debug info - show fit errors to determine which fitter to use
        if (DEBUG_SHAPE_FITTING) {
            let debugText = `Points: ${points.length}`;

            // Line 1: Circle vs Ellipse
            debugText += `\nCircle/Ellipse: ${Math.sqrt(circleFit.error).toFixed(1)}px/${Math.sqrt(ellipseFit.error).toFixed(1)}px`;

            // Line 2: Square vs Rectangle
            debugText += `\nSquare/Rect: ${Math.sqrt(squareFit.squareError).toFixed(1)}px/${Math.sqrt(squareFit.error).toFixed(1)}px`;

            // Line 3: Polygon (regularized)
            const polygonErr = polygonFit ? Math.sqrt(polygonFit.error).toFixed(1) : 'N/A';
            const polygonSides = polygonFit ? polygonFit.sides : 0;
            debugText += `\nPolygon: ${polygonErr}px (${polygonSides} sides)`;

            // Detailed debug info for circle/ellipse fitter
            if (DEBUG_CIRCLE_ELLIPSE) {
                debugText += `\n---`;
                debugText += `\nEllipticity: ${ellipseFit.ellipticity.toFixed(3)}`;
                debugText += `\nEllipse err before 1D: ${ellipseFit.debugInfo?.errorBefore1D.toFixed(2)}`;
                debugText += `\nEllipse err after 1D: ${ellipseFit.debugInfo?.errorAfter1D.toFixed(2)}`;
            }

            // Detailed debug info for square/rectangle fitter
            if (DEBUG_SQUARE_RECTANGLE) {
                debugText += `\n---`;
                debugText += `\nSquareness: ${squareFit.squareness.toFixed(3)}`;
            }

            // Detailed debug info for polygon/star fitter
            if (DEBUG_POLYGON_STAR && polygonFit) {
                debugText += `\n---`;
                const shapeLabel = polygonFit.shapeType === 'polygon'
                    ? 'Polygon'
                    : polygonFit.shapeType === 'star'
                    ? 'Star'
                    : 'X-Star';
                debugText += `\n${shapeLabel}: ${polygonFit.sides} ${polygonFit.shapeType === 'polygon' ? 'sides' : 'points'}`;
                debugText += `\nRadius: ${polygonFit.radius.toFixed(1)}`;
                if (polygonFit.innerRadius !== undefined) {
                    debugText += `\nInner R: ${polygonFit.innerRadius.toFixed(1)}`;
                }
                if (polygonFit.stepPattern !== undefined) {
                    debugText += `\nStep: ${polygonFit.stepPattern}/${polygonFit.sides}`;
                }
                debugText += `\nRotation: ${(polygonFit.rotation * 180 / Math.PI).toFixed(1)}°`;

                // Show radius debug info if available
                if ((polygonFit as any).debugRadiusInfo) {
                    debugText += `\n${(polygonFit as any).debugRadiusInfo}`;
                }

                // Show starfish test debug info if available
                if ((polygonFit as any).debugStarfishTest) {
                    debugText += `\n${(polygonFit as any).debugStarfishTest}`;
                }

                // Show step pattern debug info if available
                if ((polygonFit as any).debugStepPatterns) {
                    debugText += `\nStep errors:`;
                    const patterns = (polygonFit as any).debugStepPatterns;
                    for (const p of patterns) {
                        const mark = p.step === polygonFit.stepPattern ? '*' : ' ';
                        debugText += `\n${mark}${p.step}:${p.error.toFixed(0)}`;
                    }
                }
            }

            showDebug(debugText);
        }

        // Choose the best fitter based on minimum error
        const ellipseError = ellipseFit.error;
        const rectangleError = squareFit.error;
        const polygonError = polygonFit ? polygonFit.error : Infinity;

        const minError = Math.min(ellipseError, rectangleError, polygonError);

        const elongationThreshold = 0.20; // 20% threshold for using elongated vs constrained fit

        if (minError === ellipseError) {
            // Winner: Circle/Ellipse fitter
            // Use ellipticity to decide between circle and ellipse
            if (ellipseFit.ellipticity > elongationThreshold) {
                // Use ellipse fit
                stroke.fittedPoints = generateEllipsePoints(
                    ellipseFit.center,
                    ellipseFit.radiusX,
                    ellipseFit.radiusY,
                    ellipseFit.rotation,
                    64
                );
                stroke.fitType = 'ellipse';
            } else {
                // Use circle fit
                stroke.fittedPoints = generateCirclePoints(circleFit.center, circleFit.radius, 64);
                stroke.fitType = 'circle';
            }
            stroke.fittedWithSize = stroke.size!;
        } else if (minError === rectangleError) {
            // Winner: Square/Rectangle fitter
            // Calculate elongation from squareness
            const elongation = squareFit.squareness;

            if (elongation > elongationThreshold) {
                // Use rectangle fit
                stroke.fittedPoints = generateRectanglePoints(
                    squareFit.center,
                    squareFit.width,
                    squareFit.height,
                    squareFit.rotation,
                    64
                );
                stroke.fitType = 'rectangle';
            } else {
                // Use square fit - need to get the constrained square fit
                const squareOnlyFit = fitSquareConstrained(points);
                if (squareOnlyFit) {
                    stroke.fittedPoints = generateRectanglePoints(
                        squareOnlyFit.center,
                        squareOnlyFit.size,
                        squareOnlyFit.size,
                        squareOnlyFit.rotation,
                        64
                    );
                    stroke.fitType = 'square';
                } else {
                    // Fallback to rectangle if square fit fails
                    stroke.fittedPoints = generateRectanglePoints(
                        squareFit.center,
                        squareFit.width,
                        squareFit.height,
                        squareFit.rotation,
                        64
                    );
                    stroke.fitType = 'rectangle';
                }
            }
            stroke.fittedWithSize = stroke.size!;
        } else {
            // Winner: Polygon/Star fitter
            if (polygonFit) {
                stroke.fittedPoints = polygonFit.vertices;
                const shapePrefix = polygonFit.shapeType === 'polygon'
                    ? 'polygon'
                    : polygonFit.shapeType === 'star'
                    ? 'star'
                    : 'x-star';
                stroke.fitType = `${shapePrefix}-${polygonFit.sides}`;
                stroke.fittedWithSize = stroke.size!;
            } else {
                // Fallback to rectangle if polygon fit fails
                stroke.fittedPoints = generateRectanglePoints(
                    squareFit.center,
                    squareFit.width,
                    squareFit.height,
                    squareFit.rotation,
                    64
                );
                stroke.fitType = 'rectangle';
                stroke.fittedWithSize = stroke.size!;
            }
        }
    } else {
        // For open strokes, use polyline fitting with RDP algorithm
        const polylineFit = fitPolyline(points, stroke.size!);

        if (!polylineFit) {
            showDebug('Polyline fit failed!');
            return;
        }

        // Display debug info for polyline fit
        if (DEBUG_SHAPE_FITTING) {
            let debugText = `Polyline: ${polylineFit.error.toFixed(2)}`;

            // Detailed debug info for polyline fitter
            if (DEBUG_POLYLINE) {
                debugText += `\n---`;
                debugText += `\nSegments: ${polylineFit.segments}`;
                debugText += `\nEpsilon: ${(2 * stroke.size!).toFixed(2)}`;
            }

            showDebug(debugText);
        }

        // Use the simplified polyline points
        stroke.fittedPoints = generatePolylinePoints(polylineFit.points);
        stroke.fitType = 'polyline';
        stroke.fittedWithSize = stroke.size!;  // Track the size used for fitting
    }
}

// ============================================================================
// UNDO AND CLEAR
// ============================================================================

function updateDelButton() {
    const hasStrokes = strokeHistory.length > 0;

    // Determine button state based on requirements:
    // a) No strokes → disabled "Undo"
    // b) Has strokes but no selection → enabled "Undo" (undo last stroke)
    // c) Fresh stroke (just drew) → enabled "Undo"
    // d) Transformed stroke → enabled "Undo"
    // e) Manually selected stroke → enabled "Del"

    let showDeleteIcon = false;

    if (!hasStrokes) {
        // a) No strokes - disabled "Undo"
        delBtn.disabled = true;
        showDeleteIcon = false;
    } else if (isFreshStroke) {
        // c) Fresh stroke mode - enabled "Undo"
        delBtn.disabled = false;
        showDeleteIcon = false;
    } else if (hasUndoableTransform && selectedStrokeIdx !== null) {
        // d) Transformed stroke - enabled "Undo"
        delBtn.disabled = false;
        showDeleteIcon = false;
    } else if (selectedStrokeIdx !== null) {
        // e) Manually selected stroke - enabled "Del"
        delBtn.disabled = false;
        showDeleteIcon = true;
    } else {
        // b) Has strokes but no selection - enabled "Undo" (undo last stroke)
        delBtn.disabled = false;
        showDeleteIcon = false;
    }

    // Toggle icon visibility
    if (showDeleteIcon) {
        undoIcon.style.display = 'none';
        deleteIcon.style.display = 'block';
        delBtn.setAttribute('aria-label', 'Delete');
    } else {
        undoIcon.style.display = 'block';
        deleteIcon.style.display = 'none';
        delBtn.setAttribute('aria-label', 'Undo');
    }

    // Update duplicate button state - only enabled when a stroke is selected
    btnDup.disabled = selectedStrokeIdx === null;

    // Update group/ungroup buttons
    updateGroupButtons();
}

function processDelete() {
    if (strokeHistory.length === 0) return;

    // Check if we should undo transformation instead of deleting
    if (hasUndoableTransform && transformSnapshot && selectedStrokeIdx !== null) {
        // Restore the stroke to its pre-transformation state (works for groups too)
        const selectedStroke = strokeHistory[selectedStrokeIdx];
        const snapshot = transformSnapshot; // Local variable to avoid null checks

        // Restore all points using the snapshot
        let pointIndex = 0;
        transformStroke(selectedStroke, (leafStroke: Stroke) => {
            const restoredPoints: Point[] = [];
            for (let i = 0; i < leafStroke.points!.length; i++) {
                restoredPoints.push({ ...snapshot[pointIndex++] });
            }
            leafStroke.points = restoredPoints;
        });

        // Update cursor position to follow the stroke back to its original position
        if (selectedStrokePointIdx !== null && selectedStrokePointIdx < transformSnapshot.length) {
            cursorAnchor = { ...transformSnapshot[selectedStrokePointIdx] };
            selectedStrokeCursorPos = { ...cursorAnchor };
            panToKeepCursorInView();
        }

        // Clear the transformation undo state
        transformSnapshot = null;
        hasUndoableTransform = false;

        // Update button to show "Del" now
        updateDelButton();
        redraw();
        return;
    }

    // Determine which stroke to delete
    let indexToDelete: number;
    const wasManualSelection = !isFreshStroke && selectedStrokeIdx !== null;

    if (isFreshStroke || selectedStrokeIdx === null) {
        // Fresh stroke mode or no selection - delete (undo) the last stroke
        indexToDelete = strokeHistory.length - 1;
    } else {
        // Delete the selected stroke
        indexToDelete = selectedStrokeIdx;
    }

    const deletedStroke = strokeHistory[indexToDelete];

    // Save cursor position before deletion (for finding closest stroke after)
    const cursorPosBeforeDeletion = cursorAnchor ? { ...cursorAnchor } : null;

    // Move cursor to the beginning of the first stroke being removed
    let firstPointX = 0;
    let firstPointY = 0;
    let foundPoint = false;
    forEachLeafStroke(deletedStroke, (leafStroke: Stroke) => {
        if (!foundPoint && leafStroke.points!.length > 0) {
            firstPointX = leafStroke.points![0].x;
            firstPointY = leafStroke.points![0].y;
            foundPoint = true;
        }
    });
    if (foundPoint) {
        cursorAnchor = { x: firstPointX, y: firstPointY };
        panToKeepCursorInView();
    }

    // Remove the stroke FIRST (before finding closest, to avoid index shift issues)
    strokeHistory.splice(indexToDelete, 1);

    // Clear transformation undo state when deleting a stroke
    transformSnapshot = null;
    hasUndoableTransform = false;

    // After deletion, always exit fresh stroke mode
    isFreshStroke = false;

    // Determine the new selection state
    if (strokeHistory.length > 0) {
        if (wasManualSelection && cursorPosBeforeDeletion) {
            // Manual selection (Del button) - restore cursor position and find closest stroke
            cursorAnchor = cursorPosBeforeDeletion;
            const result = findClosestStrokeAndPoint();
            if (result) {
                selectedStrokeIdx = result.strokeIdx;
                selectedStrokePointIdx = result.pointIdx;
                cursorAnchor = { ...result.point };
                selectedStrokeCursorPos = { ...cursorAnchor };
                panToKeepCursorInView();
                // Update pickers to match the newly selected stroke
                updatePickersForSelectedStroke();
            }
        } else {
            // Fresh stroke mode (Undo button) - DON'T select any stroke
            // The cursor is already at the beginning of the deleted stroke
            selectedStrokeIdx = null;
            selectedStrokePointIdx = null;
            selectedStrokeCursorPos = null;
        }
    } else {
        // No more strokes - deselect
        selectedStrokeIdx = null;
        selectedStrokePointIdx = null;
        selectedStrokeCursorPos = null;
    }

    updateDelButton();
}

function processClear() {
    strokeHistory = [];
    currentStroke = null;
    lastGridPosition = null;
    transformStart = null;
    transformSnapshot = null;
    hasUndoableTransform = false;
    viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    cursorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
    isFreshStroke = false;
    updateDelButton();

    // Reset state machine and event handler
    stateMachine.reset();
    eventHandler.reset();
}

function duplicateSelectedStroke() {
    if (selectedStrokeIdx === null || selectedStrokeIdx >= strokeHistory.length) {
        showDebug('No stroke selected to duplicate!');
        return;
    }

    const sourceStroke = strokeHistory[selectedStrokeIdx];

    // Calculate bounding box of the source stroke (works for groups too)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    forEachLeafStroke(sourceStroke, (leafStroke: Stroke) => {
        for (const point of leafStroke.points!) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    });

    const centerX = (minX + maxX) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    // Mirror points around vertical line through center, then offset
    const offsetX = width * 0.25;  // Right by 1/4 of bounding box width
    const offsetY = -height * 0.5;  // Up by 1/2 of bounding box height

    // Clone the stroke (handles groups recursively)
    const duplicatedStroke = cloneStroke(sourceStroke);

    // Transform all points in the duplicated stroke
    transformStroke(duplicatedStroke, (leafStroke: Stroke) => {
        // Transform main points
        leafStroke.points = leafStroke.points!.map(point => {
            const mirroredX = centerX - (point.x - centerX);
            return {
                x: mirroredX + offsetX,
                y: point.y + offsetY
            };
        });

        // Transform original points if they exist
        if (leafStroke.originalPoints) {
            leafStroke.originalPoints = leafStroke.originalPoints.map(point => {
                const mirroredX = centerX - (point.x - centerX);
                return {
                    x: mirroredX + offsetX,
                    y: point.y + offsetY
                };
            });
        }

        // Transform fitted points if they exist
        if (leafStroke.fittedPoints) {
            leafStroke.fittedPoints = leafStroke.fittedPoints.map(point => {
                const mirroredX = centerX - (point.x - centerX);
                return {
                    x: mirroredX + offsetX,
                    y: point.y + offsetY
                };
            });
        }
    });

    // Add the duplicated stroke to history
    strokeHistory.push(duplicatedStroke);

    // Select the new stroke and move cursor to its first point
    selectedStrokeIdx = strokeHistory.length - 1;
    let firstPointX = 0;
    let firstPointY = 0;
    let foundPoint = false;
    forEachLeafStroke(duplicatedStroke, (leafStroke: Stroke) => {
        if (!foundPoint && leafStroke.points!.length > 0) {
            firstPointX = leafStroke.points![0].x;
            firstPointY = leafStroke.points![0].y;
            foundPoint = true;
        }
    });
    if (foundPoint) {
        selectedStrokePointIdx = 0;
        cursorAnchor = { x: firstPointX, y: firstPointY };
        selectedStrokeCursorPos = { ...cursorAnchor };
        panToKeepCursorInView();
    }

    // Update pickers to match the duplicated stroke
    updatePickersForSelectedStroke();

    // Exit fresh stroke mode
    isFreshStroke = false;

    // Clear transformation undo state
    transformSnapshot = null;
    hasUndoableTransform = false;

    updateDelButton();
    redraw();
}

function groupHighlightedStrokes() {
    if (highlightedStrokes.size < 2) {
        showDebug('Need at least 2 strokes to group!');
        return;
    }

    // Collect the strokes to group (in order of their indices)
    const indices = Array.from(highlightedStrokes).sort((a, b) => a - b);
    const strokesToGroup: Stroke[] = [];

    for (const index of indices) {
        strokesToGroup.push(cloneStroke(strokeHistory[index]));
    }

    // Remove the original strokes from history (in reverse order to maintain indices)
    for (let i = indices.length - 1; i >= 0; i--) {
        strokeHistory.splice(indices[i], 1);
    }

    // Create a new group stroke
    const groupStroke: Stroke = {
        strokes: strokesToGroup
    };

    // Add the group at the position of the first stroke
    strokeHistory.splice(indices[0], 0, groupStroke);

    // Clear highlighted strokes and select the new group
    highlightedStrokes.clear();
    selectedStrokeIdx = indices[0];
    isFreshStroke = false;

    // Move cursor to the first point of the first stroke in the group
    forEachLeafStroke(groupStroke, (leafStroke: Stroke) => {
        if (leafStroke.points!.length > 0) {
            cursorAnchor = { ...leafStroke.points![0] };
            selectedStrokePointIdx = 0;
            selectedStrokeCursorPos = { ...cursorAnchor };
            panToKeepCursorInView();
        }
        return; // Only process first leaf stroke
    });

    updateDelButton();
    updatePickersForSelectedStroke();
    redraw();
}

function ungroupSelectedStroke() {
    if (selectedStrokeIdx === null || selectedStrokeIdx >= strokeHistory.length) {
        showDebug('No stroke selected to ungroup!');
        return;
    }

    const stroke = strokeHistory[selectedStrokeIdx];

    if (!isGroup(stroke)) {
        showDebug('Selected stroke is not a group!');
        return;
    }

    // Get the immediate children (one level only)
    const children = stroke.strokes!.map(child => cloneStroke(child));

    // Remove the group from history
    strokeHistory.splice(selectedStrokeIdx, 1);

    // Insert all children at the same position
    strokeHistory.splice(selectedStrokeIdx, 0, ...children);

    // Deselect
    selectedStrokeIdx = null;
    selectedStrokePointIdx = null;
    selectedStrokeCursorPos = null;
    isFreshStroke = false;

    updateDelButton();
    redraw();
}

function updateGroupButtons() {
    // Group button: enabled when 2+ strokes are highlighted
    btnGroup.disabled = highlightedStrokes.size < 2;

    // Ungroup button: enabled when a single group is selected
    if (selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
        const stroke = strokeHistory[selectedStrokeIdx];
        btnUngroup.disabled = !isGroup(stroke);
    } else {
        btnUngroup.disabled = true;
    }
}

// ============================================================================
// POINTER EVENT HANDLERS
// ============================================================================

function getPointerPos(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// Track pointers that started on UI elements (for drag detection)
const pointersOnUI = new Map<number, { startX: number, startY: number }>();
const UI_DRAG_THRESHOLD = 15; // pixels before UI touch becomes canvas drag

function handlePointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    const pos = getPointerPos(e);
    const now = Date.now();

    // Check if this started on a UI element
    if (target.closest('.toolbar, button, #combinedPicker, [style*="z-index: 1000"]')) {
        // Track this pointer - it might become a drag
        pointersOnUI.set(e.pointerId, { startX: e.clientX, startY: e.clientY });
        return;
    }

    e.preventDefault();

    // Only track taps when no fingers are down (single finger gestures)
    if (eventHandler.getFingerCount() === 0) {
        // Check if this is the second tap down (could be double-tap or tap-and-a-half)
        if (firstTapUpTime > 0 &&
            now - firstTapUpTime < DOUBLE_TAP_DELAY &&
            firstTapDownPos !== null &&
            getDistance(pos, firstTapDownPos) < DOUBLE_TAP_DISTANCE) {
            // This is the second tap down - record it and mark as tracking double-tap
            secondTapDownTime = now;
            secondTapDownPos = pos;
            isTrackingDoubleTap = true;

            // Check if we should enter tap-and-a-half mode (selection rectangle)
            // Tap-and-a-half: User intends to drag, so second tap should be held longer
            // We'll check on pointer move or pointer up if it's double-tap vs tap-and-a-half
        } else {
            // This is the first tap down - record it
            firstTapDownTime = now;
            firstTapDownPos = pos;
            firstTapUpTime = 0;  // Reset up time
            secondTapDownTime = 0;
            secondTapDownPos = null;
            isTrackingDoubleTap = false;
        }
    }

    // Capture pointer on document.body - this ensures we receive all events
    // regardless of where the touch started
    document.body.setPointerCapture(e.pointerId);

    // Pass to event handler
    eventHandler.handlePointerDown(e.pointerId, pos);
}

function handlePointerMove(e: PointerEvent) {
    const pos = getPointerPos(e);

    // Check if this pointer started on UI and should be converted to a drag
    const uiPointer = pointersOnUI.get(e.pointerId);
    if (uiPointer) {
        const dx = e.clientX - uiPointer.startX;
        const dy = e.clientY - uiPointer.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > UI_DRAG_THRESHOLD) {
            // Convert to canvas drag - remove from UI tracking and initialize as pointer down
            pointersOnUI.delete(e.pointerId);
            e.preventDefault();

            // Initialize this pointer in the event handler
            eventHandler.handlePointerDown(e.pointerId, pos);
            document.body.setPointerCapture(e.pointerId);
        }
        return; // Don't process as move yet
    }

    e.preventDefault();
    eventHandler.handlePointerMove(e.pointerId, pos);

    const state = stateMachine.getState();

    // Tap-and-a-half detection: if user is holding second tap and moves, enter selection rectangle
    if (isTrackingDoubleTap && state === State.MovingCursor) {
        const now = Date.now();
        // If second tap is held longer than double-tap max duration, it's tap-and-a-half
        if (now - secondTapDownTime > DOUBLE_TAP_MAX_DURATION) {
            // Enter selection rectangle mode
            stateMachine.enterSelectionRectangle();
            isTrackingDoubleTap = false;
            // Trigger the START_SELECTION_RECTANGLE action manually
            handleActions([Action.START_SELECTION_RECTANGLE, Action.DESELECT_STROKE]);
        }
    }

    // Handle state-specific continuous updates
    if (state === State.MovingCursor || state === State.Drawing) {
        updateCursorPosition();

        if (state === State.Drawing && currentStroke) {
            addPointToStroke();
        }

        redraw();
    } else if (state === State.Transform) {
        applyThreeFingerTransform();
        redraw();
    } else if (state === State.SelectionRectangle) {
        // Clear double-tap tracking since we're now dragging a selection rectangle
        secondTapDownTime = 0;
        secondTapDownPos = null;
        isTrackingDoubleTap = false;

        // Update cursor position and selection rectangle
        updateCursorPosition();
        if (cursorAnchor && selectionRectStart) {
            selectionRectEnd = { ...cursorAnchor };
            // Update highlighted strokes in real-time as the rectangle changes
            updateHighlightedStrokes();
        }
        redraw();
    }
}

function handlePointerUp(e: PointerEvent) {
    // Clean up UI pointer tracking if this pointer was on UI
    if (pointersOnUI.has(e.pointerId)) {
        pointersOnUI.delete(e.pointerId);
        return; // This was a UI tap, don't process as canvas event
    }

    e.preventDefault();

    const pos = getPointerPos(e);
    const now = Date.now();

    eventHandler.handlePointerUp(e.pointerId);

    if (eventHandler.getFingerCount() <= 1) // Only 1 finger left or no fingers left
    {
        lastPrimaryPos = null;
        lastSecondaryPos = null;
        lastDelta = null;
        batchedDelta = null;
    }

    // Clean up movement tracking if all fingers are up
    if (eventHandler.getFingerCount() === 0) {
        // Close combined picker on tap (quick touch and release)
        // Check if this was a quick single tap (not part of double-tap sequence)
        // But don't close if cursor is in menu region (user is interacting with menu)
        if (firstTapDownTime > 0 && firstTapDownPos !== null &&
            getDistance(pos, firstTapDownPos) < DOUBLE_TAP_DISTANCE &&
            now - firstTapDownTime < DOUBLE_TAP_MAX_DURATION &&
            !isTrackingDoubleTap &&
            !isCursorInMenuRegion()) {
            // This is a single tap completion - close the picker if it's open
            if (combinedPicker.isOpen()) {
                combinedPicker.close();
            }
        }
        // Check for double-tap completion (second finger lift)
        if (secondTapDownTime > 0 &&
            secondTapDownPos !== null &&
            getDistance(pos, secondTapDownPos) < DOUBLE_TAP_DISTANCE &&
            now - secondTapDownTime < DOUBLE_TAP_MAX_DURATION) {  // Second tap must be quick
            // Valid double-tap completed!
            // DOUBLE-TAP SELECTION: Select stroke closest to the tap location
            const canvasPos = screenToCanvas(pos);
            const result = findClosestStrokeAndPoint(canvasPos);
            if (result) {
                // Move cursor to the closest point
                cursorAnchor = result.point;
                // Select the stroke and store the point index
                selectedStrokeIdx = result.strokeIdx;
                selectedStrokePointIdx = result.pointIdx;
                selectedStrokeCursorPos = { ...result.point };
                // Manual selection exits fresh stroke mode
                isFreshStroke = false;
                // Clear transformation undo state when manually selecting a stroke
                transformSnapshot = null;
                hasUndoableTransform = false;
                // Update state machine to reflect selection
                stateMachine.setStrokeSelected(true);
                updateDelButton();
                // Update color and size pickers to match selected stroke
                updatePickersForSelectedStroke();
            }
            // Reset double-tap tracking
            firstTapDownTime = 0;
            firstTapDownPos = null;
            firstTapUpTime = 0;
            secondTapDownTime = 0;
            secondTapDownPos = null;
            isTrackingDoubleTap = false;
        } else if (firstTapDownTime > 0 && firstTapDownPos !== null &&
                   getDistance(pos, firstTapDownPos) < DOUBLE_TAP_DISTANCE &&
                   now - firstTapDownTime < DOUBLE_TAP_MAX_DURATION) {  // First tap must be quick
            // First tap completed successfully - record the up time
            firstTapUpTime = now;
            isTrackingDoubleTap = false;
        } else {
            // Movement was too far or some other condition - reset tracking
            firstTapDownTime = 0;
            firstTapDownPos = null;
            firstTapUpTime = 0;
            secondTapDownTime = 0;
            secondTapDownPos = null;
            isTrackingDoubleTap = false;
        }

        // Mark transformation as complete if a stroke was transformed
        if (transformStart && transformStart.initialStrokeSnapshots && transformSnapshot) {
            hasUndoableTransform = true;
            updateDelButton();
        }
        transformStart = null;

        // Clamp cursor after transform
        clampCursorToView();

        // Snap to grid in grid mode
        if (isGridMode && cursorAnchor) {
            cursorAnchor = snapToGrid(cursorAnchor);
        }

        redraw();
    }
}

// ============================================================================
// CANVAS AND WINDOW
// ============================================================================

function resizeCanvas() {
    const toolbarHeight = 60;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;
    clampCursorToView();
    redraw();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Attach pointer events to document so dragging works even when starting over menu/picker
// The handlePointerDown function will capture the pointer to continue receiving events
document.addEventListener('pointerdown', handlePointerDown);
document.addEventListener('pointermove', handlePointerMove);
document.addEventListener('pointerup', handlePointerUp);
document.addEventListener('pointercancel', handlePointerUp);

// Prevent default touch behavior, but only for canvas area (not toolbar/UI elements)
function shouldPreventDefault(e: TouchEvent): boolean {
    const target = e.target as HTMLElement;
    // Don't prevent default for toolbar buttons, picker, or popups
    if (target.closest('.toolbar, button, #combinedPicker, [style*="z-index: 1000"]')) {
        return false;
    }
    return true;
}

document.addEventListener('touchstart', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
document.addEventListener('touchend', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });
document.addEventListener('touchcancel', e => { if (shouldPreventDefault(e)) e.preventDefault(); }, { passive: false });

delBtn.addEventListener('click', () => eventHandler.handleDelete());
clearBtn.addEventListener('click', () => eventHandler.handleClear());

btnDup.addEventListener('click', () => {
    duplicateSelectedStroke();
});

btnGroup.addEventListener('click', () => {
    groupHighlightedStrokes();
});

btnUngroup.addEventListener('click', () => {
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
    enterFullscreenIcon.style.display = isFullscreen ? 'none' : 'block';
    exitFullscreenIcon.style.display = isFullscreen ? 'block' : 'none';
}

function hideIosTooltip() {
    iosFullscreenTooltip.classList.remove('visible');
}

fullscreenBtn.addEventListener('click', () => {
    if (isIOS() && !isStandalone()) {
        // On iOS (not in PWA mode), show the tooltip instead
        iosFullscreenTooltip.classList.toggle('visible');
    } else if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.documentElement.requestFullscreen();
    }
});

iosTooltipClose.addEventListener('click', () => {
    hideIosTooltip();
});

document.addEventListener('fullscreenchange', () => {
    updateFullscreenIcon();
    // Resize canvas after fullscreen change
    setTimeout(resizeCanvas, 100);
});

window.addEventListener('resize', resizeCanvas);

// ============================================================================
// INITIALIZATION
// ============================================================================

resizeCanvas();
updateDelButton();
cursorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
