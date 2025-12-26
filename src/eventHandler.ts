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
const MOVEMENT_THRESHOLD = 30; // pixels - threshold for FINGER_MOVED_FAR event

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

    // Reference points for movement detection
    private primaryReferencePos: Point | null = null;
    private secondaryReferencePos: Point | null = null;

    // Timeout tracking
    private timeoutHandle: number | null = null;
    private lastFingerDownTime: number = 0;

    // Event callback
    private eventCallback: ((event: Event) => void) | null = null;

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
     * Check if finger has moved far from reference point
     */
    private checkMovementThreshold(current: Point, reference: Point): boolean {
        const dx = current.x - reference.x;
        const dy = current.y - reference.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance > MOVEMENT_THRESHOLD;
    }

    /**
     * Handle pointer down event
     */
    public handlePointerDown(pointerId: number, pos: Point): void {
        // First finger
        if (this.primaryPointerId === null) {
            this.primaryPointerId = pointerId;
            this.primaryPos = { ...pos };
            this.primaryReferencePos = { ...pos };

            // Start timeout on any finger down
            this.startTimeout();

            this.emitEvent(Event.F1_DOWN);
            return;
        }

        // Second finger
        if (this.secondaryPointerId === null) {
            this.secondaryPointerId = pointerId;
            this.secondaryPos = { ...pos };
            this.secondaryReferencePos = { ...pos };

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
        let updated = false;

        // Update position
        if (pointerId === this.primaryPointerId) {
            this.primaryPos = { ...pos };
            updated = true;

            // Check movement threshold
            if (this.primaryReferencePos &&
                this.checkMovementThreshold(pos, this.primaryReferencePos)) {
                this.emitEvent(Event.FINGER_MOVED_FAR);
                // Update reference point so we don't keep firing
                this.primaryReferencePos = { ...pos };
            }
        } else if (pointerId === this.secondaryPointerId) {
            this.secondaryPos = { ...pos };
            updated = true;

            // Check movement threshold for secondary finger too
            if (this.secondaryReferencePos &&
                this.checkMovementThreshold(pos, this.secondaryReferencePos)) {
                this.emitEvent(Event.FINGER_MOVED_FAR);
                // Update reference point so we don't keep firing
                this.secondaryReferencePos = { ...pos };
            }
        } else if (pointerId === this.tertiaryPointerId) {
            this.tertiaryPos = { ...pos };
            updated = true;
        }

        // No specific state machine event for move (handled by the drawing/transform logic)
    }

    /**
     * Handle pointer up event
     */
    public handlePointerUp(pointerId: number): void {
        let fingerLifted = false;

        if (pointerId === this.primaryPointerId) {
            this.primaryPointerId = null;
            this.primaryPos = null;
            this.primaryReferencePos = null;
            fingerLifted = true;
        } else if (pointerId === this.secondaryPointerId) {
            this.secondaryPointerId = null;
            this.secondaryPos = null;
            this.secondaryReferencePos = null;
            fingerLifted = true;
        } else if (pointerId === this.tertiaryPointerId) {
            this.tertiaryPointerId = null;
            this.tertiaryPos = null;
            fingerLifted = true;
        }

        if (fingerLifted) {
            this.emitEvent(Event.FINGER_UP);

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
     * Handle undo button press
     */
    public handleUndo(): void {
        this.emitEvent(Event.UNDO);
    }

    /**
     * Handle clear button press
     */
    public handleClear(): void {
        this.emitEvent(Event.CLEAR);
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
        this.primaryReferencePos = null;
        this.secondaryReferencePos = null;

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
}
