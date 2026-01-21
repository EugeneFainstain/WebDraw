/**
 * RADIALMENU.TS - Radial Menu Component
 *
 * This module implements a radial menu that appears when the user taps inside the cursor.
 * The menu displays four buttons arranged in a circle around the cursor position:
 * - Colors (top)
 * - Shapes (right)
 * - Stroke (bottom)
 * - Operations (left)
 *
 * The buttons are positioned clockwise starting from the top, at equal distances
 * from the center matching the cursor's outer ring size.
 */

import { state, TOOLBAR_HEIGHT } from './state';
import { getCursorScreenPos } from './cursorMovement';
import { COLORS } from './colorPicker';

// ============================================================================
// TYPES
// ============================================================================

export type RadialMenuAction = 'colors' | 'shapes' | 'stroke' | 'operations';

export interface RadialMenuCallbacks {
    getPickerSize: () => number;
    onRadialMenuAction: (action: RadialMenuAction) => void;
    onOpen?: () => void;  // Called when radial menu opens (to close pickers)
    onColorSelect?: (color: string) => void;  // Called when a color is selected from radial menu
    onSizeSelect?: (size: number) => void;  // Called when a size is selected from radial menu
    onShapeSelect?: (shape: ShapeType) => void;  // Called when a shape is selected from radial menu
    getCurrentColor?: () => string;  // Get the current selected color
    getCurrentSize?: () => number;  // Get the current selected size
}

// ============================================================================
// MODULE STATE
// ============================================================================

let radialMenuEl: HTMLElement | null = null;
let callbacks: RadialMenuCallbacks;
let isVisible = false;
let wasVisibleOnFingerDown = false;  // Track if menu was visible when finger went down

// Button elements cached for positioning
let colorBtn: HTMLElement | null = null;
let shapesBtn: HTMLElement | null = null;
let strokeBtn: HTMLElement | null = null;
let operationsBtn: HTMLElement | null = null;

// Selected button state - when a button is selected, it moves to center and others fade out
let selectedAction: RadialMenuAction | null = null;
let isAnimating = false;

// Color buttons state
let colorButtons: HTMLElement[] = [];
let colorButtonsVisible = false;

// Size buttons state
let sizeButtons: HTMLElement[] = [];
let sizeButtonsVisible = false;

// Size values: 6 sizes linearly distributed from 1 to 40
const SIZE_VALUES = Array.from({ length: 6 }, (_, i) => Math.round(1 + (i * 39) / 5));
const SIZE_BUTTON_SIZE = 48;

// Shape buttons state
let shapeButtons: HTMLElement[] = [];
let shapeButtonsVisible = false;

// Shape types in order (starting from up direction, clockwise)
export type ShapeType = 'circle' | 'triangle' | 'right-triangle' | 'square' | 'pentagon' | 'hexagon' | 'octagon' | 'arrow' | 'square-brace' | 'curly-brace';
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
// INITIALIZATION
// ============================================================================

export function initRadialMenu(cb: RadialMenuCallbacks): void {
    callbacks = cb;
    radialMenuEl = document.getElementById('radialMenu');

    if (radialMenuEl) {
        // Cache button references
        colorBtn = radialMenuEl.querySelector('.radial-btn-colors');
        shapesBtn = radialMenuEl.querySelector('.radial-btn-shapes');
        strokeBtn = radialMenuEl.querySelector('.radial-btn-stroke');
        operationsBtn = radialMenuEl.querySelector('.radial-btn-operations');

        // Create color, size, and shape buttons
        createColorButtons();
        createSizeButtons();
        createShapeButtons();

        // Set up click handlers
        radialMenuEl.addEventListener('click', (e) => {
            if (isAnimating) return;

            const target = e.target as HTMLElement;
            const btn = target.closest('.radial-btn') as HTMLElement;
            if (btn) {
                const action = btn.dataset.action as RadialMenuAction;
                if (action) {
                    if (selectedAction === null) {
                        // No button selected yet - select this one
                        selectButton(action);
                    } else if (selectedAction === action) {
                        // Tapping on the selected button (at center) - go back
                        deselectButton();
                    }
                    // If tapping on a faded button, ignore (they have pointer-events: none anyway)
                }
            }
        });
    }
}

