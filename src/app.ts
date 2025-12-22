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

interface ActiveStroke extends Stroke {
    pointerId: number;
}

// Track active pointers for multi-touch
const activePointers = new Map<number, ActiveStroke>();

// History for undo functionality
let strokeHistory: Stroke[] = [];

// Initialize custom color picker
const colorPicker = createColorPicker(colorPickerEl, () => {});

// Resize canvas to fill window
function resizeCanvas() {
    const toolbarHeight = 60;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;
    redraw();
}

// Redraw all strokes from history
function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokeHistory.forEach(stroke => {
        if (stroke.points.length < 2) return;

        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    });
}

// Get pointer position relative to canvas
function getPointerPos(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// Start drawing
function startDrawing(e: PointerEvent) {
    e.preventDefault();

    const pos = getPointerPos(e);
    const stroke = {
        pointerId: e.pointerId,
        color: colorPicker.getColor(),
        size: parseInt(strokeSize.value),
        points: [pos]
    };

    activePointers.set(e.pointerId, stroke);
}

// Continue drawing
function draw(e: PointerEvent) {
    e.preventDefault();

    const stroke = activePointers.get(e.pointerId);
    if (!stroke) return;

    const pos = getPointerPos(e);
    stroke.points.push(pos);

    // Draw the latest segment
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const points = stroke.points;
    if (points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y);
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
    }
}

// Stop drawing
function stopDrawing(e: PointerEvent) {
    e.preventDefault();

    const stroke = activePointers.get(e.pointerId);
    if (stroke && stroke.points.length > 0) {
        // Save completed stroke to history
        strokeHistory.push({
            color: stroke.color,
            size: stroke.size,
            points: [...stroke.points]
        });
        updateUndoButton();
    }

    activePointers.delete(e.pointerId);
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
    activePointers.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateUndoButton();
}

// Event listeners
canvas.addEventListener('pointerdown', startDrawing);
canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);

// Prevent default touch behaviors
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// UI controls
strokeSize.addEventListener('input', () => {
    sizeValue.textContent = strokeSize.value;
});

undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearCanvas);

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initialize
resizeCanvas();
updateUndoButton();
