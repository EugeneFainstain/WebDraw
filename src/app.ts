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
let secondaryPointerId: number | null = null; // Second finger (triggers drawing)
let primaryPos: Point | null = null;  // Current position of first finger
let currentStroke: Stroke | null = null;  // Stroke being drawn

// Initialize custom color picker
const colorPicker = createColorPicker(colorPickerEl, () => {});

// Get vertical offset (1/10th of canvas height)
function getOffset(): number {
    return canvas.height / 10;
}

// Get offset position (above the actual touch)
function getOffsetPos(pos: Point): Point {
    return {
        x: pos.x,
        y: pos.y - getOffset()
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

    // Draw preview dot if first finger is down but not drawing
    if (primaryPos && !secondaryPointerId) {
        const offsetPos = getOffsetPos(primaryPos);
        const size = parseInt(strokeSize.value);
        ctx.fillStyle = colorPicker.getColor();
        ctx.beginPath();
        ctx.arc(offsetPos.x, offsetPos.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
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

    // First finger
    if (primaryPointerId === null) {
        primaryPointerId = e.pointerId;
        primaryPos = getPointerPos(e);
        redraw(); // Show preview dot
        return;
    }

    // Second finger - start drawing
    if (secondaryPointerId === null && primaryPos) {
        secondaryPointerId = e.pointerId;
        const offsetPos = getOffsetPos(primaryPos);
        currentStroke = {
            color: colorPicker.getColor(),
            size: parseInt(strokeSize.value),
            points: [offsetPos]
        };
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

    // If drawing (second finger is down), add point to stroke
    if (secondaryPointerId !== null && currentStroke) {
        const offsetPos = getOffsetPos(primaryPos);
        currentStroke.points.push(offsetPos);
    }

    redraw();
}

// Handle pointer up
function handlePointerUp(e: PointerEvent) {
    e.preventDefault();

    // Primary finger lifted
    if (e.pointerId === primaryPointerId) {
        // Save stroke if we were drawing
        if (currentStroke && currentStroke.points.length > 0) {
            strokeHistory.push(currentStroke);
            updateUndoButton();
        }
        // Reset everything
        primaryPointerId = null;
        secondaryPointerId = null;
        primaryPos = null;
        currentStroke = null;
        redraw();
        return;
    }

    // Secondary finger lifted - stop drawing but keep preview
    if (e.pointerId === secondaryPointerId) {
        if (currentStroke && currentStroke.points.length > 0) {
            strokeHistory.push(currentStroke);
            updateUndoButton();
        }
        secondaryPointerId = null;
        currentStroke = null;
        redraw(); // Will show preview dot again
        return;
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