// ============================================================================
// VISIBILITY CONTROL
// ============================================================================

export function showRadialMenu(): void {
    if (!radialMenuEl || isVisible) return;

    // Notify that the radial menu is opening (to close pickers)
    if (callbacks.onOpen) {
        callbacks.onOpen();
    }

    isVisible = true;
    radialMenuEl.classList.add('visible');
    positionRadialMenu();

    // Animate buttons in with scale effect
    requestAnimationFrame(() => {
        for (const btn of getAllButtons()) {
            btn.classList.add('visible');
        }
    });
}

export function hideRadialMenu(): void {
    if (!radialMenuEl || !isVisible) return;

    isVisible = false;
    radialMenuEl.classList.remove('animating');

    // Hide any sub-menus
    hideColorButtons();
    hideSizeButtons();
    hideShapeButtons();

    // Reset selection state
    selectedAction = null;
    isAnimating = false;

    // Animate buttons out with scale effect
    for (const btn of getAllButtons()) {
        btn.classList.remove('visible');
        btn.classList.remove('faded');
    }

    // Hide the menu container after animation completes
    setTimeout(() => {
        if (!isVisible) {
            radialMenuEl?.classList.remove('visible');
        }
    }, 250);
}

export function isRadialMenuVisible(): boolean {
    return isVisible;
}

/**
 * Record the current visibility state when finger goes down.
 * Call this at the start of a gesture to track whether the menu was already open.
 */
export function recordMenuStateOnFingerDown(): void {
    wasVisibleOnFingerDown = isVisible;
}

/**
 * Check if the menu was already visible when the finger went down.
 * Used to decide whether a tap should close the menu.
 */
export function wasMenuVisibleOnFingerDown(): boolean {
    return wasVisibleOnFingerDown;
}

// ============================================================================
// POSITIONING
// ============================================================================

/**
 * Get the current cursor outer ring radius in screen pixels.
 * This matches the calculation in updateCursorDiv() for the reticle cursor.
 * The cursor has a fixed outer size at zoom=1 (same as at app startup with default stroke size 6),
 * and scales with the canvas zoom level.
 */
function getCursorOuterRadius(): number {
    // Fixed cursor size at zoom=1 - matches the size at app startup (default stroke size 6)
    const baseSize = 48;
    const defaultRenderedSize = 6;
    const fixedScale = Math.max(0.5, (defaultRenderedSize + 8) / (baseSize / 2));
    const baseCursorSize = baseSize * fixedScale;
    // Scale cursor with canvas zoom
    const cursorSize = baseCursorSize * state.viewTransform.scale;

    // Reticle cursor is 2x larger
    const reticleCursorSize = cursorSize * 2;

    // The outer circle radius in the 124x124 viewBox is 50.81
    // Convert to screen pixels: (50.81 / 124) * reticleCursorSize
    const outerRadiusRatio = 50.81 / 124;
    return outerRadiusRatio * reticleCursorSize;
}

/**
 * Position the radial menu buttons around the cursor center.
 * Buttons are arranged clockwise: top (Colors), right (Shapes), bottom (Stroke), left (Operations)
 * If a button is selected, it stays at center while others are at their normal positions.
 */
