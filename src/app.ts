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

// Two-finger drawing state
let primaryPointerId: number | null = null;  // First finger
let secondaryPointerId: number | null = null;  // Second finger
let primaryPos: Point | null = null;  // Current position of first finger
let currentStroke: Stroke | null = null;  // Stroke being drawn
let isDrawing = false;  // True when actively drawing

// Initialize custom color picker
const colorPicker = createColorPicker(colorPickerEl, () => {});

// Initialize custom size picker
const sizePicker = createSizePicker(sizePickerEl, () => {
    redraw(); // Update preview dot size
});

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

    // Draw preview/indicator rings if first finger is down
    if (primaryPos) {
        const offsetPos = getOffsetPos(primaryPos);
        const size = sizePicker.getSize();
        const drawColor = colorPicker.getColor();
        const isWhite = drawColor.toUpperCase() === '#FFFFFF';
        const outerColor = isWhite ? 'black' : drawColor;

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
        ctx.stroke();
    }
}

// Draw a single stroke
function drawStroke(stroke: Stroke) {
    if (stroke.points.length < 2) {
        // Draw a dot for single-point strokes
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

// Handle pointer down
function handlePointerDown(e: PointerEvent) {
    e.preventDefault();

    // First finger - track it as primary
    if (primaryPointerId === null) {
        primaryPointerId = e.pointerId;
        primaryPos = getPointerPos(e);
        redraw(); // Show preview dot
        return;
    }

    // Second finger - track it and start drawing
    if (secondaryPointerId === null && primaryPos) {
        secondaryPointerId = e.pointerId;

        if (!isDrawing) {
            isDrawing = true;
            const offsetPos = getOffsetPos(primaryPos);
            currentStroke = {
                color: colorPicker.getColor(),
                size: sizePicker.getSize(),
                points: [offsetPos]
            };
        }
        redraw();
        return;
    }

    // Third+ fingers - ignore
}

// Handle pointer move
function handlePointerMove(e: PointerEvent) {
    e.preventDefault();

    // Only care about primary finger movement
    if (e.pointerId !== primaryPointerId) return;

    primaryPos = getPointerPos(e);

    // Determine if we should add points to the stroke
    const liftMode = liftModeCheckbox.checked;
    const shouldDraw = isDrawing && currentStroke && (liftMode || secondaryPointerId !== null);

    if (shouldDraw) {
        const offsetPos = getOffsetPos(primaryPos);
        currentStroke!.points.push(offsetPos);
    }

    redraw();
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    const liftMode = liftModeCheckbox.checked;

    // Secondary finger lifted
    if (e.pointerId === secondaryPointerId) {
        secondaryPointerId = null;

        // In non-lift mode, save stroke when second finger lifts (but keep preview)
        if (!liftMode && currentStroke && currentStroke.points.length > 0) {
            strokeHistory.push(currentStroke);
            updateUndoButton();
            currentStroke = null;
            isDrawing = false;
        }

        redraw();
        return;
    }

    // Primary finger lifted - save stroke and reset everything
    if (e.pointerId === primaryPointerId) {
        if (currentStroke && currentStroke.points.length > 0) {
            strokeHistory.push(currentStroke);
            updateUndoButton();
        }
        primaryPointerId = null;
        secondaryPointerId = null;
        primaryPos = null;
        currentStroke = null;
        isDrawing = false;
        redraw();
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
    currentStroke = null;
    isDrawing = false;
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
