import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { StateMachine, State, Event, Action, TransitionResult } from './stateMachine';
import { EventHandler, Point } from './eventHandler';
import { resampleStroke } from './resample';
import { fitCircle, generateCirclePoints, isMostlyClosed } from './fitters/circleFitter';
import { fitEllipse, generateEllipsePoints } from './fitters/ellipseFitter';
import { fitSquare, fitSquareConstrained, generateRectanglePoints } from './fitters/squareFitter';
import { fitPolyline, generatePolylinePoints } from './fitters/polylineFitter';
import { fitEquilateralPolygon, generateEquilateralPolygonPoints } from './fitters/equilateralPolygonFitter';

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
const gridToggleBtn = document.getElementById('gridToggle') as HTMLButtonElement;
const fitBtn = document.getElementById('fitBtn') as HTMLButtonElement;
const btnDup = document.getElementById('btnDup') as HTMLButtonElement;
const debugOverlay = document.getElementById('debugOverlay') as HTMLElement;

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
    color: string;
    size: number;
    points: Point[];              // Currently displayed points
    originalPoints?: Point[];     // Original hand-drawn points
    fittedPoints?: Point[];       // Fitted analytical curve points
    fitType?: string;             // Type of fit: 'circle', 'ellipse', 'line', etc.
    showingFitted?: boolean;      // True if currently showing fitted version
    fittedWithSize?: number;      // Stroke size used when fitting (for polylines)
}

// ============================================================================
// STATE MACHINE AND EVENT HANDLER
// ============================================================================

const stateMachine = new StateMachine();
const eventHandler = new EventHandler();

// ============================================================================
// APPLICATION STATE
// ============================================================================

// History for undo functionality
let strokeHistory: Stroke[] = [];

// Current stroke being drawn
let currentStroke: Stroke | null = null;

// Indicator anchor point (in canvas coordinates)
let indicatorAnchor: Point | null = null;

// Selected stroke index (null = no selection, number = index in strokeHistory)
let selectedStrokeIdx: number | null = null;

// Index of the point within the selected stroke where the marker is positioned
let selectedStrokePointIdx: number | null = null;

// Reference position for selected stroke tracking
let selectedStrokeMarkerPos: Point | null = null;

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
    initialStrokePoints?: Point[];  // For selected stroke transformation
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
        // Apply to all highlighted strokes, or to selected stroke if no highlights
        if (highlightedStrokes.size > 0) {
            for (const index of highlightedStrokes) {
                if (index < strokeHistory.length) {
                    strokeHistory[index].color = color;
                }
            }
        } else if (selectedStrokeIdx !== null) {
            strokeHistory[selectedStrokeIdx].color = color;
        }
        redraw();
    },
    (size: number) => {
        // Apply to all highlighted strokes, or to selected stroke if no highlights
        if (highlightedStrokes.size > 0) {
            for (const index of highlightedStrokes) {
                if (index < strokeHistory.length) {
                    strokeHistory[index].size = size;
                }
            }
        } else if (selectedStrokeIdx !== null) {
            strokeHistory[selectedStrokeIdx].size = size;
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
        combinedPicker.setColor(stroke.color);
        combinedPicker.setSize(stroke.size);
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

    // Use provided search position, or fall back to indicator anchor
    const referencePos = searchPos || indicatorAnchor;
    if (!referencePos) {
        return null;
    }

    let closestStrokeIdx = -1;
    let closestPointIdx = -1;
    let closestPoint: Point | null = null;
    let minDistanceSquared = Infinity;

    // Iterate through all strokes
    for (let i = 0; i < strokeHistory.length; i++) {
        const stroke = strokeHistory[i];

        // Find closest point in this stroke
        for (let j = 0; j < stroke.points.length; j++) {
            const point = stroke.points[j];
            const dx = point.x - referencePos.x;
            const dy = point.y - referencePos.y;
            const distanceSquared = dx * dx + dy * dy;

            if (distanceSquared < minDistanceSquared) {
                minDistanceSquared = distanceSquared;
                closestStrokeIdx = i;
                closestPointIdx = j;
                closestPoint = point;
            }
        }
    }

    if (closestPoint === null) {
        return null;
    }

    return {
        strokeIdx: closestStrokeIdx,
        pointIdx: closestPointIdx,
        point: { ...closestPoint }
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
// INDICATOR FUNCTIONS
// ============================================================================

function getDefaultIndicatorOffset(): Point {
    const maxDim = Math.max(canvas.width, canvas.height);
    const offset = maxDim / 8;
    const diagonalOffset = offset / Math.SQRT2;
    return {
        x: -diagonalOffset,
        y: -diagonalOffset
    };
}

function setIndicatorToDefaultPosition(screenPos: Point): void {
    const offset = getDefaultIndicatorOffset();
    const targetScreenPos = {
        x: screenPos.x + offset.x,
        y: screenPos.y + offset.y
    };

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, targetScreenPos.x));
    const clampedY = Math.max(margin, Math.min(canvas.height - margin, targetScreenPos.y));

    indicatorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
}

function clampIndicatorToView(): void {
    if (!indicatorAnchor) return;
    const screenPos = canvasToScreen(indicatorAnchor);

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, screenPos.x));
    const clampedY = Math.max(margin, Math.min(canvas.height - margin, screenPos.y));

    if (clampedX !== screenPos.x || clampedY !== screenPos.y) {
        indicatorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
    }
}

