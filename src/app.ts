import '../styles.css' ;
import { createColorPicker } from './colorPicker';
import { createSizePicker } from './sizePicker';

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPickerEl = document.getElementById('colorPicker') as HTMLElement;
const sizePickerEl = document.getElementById('sizePicker') as HTMLElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const xPlusModeCheckbox = document.getElementById('xPlusMode') as HTMLInputElement;

interface Point {
    x: number;
    y: number;
}

interface Stroke {
    color: string;
    size: number;
    points: Point[];
}

// History for undo functionality
let strokeHistory: Stroke[] = [];

// Gesture mode
type GestureMode = 'none' | 'drawing' | 'transform';
let gestureMode: GestureMode = 'none';

// Pointer tracking
let primaryPointerId: number | null = null;
let secondaryPointerId: number | null = null;
let tertiaryPointerId: number | null = null;
let primaryPos: Point | null = null;
let secondaryPos: Point | null = null;
let tertiaryPos: Point | null = null;

// Drawing state
let currentStroke: Stroke | null = null;
let isDrawing = false;
let lastGridPosition: Point | null = null; // Track last grid position for X+ mode

// Transform state
let viewTransform = {
    scale: 1,
    rotation: 0,  // in radians
    panX: 0,
    panY: 0
};
let transformStart: {
    pivot: Point;
    initialScale: number;
    fingerAngles: number[];  // Initial raw angle from pivot to each finger (for unwrapping)
    unwrappedRotation: number;  // Accumulated unwrapped rotation
    initialTransform: typeof viewTransform;
} | null = null;

// Indicator anchor point (in canvas coordinates, not screen coordinates)
// null means use default position
let indicatorAnchor: Point | null = null;
let lastPrimaryPos: Point | null = null; // For tracking finger movement delta
let lastSecondaryPos: Point | null = null; // For tracking secondary finger movement delta

// Two-finger delta buffering - store last delta to average with next one
let lastDelta: { x: number, y: number, pointerId: number } | null = null;
// Batched delta for frame rate consistency
let batchedDelta: { x: number, y: number } | null = null;

// Double-tap detection
let lastTapTime = 0;
let lastTapPos: Point | null = null;
const DOUBLE_TAP_DELAY = 300; // ms
const DOUBLE_TAP_DISTANCE = 50; // pixels - max distance between taps for double-tap

// Track when second finger touches down for stroke protection
let secondFingerDownTime = 0;
const STROKE_PROTECTION_DELAY = 250; // ms - if third finger lands after this, save the stroke

// Initialize custom color picker
const colorPicker = createColorPicker(colorPickerEl, () => {});

// Initialize custom size picker
const sizePicker = createSizePicker(sizePickerEl, () => {
    redraw();
});

// Calculate distance between two points
function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Calculate angle between two points
function getAngle(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// Get midpoint between two points
function getMidpoint(p1: Point, p2: Point): Point {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

// Transform a point from screen coordinates to canvas coordinates
function screenToCanvas(screenPos: Point): Point {
    const cos = Math.cos(-viewTransform.rotation);
    const sin = Math.sin(-viewTransform.rotation);

    // Remove pan
    const x1 = screenPos.x - viewTransform.panX;
    const y1 = screenPos.y - viewTransform.panY;

    // Remove rotation (rotate around center)
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    // Remove scale (scale around center)
    const x3 = (x2 - cx) / viewTransform.scale + cx;
    const y3 = (y2 - cy) / viewTransform.scale + cy;

    return { x: x3, y: y3 };
}

// Transform a point from canvas coordinates to screen coordinates
function canvasToScreen(canvasPos: Point): Point {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Apply scale (around center)
    const x1 = (canvasPos.x - cx) * viewTransform.scale + cx;
    const y1 = (canvasPos.y - cy) * viewTransform.scale + cy;

    // Apply rotation (around center)
    const cos = Math.cos(viewTransform.rotation);
    const sin = Math.sin(viewTransform.rotation);
    const x2 = cos * (x1 - cx) - sin * (y1 - cy) + cx;
    const y2 = sin * (x1 - cx) + cos * (y1 - cy) + cy;

    // Apply pan
    const x3 = x2 + viewTransform.panX;
    const y3 = y2 + viewTransform.panY;

    return { x: x3, y: y3 };
}

// Get default indicator offset (1/8th of max dimension, at 45 degrees towards upper-left)
function getDefaultIndicatorOffset(): Point {
    const maxDim = Math.max(canvas.width, canvas.height);
    const offset = maxDim / 8;
    // 45 degrees means equal x and y offset (offset * cos(45) = offset * sin(45) = offset / sqrt(2))
    const diagonalOffset = offset / Math.SQRT2;
    return {
        x: -diagonalOffset,  // towards left
        y: -diagonalOffset   // towards top
    };
}

// Set indicator to default position relative to a screen point, clamped to view
function setIndicatorToDefaultPosition(screenPos: Point): void {
    const offset = getDefaultIndicatorOffset();
    const targetScreenPos = {
        x: screenPos.x + offset.x,
        y: screenPos.y + offset.y
    };

    // Clamp to visible area
    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, targetScreenPos.x));
    const clampedY = Math.max(margin, Math.min(canvas.height - margin, targetScreenPos.y));

    // Convert to canvas coordinates
    indicatorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
}