function positionRadialMenu(): void {
    if (!radialMenuEl || !colorBtn || !shapesBtn || !strokeBtn || !operationsBtn) return;

    const cursorScreenPos = getCursorScreenPos();
    const outerRadius = getCursorOuterRadius();

    // Button size (matches CSS)
    const buttonSize = 48;
    const halfButton = buttonSize / 2;

    // Distance from center to button center - place buttons just outside the outer ring
    // Add some padding so buttons don't overlap the cursor
    const distanceFromCenter = outerRadius + halfButton + 8;

    // Center position in page coordinates (add toolbar height)
    const centerX = cursorScreenPos.x;
    const centerY = cursorScreenPos.y + TOOLBAR_HEIGHT;

    // Helper to position a button - selected button goes to center, others to their normal position
    const positionButton = (btn: HTMLElement, action: RadialMenuAction, normalLeft: number, normalTop: number) => {
        if (selectedAction === action) {
            // Selected button stays at center
            btn.style.left = `${centerX - halfButton}px`;
            btn.style.top = `${centerY - halfButton}px`;
        } else {
            btn.style.left = `${normalLeft}px`;
            btn.style.top = `${normalTop}px`;
        }
    };

    // Position buttons at 0, 90, 180, 270 degrees (top, right, bottom, left)
    // Top (Colors) - 0 degrees (up is negative Y)
    positionButton(colorBtn, 'colors', centerX - halfButton, centerY - distanceFromCenter - halfButton);

    // Right (Shapes) - 90 degrees
    positionButton(shapesBtn, 'shapes', centerX + distanceFromCenter - halfButton, centerY - halfButton);

    // Bottom (Stroke) - 180 degrees
    positionButton(strokeBtn, 'stroke', centerX - halfButton, centerY + distanceFromCenter - halfButton);

    // Left (Operations) - 270 degrees
    positionButton(operationsBtn, 'operations', centerX - distanceFromCenter - halfButton, centerY - halfButton);
}

/**
 * Update radial menu position if visible.
 * Should be called when the cursor moves.
 */
export function updateRadialMenuPosition(): void {
    if (isVisible) {
        positionRadialMenu();
        updateColorButtonPositions();
        if (shapeButtonsVisible) {
            positionShapeButtons();
        }
    }
}

// ============================================================================
// BUTTON SELECTION (MOVE TO CENTER / BACK)
// ============================================================================

/**
 * Get the button element for a given action.
 */
function getButtonForAction(action: RadialMenuAction): HTMLElement | null {
    switch (action) {
        case 'colors': return colorBtn;
        case 'shapes': return shapesBtn;
        case 'stroke': return strokeBtn;
        case 'operations': return operationsBtn;
    }
}

/**
 * Get all button elements as an array.
 */
function getAllButtons(): HTMLElement[] {
    return [colorBtn, shapesBtn, strokeBtn, operationsBtn].filter((btn): btn is HTMLElement => btn !== null);
}

/**
 * Select a button - move it to center, fade out others, and show sub-menu all at once.
 */
function selectButton(action: RadialMenuAction): void {
    if (selectedAction !== null || isAnimating || !radialMenuEl) return;

    const selectedBtn = getButtonForAction(action);
    if (!selectedBtn) return;

    isAnimating = true;
    selectedAction = action;

    // Enable position transitions
    radialMenuEl.classList.add('animating');

    const cursorScreenPos = getCursorScreenPos();
    const buttonSize = 48;
    const halfButton = buttonSize / 2;
    const centerX = cursorScreenPos.x;
    const centerY = cursorScreenPos.y + TOOLBAR_HEIGHT;

    // Move selected button to center
    selectedBtn.style.left = `${centerX - halfButton}px`;
    selectedBtn.style.top = `${centerY - halfButton}px`;

    // Fade out other buttons
    for (const btn of getAllButtons()) {
        if (btn !== selectedBtn) {
            btn.classList.add('faded');
        }
    }

    // Show sub-menu immediately (all animations happen together)
    if (action === 'colors') {
        showColorButtons();
        showSizeButtons();
    } else if (action === 'shapes') {
        showShapeButtons();
    }

    // Wait for animation to complete
    setTimeout(() => {
        isAnimating = false;
        radialMenuEl?.classList.remove('animating');
    }, 250);
}

/**
 * Deselect the current button - move it back to original position, fade in others, and hide sub-menu all at once.
 */
function deselectButton(): void {
    if (selectedAction === null || isAnimating || !radialMenuEl) return;

    isAnimating = true;

    // Enable position transitions
    radialMenuEl.classList.add('animating');

    // Clear selection BEFORE repositioning so the button goes to its normal position
    selectedAction = null;

    // Hide sub-menus (animation happens simultaneously)
    hideColorButtons();
    hideSizeButtons();
    hideShapeButtons();

    // Fade in all buttons (add visible back, remove faded)
    for (const btn of getAllButtons()) {
        btn.classList.remove('faded');
        btn.classList.add('visible');
    }

    // Reposition all buttons to their original positions
    positionRadialMenu();

    // Wait for animation to complete
    setTimeout(() => {
        isAnimating = false;
        radialMenuEl?.classList.remove('animating');
    }, 250);
}