function panToKeepIndicatorInView(): void {
    if (!indicatorAnchor) return;
    const screenPos = canvasToScreen(indicatorAnchor);

    const margin = 10;
    let panDeltaX = 0;
    let panDeltaY = 0;

    if (screenPos.x < margin) {
        panDeltaX = margin - screenPos.x;
    } else if (screenPos.x > canvas.width - margin) {
        panDeltaX = (canvas.width - margin) - screenPos.x;
    }

    if (screenPos.y < margin) {
        panDeltaY = margin - screenPos.y;
    } else if (screenPos.y > canvas.height - margin) {
        panDeltaY = (canvas.height - margin) - screenPos.y;
    }

    if (panDeltaX !== 0 || panDeltaY !== 0) {
        viewTransform.panX += panDeltaX;
        viewTransform.panY += panDeltaY;
    }
}

function getIndicatorScreenPos(): Point {
    if (!indicatorAnchor) {
        return { x: canvas.width / 2, y: canvas.height / 4 };
    }
    return canvasToScreen(indicatorAnchor);
}

// ============================================================================
// DRAWING FUNCTIONS
// ============================================================================

function drawStroke(stroke: Stroke, isHighlighted: boolean = false) {
    const minSize = screenLengthToCanvasLength(1);
    const renderSize = Math.max(stroke.size, minSize);

    if (stroke.points.length < 2) {
        if (stroke.points.length === 1) {
            // Draw highlighted version first (grey outline) for single point
            if (isHighlighted) {
                ctx.fillStyle = 'lightgrey';
                ctx.beginPath();
                ctx.arc(stroke.points[0].x, stroke.points[0].y, renderSize * 2 / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            // Draw normal version on top
            ctx.fillStyle = stroke.color;
            ctx.beginPath();
            ctx.arc(stroke.points[0].x, stroke.points[0].y, renderSize / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    // Draw highlighted version first (grey outline with 2x thickness)
    if (isHighlighted) {
        ctx.strokeStyle = 'lightgrey';
        ctx.lineWidth = renderSize * 2;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    }

    // Draw normal stroke on top
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = renderSize;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

    for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
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

    // Draw completed strokes
    strokeHistory.forEach((stroke, index) => {
        const isHighlighted = highlightedStrokes.has(index);
        drawStroke(stroke, isHighlighted);
    });

    // Draw current in-progress stroke
    if (currentStroke) {
        drawStroke(currentStroke);
    }

    // Draw selection rectangle (in canvas coordinates, inside transform)
    if (selectionRectStart && selectionRectEnd) {
        const minX = Math.min(selectionRectStart.x, selectionRectEnd.x);
        const maxX = Math.max(selectionRectStart.x, selectionRectEnd.x);
        const minY = Math.min(selectionRectStart.y, selectionRectEnd.y);
        const maxY = Math.max(selectionRectStart.y, selectionRectEnd.y);

        // Draw semi-transparent rectangle
        ctx.fillStyle = 'rgba(135, 206, 250, 0.3)'; // Light blue with 30% opacity
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

        // Draw rectangle border
        ctx.strokeStyle = 'rgba(30, 144, 255, 0.8)'; // Dodger blue with 80% opacity
        ctx.lineWidth = screenLengthToCanvasLength(2);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    }

    ctx.restore();

    // Draw marker indicator (in screen space)
    if (indicatorAnchor) {
        const indicatorPos = getIndicatorScreenPos();
        const strokeSize = combinedPicker.getSize();
        const renderedSize = Math.max(strokeSize * viewTransform.scale, 1);
        const drawColor = combinedPicker.getColor();
        const isWhite = drawColor.toUpperCase() === '#FFFFFF';
        const outerColor = isWhite ? 'black' : drawColor;

        // Inner ring (white, or green if a stroke is selected)
        const hasSelectedStroke = selectedStrokeIdx !== null;
        ctx.beginPath();
        ctx.arc(indicatorPos.x, indicatorPos.y, renderedSize / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = hasSelectedStroke ? 'lime' : 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Outer ring (draw color, or black if white)
        ctx.beginPath();
        ctx.arc(indicatorPos.x, indicatorPos.y, renderedSize / 2 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// ============================================================================
// TRANSFORM FUNCTIONS
// ============================================================================

function initThreeFingerTransform() {
    const positions = eventHandler.getFingerPositions();
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
        transformStart = {
            ...baseTransformStart,
            initialStrokePoints: selectedStroke.points.map(p => ({ ...p }))
        };

        // Save snapshot for undo functionality (only if not already saved)
        if (!hasUndoableTransform) {
            transformSnapshot = selectedStroke.points.map(p => ({ ...p }));
        }
    } else {
        transformStart = baseTransformStart;
    }
}

function applyThreeFingerTransform() {
    if (!transformStart) return;

    const positions = eventHandler.getFingerPositions();
    if (!positions.primary || !positions.secondary || !positions.tertiary) return;

    const currentPivot = {
        x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
        y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
    };

    const dist1 = getDistance(currentPivot, positions.primary);
    const dist2 = getDistance(currentPivot, positions.secondary);
    const dist3 = getDistance(currentPivot, positions.tertiary);
    const currentScale = (dist1 + dist2 + dist3) / 3;

    const angle1 = getAngle(currentPivot, positions.primary);
    const angle2 = getAngle(currentPivot, positions.secondary);
    const angle3 = getAngle(currentPivot, positions.tertiary);

    const delta1 = normalizeAngleDelta(angle1 - transformStart.fingerAngles[0]);
    const delta2 = normalizeAngleDelta(angle2 - transformStart.fingerAngles[1]);
    const delta3 = normalizeAngleDelta(angle3 - transformStart.fingerAngles[2]);

    const averageDelta = (delta1 + delta2 + delta3) / 3;
    transformStart.unwrappedRotation += averageDelta;

    transformStart.fingerAngles = [angle1, angle2, angle3];

    const scaleFactor = currentScale / transformStart.initialScale;
    const rotationDelta = transformStart.unwrappedRotation;

    // Check if we're transforming a selected stroke or the entire canvas
    if (transformStart.initialStrokePoints && selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
        // Transform only the selected stroke
        const selectedStroke = strokeHistory[selectedStrokeIdx];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const point of transformStart.initialStrokePoints) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
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

        // Transform all stroke points
        selectedStroke.points = transformStart.initialStrokePoints.map(point => {
            const dx = point.x - initialStrokeCenter.x;
            const dy = point.y - initialStrokeCenter.y;

            const cos = Math.cos(rotationDelta);
            const sin = Math.sin(rotationDelta);
            const rotatedX = dx * cos - dy * sin;
            const rotatedY = dx * sin + dy * cos;

            const scaledX = rotatedX * scaleFactor;
            const scaledY = rotatedY * scaleFactor;

            return {
                x: scaledX + newStrokeCenter.x,
                y: scaledY + newStrokeCenter.y
            };
        });

        // Update marker to the transformed position of the same point
        if (selectedStrokePointIdx !== null && selectedStrokePointIdx < selectedStroke.points.length) {
            indicatorAnchor = { ...selectedStroke.points[selectedStrokePointIdx] };
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
    // Get rectangle bounds
    const minX = Math.min(rectStart.x, rectEnd.x);
    const maxX = Math.max(rectStart.x, rectEnd.x);
    const minY = Math.min(rectStart.y, rectEnd.y);
    const maxY = Math.max(rectStart.y, rectEnd.y);

    // Check if any point in the stroke is inside or touches the rectangle
    for (const point of stroke.points) {
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
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
// MARKER MOVEMENT
// ============================================================================

function updateMarkerPosition() {
    const positions = eventHandler.getFingerPositions();
    if (!indicatorAnchor) return;

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
            indicatorAnchor.x += canvasDelta.x;
            indicatorAnchor.y += canvasDelta.y;
            panToKeepIndicatorInView();

            if (currentStroke && !isGridMode) {
                currentStroke.points.push({ ...indicatorAnchor });
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
                    indicatorAnchor.x += canvasDelta.x;
                    indicatorAnchor.y += canvasDelta.y;
                    panToKeepIndicatorInView();

                    if (currentStroke && !isGridMode) {
                        currentStroke.points.push({ ...indicatorAnchor });
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
                    indicatorAnchor.x += canvasDelta.x;
                    indicatorAnchor.y += canvasDelta.y;
                    panToKeepIndicatorInView();

                    if (currentStroke && !isGridMode) {
                        currentStroke.points.push({ ...indicatorAnchor });
                    }

                    // Clear the buffer
                    lastDelta = null;
                }
            } else {
                // First delta - buffer it and wait for next
                lastDelta = { x: deltaX, y: deltaY, pointerId: movedPointerId! };
            }
        }
    } else {
        // Single finger mode - process any batched work first
        if (batchedDelta !== null) {
            const canvasDelta = screenDeltaToCanvasDelta(batchedDelta);
            indicatorAnchor.x += canvasDelta.x;
            indicatorAnchor.y += canvasDelta.y;
            panToKeepIndicatorInView();

            batchedDelta = null;
        }

        // Process current delta immediately
        if (deltaX !== 0 || deltaY !== 0) {
            const canvasDelta = screenDeltaToCanvasDelta({ x: deltaX, y: deltaY });
            indicatorAnchor.x += canvasDelta.x;
            indicatorAnchor.y += canvasDelta.y;

            panToKeepIndicatorInView();
        }

        // Clear lastDelta when transitioning from two-finger to one-finger
        if (lastDelta !== null) {
            // Save it as batchedDelta for when we transition back
            batchedDelta = { x: lastDelta.x, y: lastDelta.y };
            lastDelta = null;
        }
    }
}

function addPointToStroke() {
    if (!currentStroke || !indicatorAnchor) return;

    // In grid mode, only add points when moving a full cell size away
    if (isGridMode) {
        if (!lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        const cellSize = getGridCellSize();
        const threshold = cellSize * 0.9;

        const deltaFromLastX = Math.abs(indicatorAnchor.x - lastGridPosition.x);
        const deltaFromLastY = Math.abs(indicatorAnchor.y - lastGridPosition.y);

        if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
            const gridPoint = snapToGrid(indicatorAnchor);

            // Add 9 interpolated points between last grid position and new grid point
            const numInterpolated = 9;
            for (let i = 1; i <= numInterpolated; i++) {
                const t = i / (numInterpolated + 1);
                const interpPoint = {
                    x: lastGridPosition.x + t * (gridPoint.x - lastGridPosition.x),
                    y: lastGridPosition.y + t * (gridPoint.y - lastGridPosition.y)
                };
                currentStroke.points.push(interpPoint);
            }

            // Add the actual grid point
            currentStroke.points.push(gridPoint);
            lastGridPosition = gridPoint;
            // Snap the marker to the grid point while drawing
            indicatorAnchor = { ...gridPoint };
        }
    } else {
        // Normal mode: add every point
        currentStroke.points.push({ ...indicatorAnchor });
    }
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

function handleActions(actions: Action[]): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (indicatorAnchor) {
                    const startPoint = isGridMode ? snapToGrid(indicatorAnchor) : indicatorAnchor;
                    currentStroke = {
                        color: combinedPicker.getColor(),
                        size: combinedPicker.getSize(),
                        points: [{ ...startPoint }]
                    };
                    // In grid mode, initialize lastGridPosition to the start point
                    // but don't snap indicatorAnchor - let it move freely
                    if (isGridMode) {
                        lastGridPosition = { ...startPoint };
                    } else {
                        lastGridPosition = null;
                    }
                }
                break;

            case Action.SAVE_STROKE:
                if (currentStroke && currentStroke.points.length > 0) {
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
                //           Marker stays at its current position
                //           Marks as "fresh stroke" (Undo button will delete it)
                selectedStrokeMarkerPos = indicatorAnchor ? { ...indicatorAnchor } : null;
                // Set selected stroke to the last stroke in history
                if (strokeHistory.length > 0) {
                    selectedStrokeIdx = strokeHistory.length - 1;
                    const selectedStroke = strokeHistory[selectedStrokeIdx];
                    // Set marker to the last point of the stroke
                    if (selectedStroke.points.length > 0) {
                        selectedStrokePointIdx = selectedStroke.points.length - 1;
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
                // SELECT_CLOSEST_STROKE: Manually select stroke closest to marker
                // Triggered by: Single tap (quick tap with no timeout or movement)
                // Behavior: Finds closest stroke to current marker position
                //           Marker jumps to the closest point on that stroke
                //           Marks as manual selection (Del button will delete it)
                //           Updates color/size pickers to match the selected stroke
                // Note: This is different from double-tap, which searches from tap location
                const closestResult = findClosestStrokeAndPoint();
                if (closestResult) {
                    // Move marker to the closest point
                    indicatorAnchor = closestResult.point;
                    // Select the stroke and store the point index
                    selectedStrokeIdx = closestResult.strokeIdx;
                    selectedStrokePointIdx = closestResult.pointIdx;
                    selectedStrokeMarkerPos = { ...closestResult.point };
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
                selectedStrokeMarkerPos = null;
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
                // Start selection rectangle at current marker position
                if (indicatorAnchor) {
                    selectionRectStart = { ...indicatorAnchor };
                    selectionRectEnd = { ...indicatorAnchor };
                    // Initialize position tracking for marker movement
                    const positions = eventHandler.getFingerPositions();
                    lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
                    lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
                    // Update highlighted strokes (initially empty since single tap cleared them)
                    updateHighlightedStrokes();
                }
                break;

            case Action.UPDATE_SELECTION_RECTANGLE:
                // Update selection rectangle end point to current marker position
                if (indicatorAnchor && selectionRectStart) {
                    selectionRectEnd = { ...indicatorAnchor };
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
                // Clear all highlighted strokes
                highlightedStrokes.clear();
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
    if (stroke.points.length < 3) {
        showDebug('Too few points!');
        return; // Not enough points to fit
    }

    // Store original points if not already stored
    if (!stroke.originalPoints) {
        stroke.originalPoints = stroke.points.map(p => ({ ...p }));
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
        const polygonFit = fitEquilateralPolygon(points, stroke.size);

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
            stroke.fittedWithSize = stroke.size;
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
            stroke.fittedWithSize = stroke.size;
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
                stroke.fittedWithSize = stroke.size;
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
                stroke.fittedWithSize = stroke.size;
            }
        }
    } else {
        // For open strokes, use polyline fitting with RDP algorithm
        const polylineFit = fitPolyline(points, stroke.size);

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
                debugText += `\nEpsilon: ${(2 * stroke.size).toFixed(2)}`;
            }

            showDebug(debugText);
        }

        // Use the simplified polyline points
        stroke.fittedPoints = generatePolylinePoints(polylineFit.points);
        stroke.fitType = 'polyline';
        stroke.fittedWithSize = stroke.size;  // Track the size used for fitting
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

    // Update fit button state - only enabled when a stroke is selected
    fitBtn.disabled = selectedStrokeIdx === null;

    // Update fit button active state based on whether the selected stroke is showing fitted
    if (selectedStrokeIdx !== null && selectedStrokeIdx < strokeHistory.length) {
        const stroke = strokeHistory[selectedStrokeIdx];
        fitBtn.classList.toggle('active', stroke.showingFitted === true);
    } else {
        fitBtn.classList.remove('active');
    }
}

function processDelete() {
    if (strokeHistory.length === 0) return;

    // Check if we should undo transformation instead of deleting
    if (hasUndoableTransform && transformSnapshot && selectedStrokeIdx !== null) {
        // Restore the stroke to its pre-transformation state
        strokeHistory[selectedStrokeIdx].points = transformSnapshot.map(p => ({ ...p }));

        // Update marker position to follow the stroke back to its original position
        if (selectedStrokePointIdx !== null && selectedStrokePointIdx < transformSnapshot.length) {
            indicatorAnchor = { ...transformSnapshot[selectedStrokePointIdx] };
            selectedStrokeMarkerPos = { ...indicatorAnchor };
            panToKeepIndicatorInView();
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

    // Save marker position before deletion (for finding closest stroke after)
    const markerPosBeforeDeletion = indicatorAnchor ? { ...indicatorAnchor } : null;

    // Move marker to the beginning of the stroke being removed
    if (deletedStroke.points.length > 0) {
        indicatorAnchor = { ...deletedStroke.points[0] };
        panToKeepIndicatorInView();
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
        if (wasManualSelection && markerPosBeforeDeletion) {
            // Manual selection (Del button) - restore marker position and find closest stroke
            indicatorAnchor = markerPosBeforeDeletion;
            const result = findClosestStrokeAndPoint();
            if (result) {
                selectedStrokeIdx = result.strokeIdx;
                selectedStrokePointIdx = result.pointIdx;
                indicatorAnchor = { ...result.point };
                selectedStrokeMarkerPos = { ...indicatorAnchor };
                panToKeepIndicatorInView();
                // Update pickers to match the newly selected stroke
                updatePickersForSelectedStroke();
            }
        } else {
            // Fresh stroke mode (Undo button) - DON'T select any stroke
            // The marker is already at the beginning of the deleted stroke
            selectedStrokeIdx = null;
            selectedStrokePointIdx = null;
            selectedStrokeMarkerPos = null;
        }
    } else {
        // No more strokes - deselect
        selectedStrokeIdx = null;
        selectedStrokePointIdx = null;
        selectedStrokeMarkerPos = null;
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
    indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
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

    // Calculate bounding box of the source stroke
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of sourceStroke.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    const centerX = (minX + maxX) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    // Mirror points around vertical line through center, then offset
    const offsetX = width * 0.25;  // Right by 1/4 of bounding box width
    const offsetY = -height * 0.5;  // Up by 1/2 of bounding box height

    const duplicatedPoints = sourceStroke.points.map(point => {
        // Mirror around vertical line (x = centerX)
        const mirroredX = centerX - (point.x - centerX);

        // Apply offset
        return {
            x: mirroredX + offsetX,
            y: point.y + offsetY
        };
    });

    // Create the duplicated stroke
    const duplicatedStroke: Stroke = {
        color: sourceStroke.color,
        size: sourceStroke.size,
        points: duplicatedPoints
    };

    // Copy fitted data if it exists
    if (sourceStroke.originalPoints) {
        const duplicatedOriginalPoints = sourceStroke.originalPoints.map(point => {
            const mirroredX = centerX - (point.x - centerX);
            return {
                x: mirroredX + offsetX,
                y: point.y + offsetY
            };
        });
        duplicatedStroke.originalPoints = duplicatedOriginalPoints;
    }

    if (sourceStroke.fittedPoints) {
        const duplicatedFittedPoints = sourceStroke.fittedPoints.map(point => {
            const mirroredX = centerX - (point.x - centerX);
            return {
                x: mirroredX + offsetX,
                y: point.y + offsetY
            };
        });
        duplicatedStroke.fittedPoints = duplicatedFittedPoints;
    }

    if (sourceStroke.fitType) {
        duplicatedStroke.fitType = sourceStroke.fitType;
    }

    if (sourceStroke.showingFitted !== undefined) {
        duplicatedStroke.showingFitted = sourceStroke.showingFitted;
    }

    if (sourceStroke.fittedWithSize !== undefined) {
        duplicatedStroke.fittedWithSize = sourceStroke.fittedWithSize;
    }

    // Add the duplicated stroke to history
    strokeHistory.push(duplicatedStroke);

    // Select the new stroke and move marker to its last point
    selectedStrokeIdx = strokeHistory.length - 1;
    if (duplicatedPoints.length > 0) {
        selectedStrokePointIdx = duplicatedPoints.length - 1;
        indicatorAnchor = { ...duplicatedPoints[duplicatedPoints.length - 1] };
        selectedStrokeMarkerPos = { ...indicatorAnchor };
        panToKeepIndicatorInView();
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

function handlePointerDown(e: PointerEvent) {
    e.preventDefault();

    // Close any open pickers on canvas tap
    combinedPicker.close();

    const pos = getPointerPos(e);
    const now = Date.now();

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

    // Capture pointer
    canvas.setPointerCapture(e.pointerId);

    // Pass to event handler
    eventHandler.handlePointerDown(e.pointerId, pos);
}

function handlePointerMove(e: PointerEvent) {
    e.preventDefault();

    const pos = getPointerPos(e);
    eventHandler.handlePointerMove(e.pointerId, pos);

    const state = stateMachine.getState();

    // Tap-and-a-half detection: if user is holding second tap and moves, enter selection rectangle
    if (isTrackingDoubleTap && state === State.MovingMarker) {
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
    if (state === State.MovingMarker || state === State.Drawing) {
        updateMarkerPosition();

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

        // Update marker position and selection rectangle
        updateMarkerPosition();
        if (indicatorAnchor && selectionRectStart) {
            selectionRectEnd = { ...indicatorAnchor };
            // Update highlighted strokes in real-time as the rectangle changes
            updateHighlightedStrokes();
        }
        redraw();
    }
}

function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    const pos = getPointerPos(e);
    const now = Date.now();

    eventHandler.handlePointerUp(e.pointerId);

    // Clean up movement tracking if all fingers are up
    if (eventHandler.getFingerCount() === 0) {
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
                // Move marker to the closest point
                indicatorAnchor = result.point;
                // Select the stroke and store the point index
                selectedStrokeIdx = result.strokeIdx;
                selectedStrokePointIdx = result.pointIdx;
                selectedStrokeMarkerPos = { ...result.point };
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
                   getDistance(pos, firstTapDownPos) < DOUBLE_TAP_DISTANCE) {
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

        lastPrimaryPos = null;
        lastSecondaryPos = null;
        lastDelta = null;
        batchedDelta = null;

        // Mark transformation as complete if a stroke was transformed
        if (transformStart && transformStart.initialStrokePoints && transformSnapshot) {
            hasUndoableTransform = true;
            updateDelButton();
        }
        transformStart = null;

        // Clamp indicator after transform
        clampIndicatorToView();

        // Snap to grid in grid mode
        if (isGridMode && indicatorAnchor) {
            indicatorAnchor = snapToGrid(indicatorAnchor);
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
    clampIndicatorToView();
    redraw();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerUp);
canvas.addEventListener('pointerleave', handlePointerUp);

canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchend', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchcancel', e => e.preventDefault(), { passive: false });

delBtn.addEventListener('click', () => eventHandler.handleDelete());
clearBtn.addEventListener('click', () => eventHandler.handleClear());

gridToggleBtn.addEventListener('click', () => {
    isGridMode = !isGridMode;
    gridToggleBtn.classList.toggle('active', isGridMode);

    if (isGridMode && indicatorAnchor) {
        indicatorAnchor = snapToGrid(indicatorAnchor);
    }
    redraw();
});

btnDup.addEventListener('click', () => {
    duplicateSelectedStroke();
});

fitBtn.addEventListener('click', () => {
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
                      (isSizeDependentFit && stroke.fittedWithSize !== stroke.size);

    if (turningOn && needsRefit) {
        fitStroke(stroke);
    }

    // Toggle display between fitted and original
    if (stroke.fittedPoints && stroke.originalPoints) {
        stroke.showingFitted = turningOn;
        stroke.points = turningOn ? stroke.fittedPoints : stroke.originalPoints;
        updateDelButton();  // Update button state to reflect the change
        redraw();
    }
});

window.addEventListener('resize', resizeCanvas);

// ============================================================================
// INITIALIZATION
// ============================================================================

resizeCanvas();
updateDelButton();
indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
