import { createColorPicker } from './colorPicker';
import { createSizePicker } from './sizePicker';

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPickerEl = document.getElementById('colorPicker') as HTMLElement;
const sizePickerEl = document.getElementById('sizePicker') as HTMLElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const liftModeCheckbox = document.getElementById('liftMode') as HTMLInputElement;

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
type GestureMode = 'none' | 'waiting' | 'drawing' | 'transform';
let gestureMode: GestureMode = 'none';
let gestureTimer: number | null = null;
const GESTURE_DELAY = 250; // ms to wait before entering drawing mode

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

// Get offset position (up and left by 1/8th of canvas dimensions)
function getOffsetPos(pos: Point): Point {
    return {
        x: pos.x - canvas.width / 8,
        y: pos.y - canvas.height / 8
    };
}

// Resize canvas to fill window
function resizeCanvas() {
    const toolbarHeight = 60;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;
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

    // Draw preview/indicator rings (in screen space, not transformed)
    if (primaryPos && (gestureMode === 'drawing' || gestureMode === 'waiting')) {
        const offsetPos = getOffsetPos(primaryPos);
        const size = sizePicker.getSize();
        const drawColor = colorPicker.getColor();
        const isWhite = drawColor.toUpperCase() === '#FFFFFF';
        const outerColor = isWhite ? 'black' : drawColor;

        // Always draw the same indicator style (two rings)
        // Inner ring (white)
        ctx.beginPath();
        ctx.arc(offsetPos.x, offsetPos.y, size / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Outer ring (draw color, or black if white)
        ctx.beginPath();
        ctx.arc(offsetPos.x, offsetPos.y, size / 2 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = 2;
        ctx.stroke()
    }
}

// Draw a single stroke
function drawStroke(stroke: Stroke) {
    if (stroke.points.length < 2) {
        if (stroke.points.length === 1) {
            ctx.fillStyle = stroke.color;
            ctx.beginPath();
            ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
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

        // Start waiting period
        gestureMode = 'waiting';
        gestureTimer = window.setTimeout(() => {
            gestureTimer = null;
            if (gestureMode === 'waiting') {
                enterDrawingMode();
            }
        }, GESTURE_DELAY);

        return;
    }

    // Second finger
    if (secondaryPointerId === null) {
        secondaryPointerId = e.pointerId;
        secondaryPos = pos;

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
        if (gestureMode === 'drawing' && primaryPos) {
            if (!isDrawing) {
                isDrawing = true;
                const canvasPos = screenToCanvas(getOffsetPos(primaryPos));
                currentStroke = {
                    color: colorPicker.getColor(),
                    size: sizePicker.getSize() / viewTransform.scale,
                    points: [canvasPos]
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
    if (e.pointerId === primaryPointerId) {
        primaryPos = pos;
    } else if (e.pointerId === secondaryPointerId) {
        secondaryPos = pos;
    } else {
        return;
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

    // Handle waiting mode - update indicator position
    if (gestureMode === 'waiting' && e.pointerId === primaryPointerId) {
        redraw();
        return;
    }

    // Handle drawing mode - only care about primary finger
    if (gestureMode === 'drawing' && e.pointerId === primaryPointerId) {
        const liftMode = liftModeCheckbox.checked;
        const shouldDraw = isDrawing && currentStroke && (liftMode || secondaryPointerId !== null);

        if (shouldDraw) {
            const canvasPos = screenToCanvas(getOffsetPos(primaryPos!));
            currentStroke!.points.push(canvasPos);
        }

        redraw();
        return;
    }

    // Also redraw for any tracked pointer movement (to update indicator after transform ends)
    if (primaryPos && (gestureMode === 'drawing' || gestureMode === 'waiting')) {
        redraw();
    }
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    // Handle transform gesture end
    if (gestureMode === 'transform') {
        transformStart = null;

        if (e.pointerId === secondaryPointerId) {
            // Second finger lifted - transition to drawing mode with primary finger
            secondaryPointerId = null;
            secondaryPos = null;
            gestureMode = 'drawing';
            redraw();
            return;
        }
        if (e.pointerId === primaryPointerId) {
            // Primary finger lifted - make secondary the new primary and transition to drawing
            if (secondaryPointerId !== null && secondaryPos !== null) {
                primaryPointerId = secondaryPointerId;
                primaryPos = secondaryPos;
                secondaryPointerId = null;
                secondaryPos = null;
                gestureMode = 'drawing';
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

        // Primary finger lifted - save stroke and reset
        if (e.pointerId === primaryPointerId) {
            if (currentStroke && currentStroke.points.length > 0) {
                strokeHistory.push(currentStroke);
                updateUndoButton();
            }
            primaryPointerId = null;
            secondaryPointerId = null;
            primaryPos = null;
            secondaryPos = null;
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
    currentStroke = null;
    isDrawing = false;
    gestureMode = 'none';
    if (gestureTimer !== null) {
        clearTimeout(gestureTimer);
        gestureTimer = null;
    }
    // Reset view transform
    viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
