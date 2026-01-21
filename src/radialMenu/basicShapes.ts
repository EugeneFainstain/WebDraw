/**
 * BASICSHAPES.TS - Basic Shape Buttons for Radial Menu
 *
 * This module handles the basic shape buttons submenu in the radial menu.
 * It provides functionality to:
 * - Create and position shape buttons in a circle
 * - Generate shape strokes (circle, triangle, square, etc.)
 * - Toggle shapes on/off within a radial menu session
 */

import { state, TOOLBAR_HEIGHT, Stroke } from '../state';
import { getCursorScreenPos } from '../cursorMovement';
import { screenToCanvas, redraw } from '../rendering';
import { Point } from '../eventHandler';

// ============================================================================
// TYPES
// ============================================================================

// Shape types in order (starting from up direction, clockwise)
export type ShapeType = 'circle' | 'triangle' | 'right-triangle' | 'square' | 'pentagon' | 'hexagon' | 'octagon' | 'arrow' | 'square-brace' | 'curly-brace';

// ============================================================================
// CONSTANTS
// ============================================================================

const SHAPE_TYPES: ShapeType[] = [
    'circle',          // 1. Circle
    'triangle',        // 2. Equilateral triangle
    'right-triangle',  // 3. Straight-corner triangle
    'square',          // 4. Square
    'pentagon',        // 5. Pentagon
    'hexagon',         // 6. Hexagon
    'octagon',         // 7. Octagon
    'arrow',           // 8. Arrow (outline)
    'square-brace',    // 9. Square brace
    'curly-brace'      // 10. Curly brace
];

const SHAPE_BUTTON_SIZE = 48;

// ============================================================================
// MODULE STATE
// ============================================================================

let shapeButtons: HTMLElement[] = [];
let shapeButtonsVisible = false;

// Session tracking: maps button index to stroke index for shapes added in current session
// This allows toggling (remove on second click) within the same radial menu session
let sessionShapeStrokes: Map<number, number> = new Map();

// Callbacks for getting current color and size
let getColorCallback: (() => string) | null = null;
let getSizeCallback: (() => number) | null = null;

// ============================================================================
// SHAPE STROKE GENERATION
// ============================================================================

/**
 * Generate points for a regular polygon centered at (cx, cy) with given radius.
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param radius Distance from center to vertices
 * @param sides Number of sides
 * @param startAngle Starting angle in radians (default: -π/2 for top)
 * @returns Array of points forming a closed polygon
 */
function generatePolygonPoints(cx: number, cy: number, radius: number, sides: number, startAngle: number = -Math.PI / 2): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= sides; i++) {
        const angle = startAngle + (i / sides) * 2 * Math.PI;
        points.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius
        });
    }
    return points;
}

/**
 * Generate points for a circle approximated by many line segments.
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param radius Circle radius
 * @returns Array of points forming a closed circle
 */
function generateCirclePoints(cx: number, cy: number, radius: number): Point[] {
    const segments = 64;  // Smooth circle
    return generatePolygonPoints(cx, cy, radius, segments, -Math.PI / 2);
}

/**
 * Generate points for a right-angle triangle (90° at bottom-left).
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param size Size of the bounding box
 * @returns Array of points forming a closed triangle
 */
function generateRightTrianglePoints(cx: number, cy: number, size: number): Point[] {
    const halfSize = size / 2;
    return [
        { x: cx - halfSize, y: cy + halfSize },  // Bottom-left (right angle)
        { x: cx - halfSize, y: cy - halfSize },  // Top-left
        { x: cx + halfSize, y: cy + halfSize },  // Bottom-right
        { x: cx - halfSize, y: cy + halfSize }   // Close back to start
    ];
}

/**
 * Generate points for an arrow shape pointing right.
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param size Size of the bounding box
 * @returns Array of points forming a closed arrow
 */
