import '../styles.css';
import { createColorPicker } from './colorPicker';
import { createSizePicker } from './sizePicker';

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPickerEl = document.getElementById('colorPicker') as HTMLElement;
const sizePickerEl = document.getElementById('sizePicker') as HTMLElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const liftModeCheckbox = document.getElementById('liftMode') as HTMLInputElement;
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
type GestureMode = 'none' | 'waiting'  | 'drawing' | 'transform';
let gestureMode: GestureMode = 'none';
let gestureTimer: number | null = null;
const GESTURE_DELAY = 100; // ms to wait before entering drawing mode

// Pointer tracking
let primaryPointerId: number | null = null;
let secondaryPointerId: number | null = null;
let primaryPos: Point | null = null;
let secondaryPos: Point | null = null;

// Drawing state
let currentStroke: Stroke | null = null;
let isDrawing = false;

// Transform state
let viewTransform = {
    scale: 1,
    rotation: 0,  // in radians
    panX: 0,
    panY: 0
};
let transformStart: {
    primaryPos: Point;
    secondaryPos: Point;
    distance: number;
    angle: number;
    midpoint: Point;
    initialTransform: typeof viewTransform;
} | null = null;

// Indicator anchor point (in canvas coordinates, not screen coordinates)
// null means use default position
let indicatorAnchor: Point | null = null;
let lastPrimaryPos: Point | null = null; // For tracking finger movement delta
let lastSecondaryPos: Point | null = null; // For tracking secondary finger movement delta
let primaryStartPos: Point | null = null; // Initial position when finger landed (for movement threshold)

// Double-tap detection
let lastTapTime = 0;
let lastTapPos: Point | null = null;
const DOUBLE_TAP_DELAY = 300; // ms
const DOUBLE_TAP_DISTANCE = 50; // pixels - max distance between taps for double-tap
const MOVEMENT_THRESHOLD = 15; // pixels - if finger moves more than this during waiting, enter drawing mode

// Snap a delta to the nearest 45-degree angle (0, 45, 90, 135, 180, 225, 270, 315)
function snapTo45Degrees(deltaX: number, deltaY: number): { x: number, y: number } {
    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (magnitude === 0) return { x: 0, y: 0 };

    const angle = Math.atan2(deltaY, deltaX);
    // Snap to nearest 45 degrees (PI/4 radians)
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

    return {
        x: magnitude * Math.cos(snappedAngle),
        y: magnitude * Math.sin(snappedAngle)
    };
}

// Calculate movement coefficient based on distance between two fingers
// Returns 0.5 when distance < 1/8 diagonal, 1.0 when distance > 1/3 diagonal, linear interpolation in between
function getMovementCoefficient(fingerDistance: number): number {
    const diagonal = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height);
    const minDist = diagonal / 8;  // 1/8 diagonal -> coefficient 0.5
    const maxDist = diagonal / 3;  // 1/3 diagonal -> coefficient 1.0

    if (fingerDistance <= minDist) return 0.5;
    if (fingerDistance >= maxDist) return 1.0;

    // Linear interpolation between 0.5 and 1.0
    const t = (fingerDistance - minDist) / (maxDist - minDist);
    return 0.5 + t * 0.5;
}

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

// Enter drawing mode
function enterDrawingMode() {
    gestureMode = 'drawing';
    redraw();
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
        primaryStartPos = pos;  // Track where finger landed for movement threshold

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

        // Start waiting period
        gestureMode = 'waiting';
        gestureTimer = window.setTimeout(() => {
            gestureTimer = null;
            if (gestureMode === 'waiting') {
                enterDrawingMode();
            }
        }, GESTURE_DELAY);

        redraw();
        return;
    }

    // Second finger
    if (secondaryPointerId === null) {
        secondaryPointerId = e.pointerId;
        secondaryPos = pos;
        lastSecondaryPos = pos;  // Initialize to prevent marker jump on first move

        // If still in waiting period, this is a transform gesture
        if (gestureMode === 'waiting' && gestureTimer !== null) {
            clearTimeout(gestureTimer);
            gestureTimer = null;
            gestureMode = 'transform';

            // Initialize transform tracking
            transformStart = {
                primaryPos: { ...primaryPos! },
                secondaryPos: { ...secondaryPos! },
                distance: getDistance(primaryPos!, secondaryPos!),
                angle: getAngle(primaryPos!, secondaryPos!),
                midpoint: getMidpoint(primaryPos!, secondaryPos!),
                initialTransform: { ...viewTransform }
            };

            redraw();
            return;
        }

        // If in drawing mode, second finger starts/continues drawing
        if (gestureMode === 'drawing' && primaryPos && indicatorAnchor) {
            if (!isDrawing) {
                isDrawing = true;
                // Use the indicator anchor position for drawing
                currentStroke = {
                    color: colorPicker.getColor(),
                    size: sizePicker.getSize(),
                    points: [{ ...indicatorAnchor }]
                };
            }
            redraw();
        }

        return;
    }

    // Third+ fingers - ignore
}