// Clamp indicator anchor to visible view (actually moves the anchor if needed)
// Used when ending zoom/pan operations
function clampIndicatorToView(): void {
    if (!indicatorAnchor) return;
    const screenPos = canvasToScreen(indicatorAnchor);

    const margin = 10;
    const clampedX = Math.max(margin, Math.min(canvas.width - margin, screenPos.x));
    const clampedY = Math.max(margin, Math.min(canvas.height - margin, screenPos.y));

    // If clamping was needed, update the anchor position
    if (clampedX !== screenPos.x || clampedY !== screenPos.y) {
        indicatorAnchor = screenToCanvas({ x: clampedX, y: clampedY });
    }
}

// Pan the canvas to keep the indicator in view (instead of clamping the indicator)
// Used when moving the marker
function panToKeepIndicatorInView(): void {
    if (!indicatorAnchor) return;
    const screenPos = canvasToScreen(indicatorAnchor);

    const margin = 10;
    let panDeltaX = 0;
    let panDeltaY = 0;

    // Check if indicator is outside the visible area and calculate pan needed
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

    // Apply pan if needed
    if (panDeltaX !== 0 || panDeltaY !== 0) {
        viewTransform.panX += panDeltaX;
        viewTransform.panY += panDeltaY;
    }
}

// Get indicator screen position
function getIndicatorScreenPos(): Point {
    if (!indicatorAnchor) {
        // Fallback to center of screen if no anchor set
        return { x: canvas.width / 2, y: canvas.height / 4 };
    }
    return canvasToScreen(indicatorAnchor);
}

// Get grid cell size (based on default stroke size of 6)
function getGridCellSize(): number {
    const defaultStrokeSize = 6;
    return defaultStrokeSize * 4;
}

// Snap a point to the nearest grid junction
function snapToGrid(point: Point): Point {
    const cellSize = getGridCellSize();
    return {
        x: Math.round(point.x / cellSize) * cellSize,
        y: Math.round(point.y / cellSize) * cellSize
    };
}

// Draw grid with light blue lines
function drawGrid() {
    const cellSize = getGridCellSize();

    // Draw grid lines with light blue color
    ctx.strokeStyle = 'lightblue';
    ctx.lineWidth = 1 / viewTransform.scale; // Keep grid lines thin regardless of zoom
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // Calculate the visible area in canvas coordinates
    // Transform screen corners to canvas coordinates to get visible bounds
    const topLeft = screenToCanvas({ x: 0, y: 0 });
    const topRight = screenToCanvas({ x: canvas.width, y: 0 });
    const bottomLeft = screenToCanvas({ x: 0, y: canvas.height });
    const bottomRight = screenToCanvas({ x: canvas.width, y: canvas.height });

    // Find the bounding box in canvas coordinates
    const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    // Extend bounds slightly to ensure full coverage
    const margin = cellSize * 2;
    const gridLeft = Math.floor((minX - margin) / cellSize) * cellSize;
    const gridRight = Math.ceil((maxX + margin) / cellSize) * cellSize;
    const gridTop = Math.floor((minY - margin) / cellSize) * cellSize;
    const gridBottom = Math.ceil((maxY + margin) / cellSize) * cellSize;

    // Draw vertical lines
    for (let x = gridLeft; x <= gridRight; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, gridTop);
        ctx.lineTo(x, gridBottom);
        ctx.stroke();
    }

    // Draw horizontal lines
    for (let y = gridTop; y <= gridBottom; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(gridLeft, y);
        ctx.lineTo(gridRight, y);
        ctx.stroke();
    }
}