function generateArrowPoints(cx: number, cy: number, size: number): Point[] {
    const halfSize = size / 2;
    const shaftWidth = size * 0.35;
    const headStart = size * 0.25;
    return [
        { x: cx - halfSize, y: cy - shaftWidth / 2 },  // Top-left of shaft
        { x: cx - halfSize + headStart, y: cy - shaftWidth / 2 },  // Before arrow head top
        { x: cx - halfSize + headStart, y: cy - halfSize },  // Arrow head top outer
        { x: cx + halfSize, y: cy },  // Arrow tip
        { x: cx - halfSize + headStart, y: cy + halfSize },  // Arrow head bottom outer
        { x: cx - halfSize + headStart, y: cy + shaftWidth / 2 },  // Before arrow head bottom
        { x: cx - halfSize, y: cy + shaftWidth / 2 },  // Bottom-left of shaft
        { x: cx - halfSize, y: cy - shaftWidth / 2 }   // Close back to start
    ];
}

/**
 * Generate points for a square bracket shape [.
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param size Size of the bounding box
 * @returns Array of points (not closed - it's a bracket)
 */
function generateSquareBracePoints(cx: number, cy: number, size: number): Point[] {
    const halfSize = size / 2;
    const bracketWidth = size * 0.3;
    return [
        { x: cx + bracketWidth, y: cy - halfSize },   // Top right
        { x: cx - bracketWidth, y: cy - halfSize },   // Top left
        { x: cx - bracketWidth, y: cy + halfSize },   // Bottom left
        { x: cx + bracketWidth, y: cy + halfSize }    // Bottom right
    ];
}

/**
 * Generate points for a curly brace shape {.
 * Uses bezier-like points for a smooth curve.
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param size Size of the bounding box
 * @returns Array of points (not closed - it's a brace)
 */
function generateCurlyBracePoints(cx: number, cy: number, size: number): Point[] {
    const halfSize = size / 2;
    const points: Point[] = [];
    const segments = 32;

    // Generate the curly brace as a parametric curve
    // Top half: from top-right curving to center-left
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        let x: number, y: number;

        if (t <= 0.5) {
            // Top section - curve from top to middle
            const localT = t * 2;
            x = cx + halfSize * 0.3 - halfSize * 0.6 * Math.sin(localT * Math.PI / 2);
            y = cy - halfSize + halfSize * localT;
        } else {
            // Bottom section - curve from middle to bottom
            const localT = (t - 0.5) * 2;
            x = cx - halfSize * 0.3 + halfSize * 0.6 * Math.sin(localT * Math.PI / 2);
            y = cy + halfSize * localT;
        }
        points.push({ x, y });
    }

    return points;
}

/**
 * Generate stroke points for a given shape type.
 * @param shape The shape type
 * @param cx Center X in canvas coordinates
 * @param cy Center Y in canvas coordinates
 * @param size Size of the shape's bounding box
 * @returns Array of points for the stroke
 */
function generateShapePoints(shape: ShapeType, cx: number, cy: number, size: number): Point[] {
    const radius = size / 2;

    switch (shape) {
        case 'circle':
            return generateCirclePoints(cx, cy, radius);

        case 'triangle':
            // Equilateral triangle - 3 sides, pointing up
            return generatePolygonPoints(cx, cy, radius, 3, -Math.PI / 2);

        case 'right-triangle':
            return generateRightTrianglePoints(cx, cy, size);

        case 'square':
            // Square - 4 sides, rotated 45° so sides are horizontal/vertical
            return generatePolygonPoints(cx, cy, radius * Math.SQRT2, 4, -Math.PI / 4);

        case 'pentagon':
            return generatePolygonPoints(cx, cy, radius, 5, -Math.PI / 2);

        case 'hexagon':
            // Flat-top hexagon
            return generatePolygonPoints(cx, cy, radius, 6, 0);

        case 'octagon':
            return generatePolygonPoints(cx, cy, radius, 8, -Math.PI / 8);

        case 'arrow':
            return generateArrowPoints(cx, cy, size);

        case 'square-brace':
            return generateSquareBracePoints(cx, cy, size);

        case 'curly-brace':
            return generateCurlyBracePoints(cx, cy, size);
    }
}

/**
 * Create a stroke from a shape and add it to the stroke history.
 * @param shape The shape type to create
 * @param screenX Screen X coordinate of the button center
 * @param screenY Screen Y coordinate of the button center
 * @returns The index of the newly created stroke
 */