// ============================================================================
// TAP DETECTION
// ============================================================================

/**
 * Check if a tap position is inside the cursor's outer ring.
 * @param tapScreenPos The tap position in screen coordinates (relative to canvas top-left)
 * @returns true if the tap is inside the cursor
 */
export function isTapInsideCursor(tapScreenPos: { x: number; y: number }): boolean {
    if (!state.cursorPos) return false;

    const cursorScreenPos = getCursorScreenPos();
    const outerRadius = getCursorOuterRadius();

    // Calculate distance from tap to cursor center
    const dx = tapScreenPos.x - cursorScreenPos.x;
    const dy = tapScreenPos.y - cursorScreenPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance <= outerRadius;
}

// ============================================================================
// COLOR BUTTONS
// ============================================================================

/**
 * Create color button elements and add them to the radial menu.
 * Buttons are created hidden and will be shown when the colors action is selected.
 */
function createColorButtons(): void {
    if (!radialMenuEl) return;

    colorButtons = COLORS.map((color, index) => {
        const btn = document.createElement('div');
        btn.className = 'radial-color-btn';
        btn.style.backgroundColor = color;
        btn.dataset.color = color;
        btn.dataset.index = index.toString();

        btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (callbacks.onColorSelect) {
                callbacks.onColorSelect(color);
            }
            // Update selected state
            updateColorButtonSelection(color);
            // Update size button colors to match the new color
            updateSizeButtonColors();
        });

        radialMenuEl!.appendChild(btn);
        return btn;
    });
}

/**
 * Update the selected state of color buttons.
 */
function updateColorButtonSelection(selectedColor: string): void {
    for (const btn of colorButtons) {
        if (btn.dataset.color === selectedColor) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    }
}

/**
 * Calculate the radius for size buttons (inner circle).
 * 6 buttons of SIZE_BUTTON_SIZE touching each other, plus 1/8 button padding.
 */
function getSizeButtonsRadius(): number {
    const baseRadius = SIZE_BUTTON_SIZE / (2 * Math.sin(Math.PI / SIZE_VALUES.length));
    return baseRadius + SIZE_BUTTON_SIZE / 8;
}

// Color button size - same as size buttons
const COLOR_BUTTON_SIZE = 48;

/**
 * Calculate the radius for color buttons (outer circle).
 * Positioned so they touch the size buttons circle, plus 1/8 button padding.
 */
function getColorButtonsRadius(): number {
    const sizeRadius = getSizeButtonsRadius();
    // Color buttons touch size buttons: color radius = size radius + half size button + half color button + 1/8 button padding
    return sizeRadius + SIZE_BUTTON_SIZE / 2 + COLOR_BUTTON_SIZE / 2 + COLOR_BUTTON_SIZE / 8;
}

/**
 * Position color buttons in two staggered rings around the size buttons.
 * Odd-indexed buttons form the inner ring at a fixed radius.
 * Even-indexed buttons (red, yellow, cyan, purple, white, 25% gray) are positioned
 * at the average position of their two neighbors.
 */
function positionColorButtons(): void {
    if (!colorButtons.length) return;

    const cursorScreenPos = getCursorScreenPos();
    const halfButton = COLOR_BUTTON_SIZE / 2;
    const centerX = cursorScreenPos.x;
    const centerY = cursorScreenPos.y + TOOLBAR_HEIGHT;

    const radius = getColorButtonsRadius();
    // Rotate by half a size button step so color buttons sit between size buttons
    const phaseShift = Math.PI / SIZE_VALUES.length;

    // First pass: calculate positions for odd-indexed buttons (inner ring)
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < colorButtons.length; i++) {
        const angle = (i / colorButtons.length) * 2 * Math.PI - Math.PI / 2 + phaseShift;
        positions[i] = {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius
        };
    }

    // Second pass: even-indexed buttons get averaged position of their neighbors
    for (let i = 0; i < colorButtons.length; i++) {
        let x: number, y: number;
        if (i % 2 === 0) {
            // Even index: average of neighbors
            const prevIdx = (i - 1 + colorButtons.length) % colorButtons.length;
            const nextIdx = (i + 1) % colorButtons.length;
            x = (positions[prevIdx].x + positions[nextIdx].x) / 2;
            y = (positions[prevIdx].y + positions[nextIdx].y) / 2;
        } else {
            // Odd index: use calculated position
            x = positions[i].x;
            y = positions[i].y;
        }
        colorButtons[i].style.left = `${x - halfButton}px`;
        colorButtons[i].style.top = `${y - halfButton}px`;
    }
}

