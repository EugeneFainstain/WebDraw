/**
 * Event Handler for WebDraw State Machine
 *
 * Manages pointer tracking and generates state machine events based on
 * pointer interactions and timing.
 */

import { Event } from './stateMachine';

export interface Point {
    x: number;
    y: number;
}

// Constants
const TIMEOUT_DELAY = 250; // ms - timeout after any finger down

// Physical thresholds in millimeters (scale-invariant)
const PINCH_THRESHOLD_MM = 4; // mm - threshold for detecting pinch/zoom gesture
const PINCH_THRESHOLD_PX = mmToPixels(PINCH_THRESHOLD_MM); // in pixels

// Convert millimeters to screen pixels based on device DPI
// Assumes 96 DPI as default (standard for web), adjusted by devicePixelRatio
// 1 inch = 25.4 mm, so pixels = (mm / 25.4) * DPI * devicePixelRatio
function mmToPixels(mm: number): number {
    const dpi = 96; // Standard web DPI
    const pixelRatio = window.devicePixelRatio || 1;
    return (mm / 25.4) * dpi * pixelRatio;
}

/**
 * Tracks finger positions and generates state machine events
 */
export class EventHandler {
    // Finger tracking
    private primaryPointerId: number | null = null;
    private secondaryPointerId: number | null = null;
    private tertiaryPointerId: number | null = null;

    private primaryPos: Point | null = null;
    private secondaryPos: Point | null = null;
    private tertiaryPos: Point | null = null;

    // Timeout tracking
    private timeoutHandle: number | null = null;
    private lastFingerDownTime: number = 0;

    // Event callback
    private eventCallback: ((event: Event) => void) | null = null;

    // Finger promotion tracking - stores the position delta when a finger is promoted
    private lastPromotionDelta: Point | null = null;

    // Two-finger gesture disambiguation
    private initialTwoFingerDistance: number | null = null;
    private gestureLockedAsDrawing: boolean = false;

    /**
     * Set the callback for state machine events
     */
    public setEventCallback(callback: (event: Event) => void): void {
        this.eventCallback = callback;
    }

    /**
     * Emit an event to the state machine
     */
    private emitEvent(event: Event): void {
        if (this.eventCallback) {
            this.eventCallback(event);
        }
    }

    /**
     * Get the number of active fingers
     */
    public getFingerCount(): number {
        let count = 0;
        if (this.primaryPointerId !== null) count++;
        if (this.secondaryPointerId !== null) count++;
        if (this.tertiaryPointerId !== null) count++;
        return count;
    }

    /**
     * Get current finger positions
     */
    public getFingerPositions(): {
        primary: Point | null;
        secondary: Point | null;
        tertiary: Point | null;
    } {
        return {
            primary: this.primaryPos ? { ...this.primaryPos } : null,
            secondary: this.secondaryPos ? { ...this.secondaryPos } : null,
            tertiary: this.tertiaryPos ? { ...this.tertiaryPos } : null
        };
    }

    /**
     * Start timeout timer
     */
    private startTimeout(): void {
        // Clear any existing timeout
        if (this.timeoutHandle !== null) {
            clearTimeout(this.timeoutHandle);
        }

        // Start new timeout
        this.lastFingerDownTime = Date.now();
        this.timeoutHandle = window.setTimeout(() => {
            this.emitEvent(Event.TIMEOUT);
            this.timeoutHandle = null;
        }, TIMEOUT_DELAY);
    }