function createShapeStroke(shape: ShapeType, screenX: number, screenY: number): number {
    // Convert screen position to canvas coordinates
    // Note: screenY needs to have toolbar height subtracted since screenToCanvas expects canvas-relative coords
    const canvasPos = screenToCanvas({ x: screenX, y: screenY - TOOLBAR_HEIGHT });

    // Shape size is 2x the button diameter, scaled by current view transform
    const shapeSize = (SHAPE_BUTTON_SIZE * 2) / state.viewTransform.scale;

    // Get current color and size from callbacks
    const color = getColorCallback ? getColorCallback() : '#FF8000';
    const size = getSizeCallback ? getSizeCallback() : 6;

    // Generate the shape points
    const points = generateShapePoints(shape, canvasPos.x, canvasPos.y, shapeSize);

    // Create the stroke
    const stroke: Stroke = {
        color,
        size,
        points,
        originalPoints: [...points]  // Keep a copy of original points
    };

    // Add to stroke history
    state.strokeHistory.push(stroke);

    // Select the new stroke
    const newStrokeIdx = state.strokeHistory.length - 1;
    state.highlightedStrokes.clear();
    state.highlightedStrokes.add(newStrokeIdx);

    // Redraw the canvas
    redraw();

    return newStrokeIdx;
}

/**
 * Remove a stroke from the stroke history by its index.
 * Adjusts session tracking for any strokes that shift position.
 * @param strokeIdx The index of the stroke to remove
 */
function removeShapeStroke(strokeIdx: number): void {
    if (strokeIdx < 0 || strokeIdx >= state.strokeHistory.length) return;

    // Remove the stroke
    state.strokeHistory.splice(strokeIdx, 1);

    // Clear highlight if this stroke was highlighted
    state.highlightedStrokes.delete(strokeIdx);

    // Adjust highlighted stroke indices for strokes after the removed one
    const newHighlighted = new Set<number>();
    for (const idx of state.highlightedStrokes) {
        if (idx > strokeIdx) {
            newHighlighted.add(idx - 1);
        } else {
            newHighlighted.add(idx);
        }
    }
    state.highlightedStrokes = newHighlighted;

    // Adjust session tracking: decrement indices for strokes after the removed one
    const newSessionStrokes = new Map<number, number>();
    for (const [btnIdx, sIdx] of sessionShapeStrokes) {
        if (sIdx > strokeIdx) {
            newSessionStrokes.set(btnIdx, sIdx - 1);
        } else if (sIdx < strokeIdx) {
            newSessionStrokes.set(btnIdx, sIdx);
        }
        // If sIdx === strokeIdx, we don't add it (it's being removed)
    }
    sessionShapeStrokes = newSessionStrokes;

    // Redraw the canvas
    redraw();
}

// ============================================================================
// SVG ICONS
// ============================================================================

/**
 * Get SVG icon for a shape type.
 * All icons are designed for a 24x24 viewBox with stroke outlines.
 */