// Handle pointer move
function handlePointerMove(e: PointerEvent) {
    e.preventDefault();

    const pos = getPointerPos(e);

    // Update position tracking
    // Track deltas for both fingers
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
    } else {
        return;
    }

    // Move indicator anchor based on finger movement delta (sum of both fingers)
    if ((gestureMode === 'waiting' || gestureMode === 'drawing') && indicatorAnchor) {
        // Apply movement coefficient when two fingers are touching
        let coefficient = 1.0;
        if (primaryPos && secondaryPos) {
            const fingerDistance = getDistance(primaryPos, secondaryPos);
            coefficient = getMovementCoefficient(fingerDistance);
        }

        // Convert screen delta to canvas delta (accounting for scale and rotation)
        const cos = Math.cos(-viewTransform.rotation);
        const sin = Math.sin(-viewTransform.rotation);
        let canvasDeltaX = (cos * deltaX - sin * deltaY) / viewTransform.scale * coefficient;
        let canvasDeltaY = (sin * deltaX + cos * deltaY) / viewTransform.scale * coefficient;

        // Apply 45-degree snapping when X+ mode is checked and drawing
        if (xPlusModeCheckbox.checked && gestureMode === 'drawing' && isDrawing) {
            const snapped = snapTo45Degrees(canvasDeltaX, canvasDeltaY);
            canvasDeltaX = snapped.x;
            canvasDeltaY = snapped.y;
        }

        indicatorAnchor = {
            x: indicatorAnchor.x + canvasDeltaX,
            y: indicatorAnchor.y + canvasDeltaY
        };

        // Pan the canvas to keep the indicator in view (both when drawing and not)
        panToKeepIndicatorInView();
    }

    // Handle transform gesture
    if (gestureMode === 'transform' && transformStart && primaryPos && secondaryPos) {
        const currentDistance = getDistance(primaryPos, secondaryPos);
        const currentAngle = getAngle(primaryPos, secondaryPos);
        const currentMidpoint = getMidpoint(primaryPos, secondaryPos);

        // Calculate scale and rotation changes
        const scaleFactor = currentDistance / transformStart.distance;
        const newScale = transformStart.initialTransform.scale * scaleFactor;
        const rotationDelta = currentAngle - transformStart.angle;
        const newRotation = transformStart.initialTransform.rotation + rotationDelta;

        // The transform should be centered on the pinch midpoint
        // We need to adjust pan so that the point under the initial midpoint stays under the current midpoint
        const startMid = transformStart.midpoint;
        const initT = transformStart.initialTransform;

        // Calculate where the initial midpoint was in canvas space
        // Then calculate what pan is needed so that point ends up under current midpoint after new scale/rotation
        const cos0 = Math.cos(-initT.rotation);
        const sin0 = Math.sin(-initT.rotation);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        // Point under start midpoint in canvas coordinates (reverse the initial transform)
        const sx1 = startMid.x - initT.panX;
        const sy1 = startMid.y - initT.panY;
        const sx2 = cos0 * (sx1 - cx) - sin0 * (sy1 - cy) + cx;
        const sy2 = sin0 * (sx1 - cx) + cos0 * (sy1 - cy) + cy;
        const canvasX = (sx2 - cx) / initT.scale + cx;
        const canvasY = (sy2 - cy) / initT.scale + cy;

        // Now apply new scale and rotation to this canvas point
        const cos1 = Math.cos(newRotation);
        const sin1 = Math.sin(newRotation);
        const tx1 = (canvasX - cx) * newScale + cx;
        const ty1 = (canvasY - cy) * newScale + cy;
        const tx2 = cos1 * (tx1 - cx) - sin1 * (ty1 - cy) + cx;
        const ty2 = sin1 * (tx1 - cx) + cos1 * (ty1 - cy) + cy;

        // Pan needed to put this point under currentMidpoint
        viewTransform.scale = newScale;
        viewTransform.rotation = newRotation;
        viewTransform.panX = currentMidpoint.x - tx2;
        viewTransform.panY = currentMidpoint.y - ty2;

        redraw();
        return;
    }

    // Handle waiting mode - check if movement exceeds threshold
    if (gestureMode === 'waiting' && e.pointerId === primaryPointerId) {
        // If finger has moved beyond threshold, enter drawing mode immediately
        if (primaryStartPos) {
            const dist = getDistance(pos, primaryStartPos);
            if (dist > MOVEMENT_THRESHOLD) {
                if (gestureTimer !== null) {
                    clearTimeout(gestureTimer);
                    gestureTimer = null;
                }
                enterDrawingMode();
            }
        }
        redraw();
        return;
    }

    // Handle drawing mode - either finger can contribute to drawing
    if (gestureMode === 'drawing') {
        const liftMode = liftModeCheckbox.checked;
        const shouldDraw = isDrawing && currentStroke && (liftMode || secondaryPointerId !== null);

        if (shouldDraw && indicatorAnchor && (deltaX !== 0 || deltaY !== 0)) {
            // Use the indicator anchor position for drawing when any tracked finger moves
            currentStroke!.points.push({ ...indicatorAnchor });
        }

        redraw();
        return;
    }

    // Also redraw for any tracked pointer movement (to update indicator after transform ends)
    if (primaryPos && gestureMode === 'waiting') {
        redraw();
    }
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    // Handle transform gesture end
    if (gestureMode === 'transform') {
        transformStart = null;

        // Clamp indicator to visible view when transform ends
        clampIndicatorToView();

        if (e.pointerId === secondaryPointerId) {
            // Second finger lifted - go back to waiting mode with primary finger
            secondaryPointerId = null;
            secondaryPos = null;
            primaryStartPos = primaryPos;  // Reset start position for movement threshold
            gestureMode = 'waiting';
            gestureTimer = window.setTimeout(() => {
                gestureTimer = null;
                if (gestureMode === 'waiting') {
                    enterDrawingMode();
                }
            }, GESTURE_DELAY);
            redraw();
            return;
        }
        if (e.pointerId === primaryPointerId) {
            // Primary finger lifted - make secondary the new primary and go to waiting mode
            if (secondaryPointerId !== null && secondaryPos !== null) {
                primaryPointerId = secondaryPointerId;
                primaryPos = secondaryPos;
                lastPrimaryPos = secondaryPos;  // Prevent marker jump
                primaryStartPos = secondaryPos;  // Reset start position for movement threshold
                secondaryPointerId = null;
                secondaryPos = null;
                gestureMode = 'waiting';
                gestureTimer = window.setTimeout(() => {
                    gestureTimer = null;
                    if (gestureMode === 'waiting') {
                        enterDrawingMode();
                    }
                }, GESTURE_DELAY);
                redraw();
                return;
            }
            // No secondary finger - end everything
            primaryPointerId = null;
            primaryPos = null;
            gestureMode = 'none';
            redraw();
        }
        return;
    }

    // Handle waiting mode - cancel if finger lifts
    if (gestureMode === 'waiting') {
        if (gestureTimer !== null) {
            clearTimeout(gestureTimer);
            gestureTimer = null;
        }
        if (e.pointerId === primaryPointerId) {
            primaryPointerId = null;
            primaryPos = null;
            gestureMode = 'none';
            redraw();
        }
        return;
    }

    // Handle drawing mode
    if (gestureMode === 'drawing') {
        const liftMode = liftModeCheckbox.checked;

        // Secondary finger lifted
        if (e.pointerId === secondaryPointerId) {
            secondaryPointerId = null;
            secondaryPos = null;

            // In non-lift mode, save stroke when second finger lifts
            if (!liftMode && currentStroke && currentStroke.points.length > 0) {
                strokeHistory.push(currentStroke);
                updateUndoButton();
                currentStroke = null;
                isDrawing = false;
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
                // Continue drawing - don't save stroke yet
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
            currentStroke = null;
            isDrawing = false;
            gestureMode = 'none';
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
    primaryPos = null;
    secondaryPos = null;
    lastPrimaryPos = null;
    currentStroke = null;
    isDrawing = false;
    gestureMode = 'none';
    if (gestureTimer !== null) {
        clearTimeout(gestureTimer);
        gestureTimer = null;
    }
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

// Prevent default touch behaviors
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// UI controls
undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearCanvas);

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initialize
resizeCanvas();
updateUndoButton();

// Set initial marker position to center of screen
indicatorAnchor = screenToCanvas({ x: canvas.width / 2, y: canvas.height / 2 });
redraw();
