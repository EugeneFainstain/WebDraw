import '../styles.css';
import { createColorPicker } from './colorPicker';
import { createSizePicker } from './sizePicker';
import { StateMachine, State, Event, Action, TransitionResult } from './stateMachine';
import { EventHandler, Point } from './eventHandler';

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPickerEl = document.getElementById('colorPicker') as HTMLElement;
const sizePickerEl = document.getElementById('sizePicker') as HTMLElement;
const delBtn = document.getElementById('delBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const xPlusModeCheckbox = document.getElementById('xPlusMode') as HTMLInputElement;

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface Stroke {
    color: string;
    size: number;
    points: Point[];
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

// Track last grid position for X+ mode
let lastGridPosition: Point | null = null;

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

// Double-tap detection for indicator reset
let lastTapTime = 0;
let lastTapPos: Point | null = null;
const DOUBLE_TAP_DELAY = 300; // ms
const DOUBLE_TAP_DISTANCE = 50; // pixels

// ============================================================================
// CUSTOM UI COMPONENTS
// ============================================================================

const colorPicker = createColorPicker(
    colorPickerEl,
    (color: string) => {
        // If a stroke is selected, update its color
        if (selectedStrokeIdx !== null) {
            strokeHistory[selectedStrokeIdx].color = color;
        }
        redraw();
    },
    () => sizePicker.close() // Close size picker when color picker opens
);
const sizePicker = createSizePicker(
    sizePickerEl,
    (size: number) => {
        // If a stroke is selected, update its size
        if (selectedStrokeIdx !== null) {
            strokeHistory[selectedStrokeIdx].size = size;
        }
        redraw();
    },
    () => colorPicker.close() // Close color picker when size picker opens
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
        colorPicker.setColor(stroke.color);
        sizePicker.setSize(stroke.size);
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

function findClosestStrokeAndPoint(): { strokeIdx: number; pointIdx: number; point: Point } | null {
    if (strokeHistory.length === 0 || !indicatorAnchor) {
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
            const dx = point.x - indicatorAnchor.x;
            const dy = point.y - indicatorAnchor.y;
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
// GRID FUNCTIONS (X+ MODE)
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

function drawStroke(stroke: Stroke) {
    const minSize = screenLengthToCanvasLength(1);
    const renderSize = Math.max(stroke.size, minSize);

    if (stroke.points.length < 2) {
        if (stroke.points.length === 1) {
            ctx.fillStyle = stroke.color;
            ctx.beginPath();
            ctx.arc(stroke.points[0].x, stroke.points[0].y, renderSize / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

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

    // Draw grid if X+ mode is enabled
    if (xPlusModeCheckbox.checked) {
        drawGrid();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw completed strokes
    strokeHistory.forEach(stroke => {
        drawStroke(stroke);
    });

    // Draw current in-progress stroke
    if (currentStroke) {
        drawStroke(currentStroke);
    }

    ctx.restore();

    // Draw marker indicator (in screen space)
    if (indicatorAnchor) {
        const indicatorPos = getIndicatorScreenPos();
        const strokeSize = sizePicker.getSize();
        const renderedSize = Math.max(strokeSize * viewTransform.scale, 1);
        const drawColor = colorPicker.getColor();
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

            if (currentStroke && !xPlusModeCheckbox.checked) {
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

                    if (currentStroke && !xPlusModeCheckbox.checked) {
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

                    if (currentStroke && !xPlusModeCheckbox.checked) {
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

    // In X+ mode, only add points when moving a full cell size away
    if (xPlusModeCheckbox.checked) {
        if (!lastGridPosition) return; // Should already be initialized in CREATE_STROKE

        const cellSize = getGridCellSize();
        const threshold = cellSize * 0.9;

        const deltaFromLastX = Math.abs(indicatorAnchor.x - lastGridPosition.x);
        const deltaFromLastY = Math.abs(indicatorAnchor.y - lastGridPosition.y);

        if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
            const gridPoint = snapToGrid(indicatorAnchor);
            currentStroke.points.push(gridPoint);
            lastGridPosition = gridPoint;
            // Don't snap indicatorAnchor - let it move freely for smooth visual feedback
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
                    const startPoint = xPlusModeCheckbox.checked ? snapToGrid(indicatorAnchor) : indicatorAnchor;
                    currentStroke = {
                        color: colorPicker.getColor(),
                        size: sizePicker.getSize(),
                        points: [{ ...startPoint }]
                    };
                    // In X+ mode, initialize lastGridPosition to the start point
                    // but don't snap indicatorAnchor - let it move freely
                    if (xPlusModeCheckbox.checked) {
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
                // Mark as fresh stroke (just drew)
                isFreshStroke = true;
                updateDelButton();
                break;

            case Action.DESELECT_STROKE:
                selectedStrokeMarkerPos = null;
                selectedStrokeIdx = null;
                selectedStrokePointIdx = null;
                // Don't change isFreshStroke - it persists through deselection
                updateDelButton();
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
// UNDO AND CLEAR
// ============================================================================

function updateDelButton() {
    const hasStrokes = strokeHistory.length > 0;

    // Determine button state based on requirements:
    // a) No strokes → disabled "Undo" (ONLY scenario for disabled "Undo")
    // b) Fresh stroke (just drew) → enabled "Undo"
    // c) Manually selected stroke → enabled "Del"
    // d) Exited selected mode (not fresh) → disabled "Del"

    if (!hasStrokes) {
        // a) No strokes - disabled "Undo" (ONLY time disabled shows "Undo")
        delBtn.disabled = true;
        delBtn.textContent = 'Undo';
    } else if (isFreshStroke) {
        // b) Fresh stroke mode - enabled "Undo"
        delBtn.disabled = false;
        delBtn.textContent = 'Undo';
    } else if (selectedStrokeIdx !== null) {
        // c) Manually selected stroke - enabled "Del"
        delBtn.disabled = false;
        delBtn.textContent = 'Del';
    } else {
        // d) Exited selected mode (not fresh) - disabled "Del"
        delBtn.disabled = true;
        delBtn.textContent = 'Del';
    }
}

function processDelete() {
    if (strokeHistory.length === 0) return;

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

    // After deletion, always exit fresh stroke mode and keep selection
    const wasFresh = isFreshStroke;
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
            // Fresh stroke mode (Undo button) - select preceding stroke
            if (indexToDelete === 0) {
                // Very first stroke was deleted - select the very last stroke
                selectedStrokeIdx = strokeHistory.length - 1;
            } else {
                // Select the preceding stroke (index is now shifted after deletion)
                selectedStrokeIdx = indexToDelete - 1;
            }

            // Update marker to point to the selected stroke
            const newSelectedStroke = strokeHistory[selectedStrokeIdx];
            if (newSelectedStroke.points.length > 0) {
                selectedStrokePointIdx = newSelectedStroke.points.length - 1;
                indicatorAnchor = { ...newSelectedStroke.points[selectedStrokePointIdx] };
                selectedStrokeMarkerPos = { ...indicatorAnchor };
                panToKeepIndicatorInView();
            }

            // If it was fresh, keep fresh mode
            if (wasFresh) {
                isFreshStroke = true;
            }

            // Update pickers to match the newly selected stroke
            updatePickersForSelectedStroke();
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
    viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
    isFreshStroke = false;
    updateDelButton();

    // Reset state machine and event handler
    stateMachine.reset();
    eventHandler.reset();
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
    colorPicker.close();
    sizePicker.close();

    const pos = getPointerPos(e);

    // Check for double-tap to select closest stroke
    const now = Date.now();
    const isDoubleTap = now - lastTapTime < DOUBLE_TAP_DELAY &&
                        lastTapPos !== null &&
                        getDistance(pos, lastTapPos) < DOUBLE_TAP_DISTANCE;

    if (isDoubleTap && eventHandler.getFingerCount() === 0) {
        // Find closest stroke and point to the current marker position
        const result = findClosestStrokeAndPoint();
        if (result) {
            // Move marker to the closest point
            indicatorAnchor = result.point;
            // Select the stroke and store the point index
            selectedStrokeIdx = result.strokeIdx;
            selectedStrokePointIdx = result.pointIdx;
            selectedStrokeMarkerPos = { ...result.point };
            // Manual selection exits fresh stroke mode
            isFreshStroke = false;
            // Update state machine to reflect selection
            stateMachine.setStrokeSelected(true);
            updateDelButton();
            // Update color and size pickers to match selected stroke
            updatePickersForSelectedStroke();
        }
        lastTapTime = 0;
        lastTapPos = null;
        redraw();
        return;
    } else {
        lastTapTime = now;
        lastTapPos = pos;
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
    }
}

function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    eventHandler.handlePointerUp(e.pointerId);

    // Clean up movement tracking if all fingers are up
    if (eventHandler.getFingerCount() === 0) {
        lastPrimaryPos = null;
        lastSecondaryPos = null;
        lastDelta = null;
        batchedDelta = null;
        transformStart = null;

        // Clamp indicator after transform
        clampIndicatorToView();

        // Snap to grid in X+ mode
        if (xPlusModeCheckbox.checked && indicatorAnchor) {
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

xPlusModeCheckbox.addEventListener('change', () => {
    if (xPlusModeCheckbox.checked && indicatorAnchor) {
        indicatorAnchor = snapToGrid(indicatorAnchor);
    }
    redraw();
});

window.addEventListener('resize', resizeCanvas);

// ============================================================================
// INITIALIZATION
// ============================================================================

resizeCanvas();
updateDelButton();
indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