function getShapeSVG(shape: ShapeType): string {
    const strokeWidth = 2;
    const stroke = 'currentColor';
    const fill = 'none';

    switch (shape) {
        case 'circle':
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <circle cx="12" cy="12" r="9" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}"/>
            </svg>`;

        case 'triangle':
            // Equilateral triangle pointing up
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="12,3 22,21 2,21" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'right-triangle':
            // Right-angle triangle (90° at bottom-left)
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="3,21 3,3 21,21" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'square':
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <rect x="3" y="3" width="18" height="18" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}"/>
            </svg>`;

        case 'pentagon':
            // Regular pentagon pointing up
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="12,2 22,9 19,21 5,21 2,9" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'hexagon':
            // Regular hexagon (flat top)
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="6,3 18,3 23,12 18,21 6,21 1,12" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'octagon':
            // Regular octagon
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'arrow':
            // Arrow outline pointing right
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polygon points="2,8 14,8 14,3 22,12 14,21 14,16 2,16" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linejoin="round"/>
            </svg>`;

        case 'square-brace':
            // Square bracket shape [
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <polyline points="16,3 8,3 8,21 16,21" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;

        case 'curly-brace':
            // Curly brace shape {
            return `<svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M16,3 C13,3 12,5 12,8 L12,10 C12,11 11,12 9,12 C11,12 12,13 12,14 L12,16 C12,19 13,21 16,21" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linecap="round"/>
            </svg>`;
    }
}

// ============================================================================
// BUTTON MANAGEMENT
// ============================================================================

/**
 * Create shape button elements and add them to the radial menu.
 * Buttons are created hidden and will be shown when the shapes action is selected.
 * @param container The container element to add buttons to
 * @param getCurrentColor Callback to get current color
 * @param getCurrentSize Callback to get current size
 */
export function createShapeButtons(
    container: HTMLElement,
    getCurrentColor?: () => string,
    getCurrentSize?: () => number
): void {
    // Store callbacks
    getColorCallback = getCurrentColor || null;
    getSizeCallback = getCurrentSize || null;

    shapeButtons = SHAPE_TYPES.map((shape, index) => {
        const btn = document.createElement('div');
        btn.className = 'radial-shape-btn';
        btn.dataset.shape = shape;
        btn.dataset.index = index.toString();
        btn.innerHTML = getShapeSVG(shape);

        btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Check if this button already added a shape in this session
            if (sessionShapeStrokes.has(index)) {
                // Remove the shape and clear from session
                const strokeIdx = sessionShapeStrokes.get(index)!;
                removeShapeStroke(strokeIdx);
                // Note: removeShapeStroke already removes from sessionShapeStrokes
            } else {
                // Get the button's center position in screen coordinates
                const rect = btn.getBoundingClientRect();
                const buttonCenterX = rect.left + rect.width / 2;
                const buttonCenterY = rect.top + rect.height / 2;

                // Create the shape stroke at the button's position
                const strokeIdx = createShapeStroke(shape, buttonCenterX, buttonCenterY);

                // Track this shape in the session
                sessionShapeStrokes.set(index, strokeIdx);
            }
        });

        container.appendChild(btn);
        return btn;
    });
}

/**
 * Calculate the radius for shape buttons.
 * 10 buttons of SHAPE_BUTTON_SIZE arranged in a circle.
 */
function getShapeButtonsRadius(): number {
    // For 10 buttons, calculate radius so they don't overlap
    // Using the formula: radius = buttonSize / (2 * sin(π / n))
    const baseRadius = SHAPE_BUTTON_SIZE / (2 * Math.sin(Math.PI / SHAPE_TYPES.length));
    return baseRadius + SHAPE_BUTTON_SIZE / 8;  // Add small padding
}

/**
 * Position shape buttons in a circle around the center.
 * Starting from the top (up direction) and going clockwise.
 */
export function positionShapeButtons(): void {
    if (!shapeButtons.length) return;

    const cursorScreenPos = getCursorScreenPos();
    const halfButton = SHAPE_BUTTON_SIZE / 2;
    const centerX = cursorScreenPos.x;
    const centerY = cursorScreenPos.y + TOOLBAR_HEIGHT;

    const radius = getShapeButtonsRadius();

    for (let i = 0; i < shapeButtons.length; i++) {
        // Start from top (-π/2) and go clockwise
        const angle = (i / shapeButtons.length) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius - halfButton;
        const y = centerY + Math.sin(angle) * radius - halfButton;
        shapeButtons[i].style.left = `${x}px`;
        shapeButtons[i].style.top = `${y}px`;
    }
}

/**
 * Show shape buttons with animation.
 */
export function showShapeButtons(): void {
    if (shapeButtonsVisible) return;
    shapeButtonsVisible = true;

    // Position buttons first (while invisible)
    positionShapeButtons();

    // Then make them visible with animation
    requestAnimationFrame(() => {
        for (const btn of shapeButtons) {
            btn.classList.add('visible');
        }
    });
}

/**
 * Hide shape buttons with animation.
 */
export function hideShapeButtons(): void {
    if (!shapeButtonsVisible) return;
    shapeButtonsVisible = false;

    for (const btn of shapeButtons) {
        btn.classList.remove('visible');
    }
}

/**
 * Check if shape buttons are currently visible.
 */
export function areShapeButtonsVisible(): boolean {
    return shapeButtonsVisible;
}

/**
 * Clear the session tracking for shape strokes.
 * Should be called when the radial menu is closed.
 */
export function clearShapeSession(): void {
    sessionShapeStrokes.clear();
}