// Resize canvas to fill window
function resizeCanvas() {
    const toolbarHeight = 60;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;
    clampIndicatorToView();
    redraw();
}

// Redraw all strokes from history + current state
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

    // Draw marker indicator (in screen space, not transformed) - always visible when anchor exists
    if (indicatorAnchor) {
        const indicatorPos = getIndicatorScreenPos();
        // Calculate the actual rendered size (stroke size * zoom, but at least 1 pixel)
        const strokeSize = sizePicker.getSize();
        const renderedSize = Math.max(strokeSize * viewTransform.scale, 1);
        const drawColor = colorPicker.getColor();
        const isWhite = drawColor.toUpperCase() === '#FFFFFF';
        const outerColor = isWhite ? 'black' : drawColor;

        // Always draw the same indicator style (two rings)
        // Inner ring (white)
        ctx.beginPath();
        ctx.arc(indicatorPos.x, indicatorPos.y, renderedSize / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Outer ring (draw color, or black if white)
        ctx.beginPath();
        ctx.arc(indicatorPos.x, indicatorPos.y, renderedSize / 2 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = 2;
        ctx.stroke()
    }
}

// Draw a single stroke
function drawStroke(stroke: Stroke) {
    // Ensure stroke width is at least 1 pixel when rendered (accounting for zoom)
    const minSize = 1 / viewTransform.scale;
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

// Get pointer position relative to canvas
function getPointerPos(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// Normalize angle difference to [-PI, PI]
function normalizeAngleDelta(delta: number): number {
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return delta;
}

// Calculate the pivot point and initial transform state for 3-finger gesture
function initThreeFingerTransform() {
    if (!primaryPos || !secondaryPos || !tertiaryPos) return;

    // Calculate pivot as average of all three finger positions
    const pivot = {
        x: (primaryPos.x + secondaryPos.x + tertiaryPos.x) / 3,
        y: (primaryPos.y + secondaryPos.y + tertiaryPos.y) / 3
    };

    // Calculate average distance from pivot to fingers
    const dist1 = getDistance(pivot, primaryPos);
    const dist2 = getDistance(pivot, secondaryPos);
    const dist3 = getDistance(pivot, tertiaryPos);
    const initialScale = (dist1 + dist2 + dist3) / 3;

    // Calculate raw angle from pivot to each finger (for unwrapping later)
    const angle1 = getAngle(pivot, primaryPos);
    const angle2 = getAngle(pivot, secondaryPos);
    const angle3 = getAngle(pivot, tertiaryPos);

    transformStart = {
        pivot,
        initialScale,
        fingerAngles: [angle1, angle2, angle3],
        unwrappedRotation: 0,  // Start with no rotation
        initialTransform: { ...viewTransform }
    };
}

// Handle pointer down
function handlePointerDown(e: PointerEvent) {
    e.preventDefault();

    const pos = getPointerPos(e);

    // First finger
    if (primaryPointerId === null) {
        primaryPointerId = e.pointerId;
        primaryPos = pos;
        lastPrimaryPos = pos;

        // Check for double-tap to reset indicator position
        const now = Date.now();
        const isDoubleTap = now - lastTapTime < DOUBLE_TAP_DELAY &&
                            lastTapPos !== null &&
                            getDistance(pos, lastTapPos) < DOUBLE_TAP_DISTANCE;

        if (isDoubleTap) {
            // Double-tap detected - reset indicator to default position relative to finger
            setIndicatorToDefaultPosition(pos);
            lastTapTime = 0; // Prevent triple-tap detection
            lastTapPos = null;
        } else {
            lastTapTime = now;
            lastTapPos = pos;
        }

        // Enter drawing mode immediately
        gestureMode = 'drawing';
        redraw();
        return;
    }

    // Second finger
    if (secondaryPointerId === null) {
        secondaryPointerId = e.pointerId;
        secondaryPos = pos;
        lastSecondaryPos = pos;

        // Record time for stroke protection
        secondFingerDownTime = Date.now();

        // If in drawing mode, second finger starts/continues drawing
        if (gestureMode === 'drawing' && primaryPos && indicatorAnchor) {
            if (!isDrawing) {
                isDrawing = true;
                // Clear any batched work when starting a new stroke
                batchedDelta = null;
                // Reset grid tracking for X+ mode
                lastGridPosition = null;
                // Use the indicator anchor position for drawing
                const startPoint = xPlusModeCheckbox.checked ? snapToGrid(indicatorAnchor) : indicatorAnchor;
                currentStroke = {
                    color: colorPicker.getColor(),
                    size: sizePicker.getSize(),
                    points: [{ ...startPoint }]
                };
            }
            redraw();
        }

        return;
    }

    // Third finger - enter transform mode
    if (tertiaryPointerId === null) {
        tertiaryPointerId = e.pointerId;
        tertiaryPos = pos;

        // Switch to transform mode (even if we were drawing)
        gestureMode = 'transform';

        // Check if stroke should be protected (save if >250ms elapsed)
        const elapsedTime = Date.now() - secondFingerDownTime;
        if (currentStroke && elapsedTime > STROKE_PROTECTION_DELAY) {
            // Save the stroke instead of aborting
            if (currentStroke.points.length > 0) {
                strokeHistory.push(currentStroke);
                updateUndoButton();
            }
        }

        // Clear the stroke
        currentStroke = null;
        isDrawing = false;
        lastGridPosition = null;

        // Initialize 3-finger transform
        initThreeFingerTransform();
        redraw();
        return;
    }

    // Fourth+ fingers - ignore
}

// Handle pointer move
function handlePointerMove(e: PointerEvent) {
    e.preventDefault();

    // Get coalesced events for smoother drawing on iOS
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

    // Process all coalesced events
    for (const event of events) {
        processPointerMove(event);
    }
}

// Process a single pointer move event
function processPointerMove(e: PointerEvent) {
    const pos = getPointerPos(e);

    // Update positions and calculate delta
    let deltaX = 0;
    let deltaY = 0;

    if (e.pointerId === primaryPointerId) {
        if (lastPrimaryPos) {
            deltaX = pos.x - lastPrimaryPos.x;
            deltaY = pos.y - lastPrimaryPos.y;
        }
        primaryPos = pos;
        lastPrimaryPos = pos;
    } else if (e.pointerId === secondaryPointerId) {
        if (lastSecondaryPos) {
            deltaX = pos.x - lastSecondaryPos.x;
            deltaY = pos.y - lastSecondaryPos.y;
        }
        secondaryPos = pos;
        lastSecondaryPos = pos;
    } else if (e.pointerId === tertiaryPointerId) {
        tertiaryPos = pos;
        // No delta needed for tertiary
    } else {
        return;
    }

    // Handle 3-finger transform gesture
    if (gestureMode === 'transform' && transformStart && primaryPos && secondaryPos && tertiaryPos) {
        // Calculate current pivot (average of three finger positions)
        const currentPivot = {
            x: (primaryPos.x + secondaryPos.x + tertiaryPos.x) / 3,
            y: (primaryPos.y + secondaryPos.y + tertiaryPos.y) / 3
        };

        // Calculate current average distance from pivot to fingers
        const dist1 = getDistance(currentPivot, primaryPos);
        const dist2 = getDistance(currentPivot, secondaryPos);
        const dist3 = getDistance(currentPivot, tertiaryPos);
        const currentScale = (dist1 + dist2 + dist3) / 3;

        // Calculate current raw angles for each finger
        const angle1 = getAngle(currentPivot, primaryPos);
        const angle2 = getAngle(currentPivot, secondaryPos);
        const angle3 = getAngle(currentPivot, tertiaryPos);

        // Calculate unwrapped angle deltas for each finger
        const delta1 = normalizeAngleDelta(angle1 - transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - transformStart.fingerAngles[1]);
        const delta3 = normalizeAngleDelta(angle3 - transformStart.fingerAngles[2]);

        // Average the angle deltas and accumulate to unwrapped rotation
        const averageDelta = (delta1 + delta2 + delta3) / 3;
        transformStart.unwrappedRotation += averageDelta;

        // Update stored angles for next iteration
        transformStart.fingerAngles = [angle1, angle2, angle3];

        // Calculate scale and rotation changes
        const scaleFactor = currentScale / transformStart.initialScale;
        const newScale = transformStart.initialTransform.scale * scaleFactor;
        const newRotation = transformStart.initialTransform.rotation + transformStart.unwrappedRotation;

        // Calculate pan to keep the point under the initial pivot under the current pivot
        const startPivot = transformStart.pivot;
        const initT = transformStart.initialTransform;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        // Convert initial pivot from screen to canvas coordinates
        const cos0 = Math.cos(-initT.rotation);
        const sin0 = Math.sin(-initT.rotation);
        const sx1 = startPivot.x - initT.panX;
        const sy1 = startPivot.y - initT.panY;
        const sx2 = cos0 * (sx1 - cx) - sin0 * (sy1 - cy) + cx;
        const sy2 = sin0 * (sx1 - cx) + cos0 * (sy1 - cy) + cy;
        const canvasX = (sx2 - cx) / initT.scale + cx;
        const canvasY = (sy2 - cy) / initT.scale + cy;

        // Apply new scale and rotation to this canvas point
        const cos1 = Math.cos(newRotation);
        const sin1 = Math.sin(newRotation);
        const tx1 = (canvasX - cx) * newScale + cx;
        const ty1 = (canvasY - cy) * newScale + cy;
        const tx2 = cos1 * (tx1 - cx) - sin1 * (ty1 - cy) + cx;
        const ty2 = sin1 * (tx1 - cx) + cos1 * (ty1 - cy) + cy;

        // Update transform
        viewTransform.scale = newScale;
        viewTransform.rotation = newRotation;
        viewTransform.panX = currentPivot.x - tx2;
        viewTransform.panY = currentPivot.y - ty2;

        redraw();
        return;
    }

    // Move indicator anchor based on finger movement delta
    if (gestureMode === 'drawing' && indicatorAnchor) {
        let finalDeltaX = 0;
        let finalDeltaY = 0;

        // When two fingers are touching, buffer deltas and average consecutive pairs
        if (primaryPos && secondaryPos) {
            // First, process any batched work from previous iteration
            if (batchedDelta !== null) {
                const cos = Math.cos(-viewTransform.rotation);
                const sin = Math.sin(-viewTransform.rotation);
                const canvasDeltaX = (cos * batchedDelta.x - sin * batchedDelta.y) / viewTransform.scale;
                const canvasDeltaY = (sin * batchedDelta.x + cos * batchedDelta.y) / viewTransform.scale;

                indicatorAnchor.x += canvasDeltaX;
                indicatorAnchor.y += canvasDeltaY;
                panToKeepIndicatorInView();

                // Add point to stroke if drawing
                if (isDrawing && currentStroke) {
                    currentStroke.points.push({ ...indicatorAnchor });
                }

                batchedDelta = null;
            }

            // Now process the pair of deltas
            if (lastDelta !== null) {
                const sameFingerTwice = (lastDelta.pointerId === e.pointerId);

                if (sameFingerTwice) {
                    // Same finger moved twice - other finger is stationary
                    // Process first message immediately for full frame rate
                    finalDeltaX = lastDelta.x;
                    finalDeltaY = lastDelta.y;

                    // Store current delta for next iteration (don't batch it)
                    lastDelta = { x: deltaX, y: deltaY, pointerId: e.pointerId };

                    // Process the first delta now (will add point below)
                    // The second delta will be processed in the next iteration
                } else {
                    // Different fingers - average and apply coefficient based on unevenness
                    finalDeltaX = (lastDelta.x + deltaX) / 2;
                    finalDeltaY = (lastDelta.y + deltaY) / 2;

                    // Calculate delta lengths
                    const lastLength = Math.sqrt(lastDelta.x * lastDelta.x + lastDelta.y * lastDelta.y);
                    const currentLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                    const bigL = Math.max(lastLength, currentLength);
                    const smallL = Math.min(lastLength, currentLength);

                    // Calculate unevenness: (BigL - SmallL) / (BigL + 0.01)
                    const unevenness = (bigL - smallL) / (bigL + 0.01);

                    // Calculate coefficient based on unevenness
                    // unevenness <= 0.5 => coeff = 1 (fingers moving evenly together)
                    // unevenness >= 0.9 => coeff = 2 (one finger much faster or stationary)
                    // Linear interpolation in between
                    let coefficient = 1.0;
                    if (unevenness <= 0.5) {
                        coefficient = 1.0;
                    } else if (unevenness >= 0.9) {
                        coefficient = 2.0;
                    } else {
                        // Linear interpolation: map [0.5, 0.9] to [1.0, 2.0]
                        const t = (unevenness - 0.5) / (0.9 - 0.5);
                        coefficient = 1.0 + t * 1.0; // 1.0 when t=0, 2.0 when t=1
                    }

                    // Apply coefficient
                    finalDeltaX *= coefficient;
                    finalDeltaY *= coefficient;

                    // Clear the buffer - we've used both deltas
                    lastDelta = null;
                }
            } else {
                // First message of the pair - store and wait
                lastDelta = { x: deltaX, y: deltaY, pointerId: e.pointerId };
                // Don't move indicator yet - waiting for the next delta
                return;
            }
        } else {
            // Single finger mode - process any batched work first
            if (batchedDelta !== null) {
                const cos = Math.cos(-viewTransform.rotation);
                const sin = Math.sin(-viewTransform.rotation);
                const canvasDeltaX = (cos * batchedDelta.x - sin * batchedDelta.y) / viewTransform.scale;
                const canvasDeltaY = (sin * batchedDelta.x + cos * batchedDelta.y) / viewTransform.scale;

                indicatorAnchor.x += canvasDeltaX;
                indicatorAnchor.y += canvasDeltaY;
                panToKeepIndicatorInView();

                batchedDelta = null;
            }

            // Use current delta directly, no buffering
            finalDeltaX = deltaX;
            finalDeltaY = deltaY;

            // Clear any pending delta from previous two-finger mode
            lastDelta = null;
        }

        // Convert screen delta to canvas delta (accounting for scale and rotation)
        const cos = Math.cos(-viewTransform.rotation);
        const sin = Math.sin(-viewTransform.rotation);
        const canvasDeltaX = (cos * finalDeltaX - sin * finalDeltaY) / viewTransform.scale;
        const canvasDeltaY = (sin * finalDeltaX + cos * finalDeltaY) / viewTransform.scale;

        indicatorAnchor = {
            x: indicatorAnchor.x + canvasDeltaX,
            y: indicatorAnchor.y + canvasDeltaY
        };

        // Pan the canvas to keep the indicator in view
        panToKeepIndicatorInView();
    }

    // Handle drawing mode - either finger can contribute to drawing
    if (gestureMode === 'drawing') {
        const shouldDraw = isDrawing && currentStroke && secondaryPointerId !== null;

        if (shouldDraw && indicatorAnchor && (deltaX !== 0 || deltaY !== 0)) {
            // In X+ mode, only add points when moving a full cell size away from last junction
            if (xPlusModeCheckbox.checked) {
                const cellSize = getGridCellSize();
                const threshold = cellSize;

                if (lastGridPosition === null) {
                    // Initialize - store the last grid junction position
                    lastGridPosition = snapToGrid(indicatorAnchor);
                } else {
                    // Calculate distance from last added point
                    const deltaFromLastX = Math.abs(indicatorAnchor.x - lastGridPosition.x);
                    const deltaFromLastY = Math.abs(indicatorAnchor.y - lastGridPosition.y);

                    // Check if we've moved a full cell size away in either direction
                    if (deltaFromLastX >= threshold || deltaFromLastY >= threshold) {
                        // Add the nearest grid junction
                        const gridPoint = snapToGrid(indicatorAnchor);
                        currentStroke!.points.push(gridPoint);
                        lastGridPosition = gridPoint;
                        // Snap marker to the junction
                        indicatorAnchor = gridPoint;
                    }
                }
            } else {
                // Normal mode: add every point
                currentStroke!.points.push({ ...indicatorAnchor });
            }
        }

        redraw();
        return;
    }
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    // Handle transform gesture end
    if (gestureMode === 'transform') {
        // Check if tertiary finger is lifting
        if (e.pointerId === tertiaryPointerId) {
            tertiaryPointerId = null;
            tertiaryPos = null;
        } else if (e.pointerId === secondaryPointerId) {
            secondaryPointerId = null;
            secondaryPos = null;
            lastSecondaryPos = null;
        } else if (e.pointerId === primaryPointerId) {
            primaryPointerId = null;
            primaryPos = null;
            lastPrimaryPos = null;
        }

        // Exit transform mode only when all three fingers are lifted
        if (tertiaryPointerId === null && secondaryPointerId === null && primaryPointerId === null) {
            transformStart = null;
            gestureMode = 'none';

            // Clamp indicator to visible view when transform ends
            clampIndicatorToView();
        }

        redraw();
        return;
    }

    // Handle drawing mode
    if (gestureMode === 'drawing') {
        // Secondary finger lifted
        if (e.pointerId === secondaryPointerId) {
            secondaryPointerId = null;
            secondaryPos = null;
            lastSecondaryPos = null;

            // Clear pending delta
            lastDelta = null;

            // Save stroke when second finger lifts
            if (currentStroke && currentStroke.points.length > 0) {
                strokeHistory.push(currentStroke);
                updateUndoButton();
                currentStroke = null;
                isDrawing = false;
                lastGridPosition = null;
            }

            redraw();
            return;
        }

        // Primary finger lifted
        if (e.pointerId === primaryPointerId) {
            // If secondary finger is still down, promote it to primary and continue
            if (secondaryPointerId !== null && secondaryPos !== null) {
                primaryPointerId = secondaryPointerId;
                primaryPos = secondaryPos;
                lastPrimaryPos = lastSecondaryPos;  // Transfer position tracking
                secondaryPointerId = null;
                secondaryPos = null;
                lastSecondaryPos = null;

                // Clear pending delta
                lastDelta = null;

                // Save stroke when going from 2 fingers to 1 finger
                if (currentStroke && currentStroke.points.length > 0) {
                    strokeHistory.push(currentStroke);
                    updateUndoButton();
                    currentStroke = null;
                    isDrawing = false;
                    lastGridPosition = null;
                }

                redraw();
                return;
            }

            // No secondary finger - save stroke and reset
            if (currentStroke && currentStroke.points.length > 0) {
                strokeHistory.push(currentStroke);
                updateUndoButton();
            }
            primaryPointerId = null;
            primaryPos = null;
            lastPrimaryPos = null;

            // Clear pending delta
            lastDelta = null;

            currentStroke = null;
            isDrawing = false;
            gestureMode = 'none';
            lastGridPosition = null;

            // Snap marker to grid when all fingers are lifted in X+ mode
            if (xPlusModeCheckbox.checked && indicatorAnchor) {
                indicatorAnchor = snapToGrid(indicatorAnchor);
            }

            redraw();
        }
    }
}

// Update undo button state
function updateUndoButton() {
    undoBtn.disabled = strokeHistory.length === 0;
}

// Undo last stroke
function undo() {
    if (strokeHistory.length > 0) {
        strokeHistory.pop();
        redraw();
        updateUndoButton();
    }
}

// Clear canvas
function clearCanvas() {
    strokeHistory = [];
    primaryPointerId = null;
    secondaryPointerId = null;
    tertiaryPointerId = null;
    primaryPos = null;
    secondaryPos = null;
    tertiaryPos = null;
    lastPrimaryPos = null;
    lastSecondaryPos = null;
    lastDelta = null;
    batchedDelta = null;
    currentStroke = null;
    isDrawing = false;
    gestureMode = 'none';
    transformStart = null;
    // Reset view transform and indicator to center
    viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
    redraw();
    updateUndoButton();
}

// Event listeners
canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerUp);
canvas.addEventListener('pointerleave', handlePointerUp);

// Prevent default touch behaviors - must be non-passive to work on iOS
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchend', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchcancel', e => e.preventDefault(), { passive: false });

// UI controls
undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearCanvas);
xPlusModeCheckbox.addEventListener('change', () => {
    // Snap marker to grid when X+ mode is turned on
    if (xPlusModeCheckbox.checked && indicatorAnchor) {
        indicatorAnchor = snapToGrid(indicatorAnchor);
    }
    redraw();
});

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initialize
resizeCanvas();
updateUndoButton();

// Set initial marker position to center of screen
indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
