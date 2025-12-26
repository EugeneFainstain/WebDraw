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
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
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

// Reference position for fresh stroke tracking
let freshStrokeMarkerPos: Point | null = null;

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
    initialStrokePoints?: Point[];  // For fresh stroke transformation
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

const colorPicker = createColorPicker(colorPickerEl, () => {});
const sizePicker = createSizePicker(sizePickerEl, () => {
    redraw();
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
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

        // Inner ring (white, or green if in fresh stroke mode)
        const isFreshStroke = stateMachine.isFreshStroke();
        ctx.beginPath();
        ctx.arc(indicatorPos.x, indicatorPos.y, renderedSize / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = isFreshStroke ? 'lime' : 'white';
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

    // If in fresh stroke state, store initial stroke points for transformation
    if (stateMachine.isFreshStroke() && strokeHistory.length > 0) {
        const lastStroke = strokeHistory[strokeHistory.length - 1];
        transformStart = {
            ...baseTransformStart,
            initialStrokePoints: lastStroke.points.map(p => ({ ...p }))
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

    // Check if we're transforming a fresh stroke or the entire canvas
    if (transformStart.initialStrokePoints && strokeHistory.length > 0) {
        // Transform only the last stroke
        const lastStroke = strokeHistory[strokeHistory.length - 1];

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

        lastStroke.points = transformStart.initialStrokePoints.map(point => {
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

        // Move the marker to the last point of the transformed stroke
        if (lastStroke.points.length > 0) {
            indicatorAnchor = { ...lastStroke.points[lastStroke.points.length - 1] };
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

            if (currentStroke) {
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

                    if (currentStroke) {
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

                    if (currentStroke) {
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
        const cellSize = getGridCellSize();
        const threshold = cellSize;

        if (lastGridPosition === null) {
            lastGridPosition = snapToGrid(indicatorAnchor);
        } else {
            const deltaFromLastX = Math.abs(indicatorAnchor.x - lastGridPosition.x);
            const deltaFromLastY = Math.abs(indicatorAnchor.y - lastGridPosition.y);

            if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
                const gridPoint = snapToGrid(indicatorAnchor);
                currentStroke.points.push(gridPoint);
                lastGridPosition = gridPoint;
                indicatorAnchor = gridPoint;
            }
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
                    lastGridPosition = null;
                }
                break;

            case Action.SAVE_STROKE:
                if (currentStroke && currentStroke.points.length > 0) {
                    strokeHistory.push(currentStroke);
                    updateUndoButton();
                }
                currentStroke = null;
                lastGridPosition = null;
                break;

            case Action.ABANDON_STROKE:
                currentStroke = null;
                lastGridPosition = null;
                break;

            case Action.ENTER_FRESH_STROKE:
                freshStrokeMarkerPos = indicatorAnchor ? { ...indicatorAnchor } : null;
                break;

            case Action.EXIT_FRESH_STROKE:
                freshStrokeMarkerPos = null;
                break;

            case Action.INIT_TRANSFORM:
                initThreeFingerTransform();
                break;

            case Action.PROCESS_UNDO:
                processUndo();
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

function updateUndoButton() {
    undoBtn.disabled = strokeHistory.length === 0;
}

function processUndo() {
    if (strokeHistory.length > 0) {
        const lastStroke = strokeHistory[strokeHistory.length - 1];

        // Move marker to the beginning of the stroke being removed
        if (lastStroke.points.length > 0) {
            indicatorAnchor = { ...lastStroke.points[0] };
            panToKeepIndicatorInView();
        }

        strokeHistory.pop();
        updateUndoButton();
    }
}

function processClear() {
    strokeHistory = [];
    currentStroke = null;
    lastGridPosition = null;
    transformStart = null;
    viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
    updateUndoButton();

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

    const pos = getPointerPos(e);

    // Check for double-tap to reset indicator position
    const now = Date.now();
    const isDoubleTap = now - lastTapTime < DOUBLE_TAP_DELAY &&
                        lastTapPos !== null &&
                        getDistance(pos, lastTapPos) < DOUBLE_TAP_DISTANCE;

    if (isDoubleTap && eventHandler.getFingerCount() === 0) {
        setIndicatorToDefaultPosition(pos);
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

undoBtn.addEventListener('click', () => eventHandler.handleUndo());
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
updateUndoButton();
indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