/**
 * Show color buttons with animation.
 */
function showColorButtons(): void {
    if (colorButtonsVisible) return;
    colorButtonsVisible = true;

    // Update selection based on current color
    if (callbacks.getCurrentColor) {
        updateColorButtonSelection(callbacks.getCurrentColor());
    }

    // Position buttons first (while invisible)
    positionColorButtons();

    // Then make them visible with animation
    requestAnimationFrame(() => {
        for (const btn of colorButtons) {
            btn.classList.add('visible');
        }
    });
}

/**
 * Hide color buttons with animation.
 */
function hideColorButtons(): void {
    if (!colorButtonsVisible) return;
    colorButtonsVisible = false;

    for (const btn of colorButtons) {
        btn.classList.remove('visible');
    }
}

/**
 * Update color button positions if visible.
 */
function updateColorButtonPositions(): void {
    if (colorButtonsVisible) {
        positionColorButtons();
        positionSizeButtons();
    }
}

// ============================================================================
// SIZE BUTTONS
// ============================================================================

/**
 * Create size button elements and add them to the radial menu.
 * Buttons are created hidden and will be shown when the colors action is selected.
 */
function createSizeButtons(): void {
    if (!radialMenuEl) return;

    sizeButtons = SIZE_VALUES.map((size, index) => {
        const btn = document.createElement('div');
        btn.className = 'radial-size-btn';
        btn.dataset.size = size.toString();
        btn.dataset.index = index.toString();

        // Create inner dot representing the size
        // Button is 48px with 3px border, so inner area is 42px
        // Scale dot from min (4px) to max (40px) based on size value
        const dot = document.createElement('div');
        dot.className = 'radial-size-dot';
        const minDot = 4;
        const maxDot = 40;
        const minSize = SIZE_VALUES[0];
        const maxSize = SIZE_VALUES[SIZE_VALUES.length - 1];
        const dotSize = minDot + ((size - minSize) / (maxSize - minSize)) * (maxDot - minDot);
        dot.style.width = `${dotSize}px`;
        dot.style.height = `${dotSize}px`;
        btn.appendChild(dot);

        btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (callbacks.onSizeSelect) {
                callbacks.onSizeSelect(size);
            }
            // Update selected state
            updateSizeButtonSelection(size);
        });

        radialMenuEl!.appendChild(btn);
        return btn;
    });
}

/**
 * Find the closest size value to the given size.
 */
function findClosestSize(size: number): number {
    let closest = SIZE_VALUES[0];
    let minDiff = Math.abs(size - closest);
    for (const val of SIZE_VALUES) {
        const diff = Math.abs(size - val);
        if (diff < minDiff) {
            minDiff = diff;
            closest = val;
        }
    }
    return closest;
}

/**
 * Update the selected state of size buttons.
 * Finds the closest matching size value if exact match not found.
 */
function updateSizeButtonSelection(selectedSize: number): void {
    const closestSize = findClosestSize(selectedSize);
    const currentColor = callbacks.getCurrentColor ? callbacks.getCurrentColor() : '#FF8000';
    for (const btn of sizeButtons) {
        if (btn.dataset.size === closestSize.toString()) {
            btn.classList.add('selected');
            // Override inline style with green for selected button
            btn.style.borderColor = '#00ff00';
        } else {
            btn.classList.remove('selected');
            // Restore current color for non-selected buttons
            btn.style.borderColor = currentColor;
        }
    }
}

