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

// ============================================================================
// TYPES
// ============================================================================

export type RadialMenuAction = 'colors' | 'shapes' | 'stroke' | 'operations';

export interface RadialMenuCallbacks {
    getPickerSize: () => number;
    onRadialMenuAction: (action: RadialMenuAction) => void;
    onOpen?: () => void;  // Called when radial menu opens (to close pickers)
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
}

export function hideRadialMenu(): void {
    if (!radialMenuEl || !isVisible) return;

    isVisible = false;
    radialMenuEl.classList.remove('visible');
    radialMenuEl.classList.remove('animating');

    // Reset selection state
    selectedAction = null;
    isAnimating = false;

    // Remove faded class from all buttons
    for (const btn of getAllButtons()) {
        btn.classList.remove('faded');
    }
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
 */
function getCursorOuterRadius(): number {
    const strokeSize = callbacks.getPickerSize();
    const renderedSize = Math.max(strokeSize * state.viewTransform.scale, 1);

    // From cursorMovement.ts: cursor size calculation
    const baseSize = 48;
    const scale = Math.max(0.5, (renderedSize + 8) / (baseSize / 2));
    const cursorSize = baseSize * scale;

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
 * Select a button - move it to center and fade out others.
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

    // Wait for animation to complete
    setTimeout(() => {
        isAnimating = false;
        radialMenuEl?.classList.remove('animating');
    }, 250);
}

/**
 * Deselect the current button - move it back to original position and fade in others.
 */
function deselectButton(): void {
    if (selectedAction === null || isAnimating || !radialMenuEl) return;

    isAnimating = true;

    // Enable position transitions
    radialMenuEl.classList.add('animating');

    // Clear selection BEFORE repositioning so the button goes to its normal position
    selectedAction = null;

    // Fade in all buttons
    for (const btn of getAllButtons()) {
        btn.classList.remove('faded');
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