    /**
     * Calculate distance between two points
     */
    private getDistance(p1: Point, p2: Point): number {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Handle pointer down event
     */
    public handlePointerDown(pointerId: number, pos: Point): void {
        // First finger
        if (this.primaryPointerId === null) {
            this.primaryPointerId = pointerId;
            this.primaryPos = { ...pos };

            // Start timeout on any finger down
            this.startTimeout();

            this.emitEvent(Event.F1_DOWN);
            return;
        }

        // Second finger
        if (this.secondaryPointerId === null) {
            this.secondaryPointerId = pointerId;
            this.secondaryPos = { ...pos };

            // Record initial distance between two fingers for gesture disambiguation
            if (this.primaryPos) {
                this.initialTwoFingerDistance = this.getDistance(this.primaryPos, pos);
                this.gestureLockedAsDrawing = false;
            }

            // Restart timeout on any finger down
            this.startTimeout();

            this.emitEvent(Event.F2_DOWN);
            return;
        }

        // Third finger
        if (this.tertiaryPointerId === null) {
            this.tertiaryPointerId = pointerId;
            this.tertiaryPos = { ...pos };

            // Restart timeout on any finger down
            this.startTimeout();

            this.emitEvent(Event.F3_DOWN);
            return;
        }

        // Fourth+ fingers - ignore
    }

    /**
     * Handle pointer move event
     */
    public handlePointerMove(pointerId: number, pos: Point): void {
        // Update position
        if (pointerId === this.primaryPointerId) {
            this.primaryPos = { ...pos };
        } else if (pointerId === this.secondaryPointerId) {
            this.secondaryPos = { ...pos };
        } else if (pointerId === this.tertiaryPointerId) {
            this.tertiaryPos = { ...pos };
        }

        // Check for pinch gesture (two-finger distance change)
        if (this.primaryPos && this.secondaryPos && this.initialTwoFingerDistance !== null && !this.gestureLockedAsDrawing) {
            const currentDistance = this.getDistance(this.primaryPos, this.secondaryPos);
            const distanceChange = Math.abs(currentDistance - this.initialTwoFingerDistance);

            if (distanceChange > PINCH_THRESHOLD_PX) {
                // Pinch detected - this is a zoom gesture, not a drawing gesture
                this.emitEvent(Event.PINCH_DETECTED);
                this.gestureLockedAsDrawing = false;
            }
        }
    }

    /**
     * Handle pointer up event
     */
    public handlePointerUp(pointerId: number): void {
        let fingerLifted = false;
        this.lastPromotionDelta = null;

        if (pointerId === this.primaryPointerId) {
            // Calculate the position delta before promotion
            const oldPrimaryPos = this.primaryPos;
            const newPrimaryPos = this.secondaryPos;

            // Primary finger lifted - promote secondary to primary, tertiary to secondary
            this.primaryPointerId = this.secondaryPointerId;
            this.primaryPos = this.secondaryPos;

            this.secondaryPointerId = this.tertiaryPointerId;
            this.secondaryPos = this.tertiaryPos;

            this.tertiaryPointerId = null;
            this.tertiaryPos = null;

            // Store the delta if we promoted a finger
            if (oldPrimaryPos && newPrimaryPos) {
                this.lastPromotionDelta = {
                    x: newPrimaryPos.x - oldPrimaryPos.x,
                    y: newPrimaryPos.y - oldPrimaryPos.y
                };
            }

            fingerLifted = true;
        } else if (pointerId === this.secondaryPointerId) {
            // Calculate the position delta before promotion
            const oldSecondaryPos = this.secondaryPos;
            const newSecondaryPos = this.tertiaryPos;

            // Secondary finger lifted - promote tertiary to secondary
            this.secondaryPointerId = this.tertiaryPointerId;
            this.secondaryPos = this.tertiaryPos;

            this.tertiaryPointerId = null;
            this.tertiaryPos = null;

            // Store the delta if we promoted a finger
            if (oldSecondaryPos && newSecondaryPos) {
                this.lastPromotionDelta = {
                    x: newSecondaryPos.x - oldSecondaryPos.x,
                    y: newSecondaryPos.y - oldSecondaryPos.y
                };
            }

            fingerLifted = true;
        } else if (pointerId === this.tertiaryPointerId) {
            // Tertiary finger lifted - just clear it
            this.tertiaryPointerId = null;
            this.tertiaryPos = null;
            fingerLifted = true;
        }

        if (fingerLifted) {
            this.emitEvent(Event.FINGER_UP);

            // Reset two-finger gesture tracking when we no longer have two fingers
            if (this.secondaryPointerId === null) {
                this.initialTwoFingerDistance = null;
                this.gestureLockedAsDrawing = false;
            }

            // Clear timeout if all fingers are up
            if (this.getFingerCount() === 0) {
                if (this.timeoutHandle !== null) {
                    clearTimeout(this.timeoutHandle);
                    this.timeoutHandle = null;
                }
            }
        }
    }

    /**
     * Handle delete button press
     */
    public handleDelete(): void {
        this.emitEvent(Event.DELETE);
    }

    /**
     * Handle clear button press
     */
    public handleClear(): void {
        this.emitEvent(Event.CLEAR);
    }

    /**
     * Lock the gesture as a drawing gesture (called when stroke is long enough)
     * Once locked, pinch detection is disabled
     */
    public lockGestureAsDrawing(): void {
        this.gestureLockedAsDrawing = true;
    }

    /**
     * Check if gesture is locked as drawing
     */
    public isGestureLockedAsDrawing(): boolean {
        return this.gestureLockedAsDrawing;
    }

    /**
     * Reset all tracking state
     */
    public reset(): void {
        this.primaryPointerId = null;
        this.secondaryPointerId = null;
        this.tertiaryPointerId = null;
        this.primaryPos = null;
        this.secondaryPos = null;
        this.tertiaryPos = null;
        this.initialTwoFingerDistance = null;
        this.gestureLockedAsDrawing = false;

        if (this.timeoutHandle !== null) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
    }

    /**
     * Get time since last finger down (for debugging)
     */
    public getTimeSinceLastFingerDown(): number {
        return Date.now() - this.lastFingerDownTime;
    }

    /**
     * Get and clear the last finger promotion delta
     * Returns the screen space position delta that occurred when a finger was promoted,
     * or null if no promotion occurred in the last event.
     */
    public getAndClearPromotionDelta(): Point | null {
        const delta = this.lastPromotionDelta;
        this.lastPromotionDelta = null;
        return delta;
    }
}
