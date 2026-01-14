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

    // Event callback - receives event and optional position for F1_DOWN/F1_UP
    private eventCallback: ((event: Event, pos?: Point) => void) | null = null;

    // Finger promotion tracking - stores the position delta when a finger is promoted
    private lastPromotionDelta: Point | null = null;

    // Two-finger gesture disambiguation
    private initialTwoFingerDistance: number | null = null;
    private gestureLockedAsDrawing: boolean = false;

    /**
     * Initialize the callback for state machine events
     */
    public initEventCallback(callback: (event: Event, pos?: Point) => void): void {
        this.eventCallback = callback;
    }

    /**
     * Emit an event to the state machine
     */
    private emitEvent(event: Event, pos?: Point): void {
        if (this.eventCallback) {
            this.eventCallback(event, pos);
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

            this.emitEvent(Event.F1_DOWN, pos);
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

            this.emitEvent(Event.F2_DOWN, pos);
            return;
        }

        // Third finger
        if (this.tertiaryPointerId === null) {
            this.tertiaryPointerId = pointerId;
            this.tertiaryPos = { ...pos };

            this.emitEvent(Event.F3_DOWN, pos);
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
     *
     * Emits specific finger-up events based on finger count transition:
     * - F1_UP: Was 1 finger, now 0 (last finger lifted)
     * - F2_UP: Was 2 fingers, now 1
     * - F3_UP: Was 3 fingers, now 2
     */
    public handlePointerUp(pointerId: number): void {
        // Determine which finger is being lifted and the finger count before lift
        const fingerCountBefore = this.getFingerCount();
        let fingerLifted = false;
        this.lastPromotionDelta = null;

        // Save the position of the lifted finger (used for tap detection spatial proximity)
        let liftedFingerPos: Point | null = null;

        if (pointerId === this.primaryPointerId) {
            // Save position before promotion
            liftedFingerPos = this.primaryPos ? { ...this.primaryPos } : null;

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
            // Save position before promotion
            liftedFingerPos = this.secondaryPos ? { ...this.secondaryPos } : null;

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
            // Save position before clearing
            liftedFingerPos = this.tertiaryPos ? { ...this.tertiaryPos } : null;

            // Tertiary finger lifted - just clear it
            this.tertiaryPointerId = null;
            this.tertiaryPos = null;
            fingerLifted = true;
        }

        if (fingerLifted) {
            // Emit specific finger-up event based on how many fingers we had before
            // F1_UP: 1 -> 0, F2_UP: 2 -> 1, F3_UP: 3 -> 2
            if (fingerCountBefore === 1) {
                this.emitEvent(Event.F1_UP, liftedFingerPos ?? undefined);
            } else if (fingerCountBefore === 2) {
                this.emitEvent(Event.F2_UP, liftedFingerPos ?? undefined);
            } else if (fingerCountBefore === 3) {
                this.emitEvent(Event.F3_UP, liftedFingerPos ?? undefined);
            }

            // Reset two-finger gesture tracking when we no longer have two fingers
            if (this.secondaryPointerId === null) {
                this.initialTwoFingerDistance = null;
                this.gestureLockedAsDrawing = false;
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