/**
 * Position size buttons in a tight inner circle.
 */
function positionSizeButtons(): void {
    if (!sizeButtons.length) return;

    const cursorScreenPos = getCursorScreenPos();
    const halfButton = SIZE_BUTTON_SIZE / 2;
    const centerX = cursorScreenPos.x;
    const centerY = cursorScreenPos.y + TOOLBAR_HEIGHT;

    const radius = getSizeButtonsRadius();

    for (let i = 0; i < sizeButtons.length; i++) {
        const angle = (i / sizeButtons.length) * 2 * Math.PI - Math.PI / 2; // Start from top
        const x = centerX + Math.cos(angle) * radius - halfButton;
        const y = centerY + Math.sin(angle) * radius - halfButton;
        sizeButtons[i].style.left = `${x}px`;
        sizeButtons[i].style.top = `${y}px`;
    }

    // Update dot colors to match current color
    updateSizeButtonColors();
}

/**
 * Update size button colors (border and dot) to match current selected color.
 * For white color, shows a black outline instead of a filled dot.
 * For the smallest size, always shows an outline instead of a filled dot.
 */
function updateSizeButtonColors(): void {
    const currentColor = callbacks.getCurrentColor ? callbacks.getCurrentColor() : '#FF8000';
    const isWhite = currentColor.toUpperCase() === '#FFFFFF' || currentColor.toUpperCase() === '#FFF';
    const smallestSize = SIZE_VALUES[0];

    for (const btn of sizeButtons) {
        // Update border color (unless selected)
        if (!btn.classList.contains('selected')) {
            btn.style.borderColor = currentColor;
        }
        // Update dot appearance
        const dot = btn.querySelector('.radial-size-dot') as HTMLElement;
        if (dot) {
            const btnSize = parseInt(btn.dataset.size || '0', 10);
            const useOutline = isWhite || btnSize === smallestSize;

            if (useOutline) {
                // For white or smallest size: show outline, transparent fill
                dot.style.backgroundColor = 'transparent';
                dot.style.border = `2px solid ${isWhite ? '#000' : currentColor}`;
            } else {
                // For other colors/sizes: filled dot, no border
                dot.style.backgroundColor = currentColor;
                dot.style.border = 'none';
            }
        }
    }
}

/**
 * Show size buttons with animation.
 */
function showSizeButtons(): void {
    if (sizeButtonsVisible) return;
    sizeButtonsVisible = true;

    // Update selection based on current size
    if (callbacks.getCurrentSize) {
        updateSizeButtonSelection(callbacks.getCurrentSize());
    }

    // Position buttons first (while invisible)
    positionSizeButtons();

    // Then make them visible with animation
    requestAnimationFrame(() => {
        for (const btn of sizeButtons) {
            btn.classList.add('visible');
        }
    });
}

/**
 * Hide size buttons with animation.
 */
function hideSizeButtons(): void {
    if (!sizeButtonsVisible) return;
    sizeButtonsVisible = false;

    for (const btn of sizeButtons) {
        btn.classList.remove('visible');
    }
}

// ============================================================================
// SHAPE BUTTONS
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

/**
 * Create shape button elements and add them to the radial menu.
 * Buttons are created hidden and will be shown when the shapes action is selected.
 */
function createShapeButtons(): void {
    if (!radialMenuEl) return;

    shapeButtons = SHAPE_TYPES.map((shape, index) => {
        const btn = document.createElement('div');
        btn.className = 'radial-shape-btn';
        btn.dataset.shape = shape;
        btn.dataset.index = index.toString();
        btn.innerHTML = getShapeSVG(shape);

        btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (callbacks.onShapeSelect) {
                callbacks.onShapeSelect(shape);
            }
            // Close the radial menu after selecting a shape
            hideRadialMenu();
        });

        radialMenuEl!.appendChild(btn);
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
function positionShapeButtons(): void {
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
function showShapeButtons(): void {
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
function hideShapeButtons(): void {
    if (!shapeButtonsVisible) return;
    shapeButtonsVisible = false;

    for (const btn of shapeButtons) {
        btn.classList.remove('visible');
    }
}
