import { createColorPicker } from './colorPicker';

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const colorPickerEl = document.getElementById('colorPicker') as HTMLElement;
const strokeSize = document.getElementById('strokeSize') as HTMLInputElement;
const sizeValue = document.getElementById('sizeValue') as HTMLSpanElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

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
let primaryPos: Point | null = null;  // Current position of first finger
let currentStroke: Stroke | null = null;  // Stroke being drawn
let isDrawing = false;  // True once second finger has triggered drawing

// Initialize custom color picker
const colorPicker = createColorPicker(colorPickerEl, () => {});

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
        const size = parseInt(strokeSize.value);
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

    // Any additional finger while primary is down - start drawing (if not already)
    if (!isDrawing && primaryPos) {
        isDrawing = true;
        const offsetPos = getOffsetPos(primaryPos);
        currentStroke = {
            color: colorPicker.getColor(),
            size: parseInt(strokeSize.value),
            points: [offsetPos]
        };
        redraw();
    }

    // Additional fingers after drawing started - ignore
}

// Handle pointer move
function handlePointerMove(e: PointerEvent) {
    e.preventDefault();

    // Only care about primary finger movement
    if (e.pointerId !== primaryPointerId) return;

    primaryPos = getPointerPos(e);

    // If drawing, add point to stroke
    if (isDrawing && currentStroke) {
        const offsetPos = getOffsetPos(primaryPos);
        currentStroke.points.push(offsetPos);
    }

    redraw();
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    // Only care about primary finger lifting
    if (e.pointerId !== primaryPointerId) return;

    // Primary finger lifted - save stroke and reset everything
    if (currentStroke && currentStroke.points.length > 0) {
        strokeHistory.push(currentStroke);
        updateUndoButton();
    }
    primaryPointerId = null;
    primaryPos = null;
    currentStroke = null;
    isDrawing = false;
    redraw();
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
strokeSize.addEventListener('input', () => {
    sizeValue.textContent = strokeSize.value;
    redraw(); // Update preview dot size
});

undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearCanvas);

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initialize
resizeCanvas();
updateUndoButton();
