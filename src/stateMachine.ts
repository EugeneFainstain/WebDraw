/**
 * WebDraw State Machine
 *
 * This module defines the complete state machine for the WebDraw application,
 * including all states, events, transitions, and the Selected Stroke feature.
 *
 * IMPORTANT: When modifying transitions, always update both:
 * 1. The code implementation in this file
 * 2. The state machine documentation in STATE_MACHINE.md
 * Keep them synchronized to avoid confusion.
 */

// Debug callback - set externally to avoid circular dependency with state.ts
let debugCallback: ((msg: string) => void) | null = null;

export function setStateMachineDebugCallback(callback: (msg: string) => void): void {
    debugCallback = callback;
}

function debug(msg: string): void {
    if (debugCallback) {
        debugCallback(msg);
    }
}

// ============================================================================
// STATES
// ============================================================================

export enum State {
    Idle = 'Idle',
    MovingCursor = 'MovingCursor',
    Drawing = 'Drawing',
    Transform = 'Transform',
    SelectionRectangle = 'SelectionRectangle'
}

// ============================================================================
// EVENTS
// ============================================================================

export enum Event {
    F1_DOWN = 'F1_DOWN',              // First finger touches screen
    F2_DOWN = 'F2_DOWN',              // Second finger touches screen
    F3_DOWN = 'F3_DOWN',              // Third finger touches screen
    F1_UP = 'F1_UP',                  // Last finger lifted (was 1 finger, now 0)
    F2_UP = 'F2_UP',                  // One of two fingers lifted (was 2 fingers, now 1)
    F3_UP = 'F3_UP',                  // One of three fingers lifted (was 3 fingers, now 2)
    CURSOR_MOVED_FAR = 'CURSOR_MOVED_FAR', // Cursor moved >3mm from selectedStrokeCursorPos (deselection/snap)
    LONG_STROKE_DRAWN = 'LONG_STROKE_DRAWN', // Stroke path length exceeded threshold (gesture lock)
    PINCH_DETECTED = 'PINCH_DETECTED', // Two-finger distance changed beyond threshold
    DELETE = 'DELETE',                // Delete button pressed
    CLEAR = 'CLEAR'                   // Clear button pressed
}

// ============================================================================
// EVENT FLAGS AND TIMESTAMPS
// ============================================================================

/**
 * Position type for spatial proximity checks
 */
export type Position = {
    x: number;
    y: number;
};

/**
 * Timestamps and positions for tap detection
 * Timestamps are in milliseconds since epoch, 0 means "not set" / "never happened"
 * Positions are in screen-space pixels, null means "not set"
 */
export type EventTimestamps = {
    // Derived tap detection timestamps
    singleTapHappenedTimestamp: number;      // Set on quick single-finger tap
    doubleTapHappenedTimestamp: number;      // Set on second quick tap within timeout
    tapAndAHalfHappenedTimestamp: number;    // Set on F1_DOWN if singleTapHappenedRecently AND spatially close

    // Finger-down timestamps and positions
    F1_DOWN_TIMESTAMP: number;
    F2_DOWN_TIMESTAMP: number;
    F3_DOWN_TIMESTAMP: number;
    F1_DOWN_POS: Position | null;
    F2_DOWN_POS: Position | null;
    F3_DOWN_POS: Position | null;

    // Finger-up timestamps and positions
    F1_UP_TIMESTAMP: number;
    F2_UP_TIMESTAMP: number;
    F3_UP_TIMESTAMP: number;
    F1_UP_POS: Position | null;
    F2_UP_POS: Position | null;
    F3_UP_POS: Position | null;
};

/**
 * Persistent flags set by events and checked by later transitions
 */
export type EventFlags = {
    cursorMovedFarHappened: boolean;
    longStrokeDrawnHappened: boolean;
};

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Actions to execute during state transitions
 */
export enum Action {
    // Cursor actions
    MOVE_CURSOR = 'MOVE_CURSOR',

    // Stroke actions
    CREATE_STROKE = 'CREATE_STROKE',
    SAVE_STROKE = 'SAVE_STROKE',
    ABANDON_STROKE = 'ABANDON_STROKE',

    // Selected stroke actions
    FINISH_STROKE = 'FINISH_STROKE',                     // Finish drawing stroke (save and select it)
    SELECT_CLOSEST_STROKE = 'SELECT_CLOSEST_STROKE',     // Select closest stroke to cursor (double-tap)
    DEHIGHLIGHT_ALL = 'DEHIGHLIGHT_ALL',                 // Clear all highlighting and anchor state
    DEANCHOR_CURSOR = 'DEANCHOR_CURSOR',                 // Clear anchor only (cursor moved far, but keep highlighting)

    // Selection rectangle actions
    START_SELECTION_RECTANGLE = 'START_SELECTION_RECTANGLE',
    UPDATE_SELECTION_RECTANGLE = 'UPDATE_SELECTION_RECTANGLE',
    APPLY_SELECTION_RECTANGLE = 'APPLY_SELECTION_RECTANGLE',
    CANCEL_SELECTION_RECTANGLE = 'CANCEL_SELECTION_RECTANGLE',

    // Tap actions
    SINGLE_TAP = 'SINGLE_TAP',                             // Handle single tap (may clear highlighting, interact with picker/menu)

    // Transform actions
    INIT_TRANSFORM = 'INIT_TRANSFORM',
    APPLY_TRANSFORM = 'APPLY_TRANSFORM',

    // Global actions
    PROCESS_DELETE = 'PROCESS_DELETE',
    PROCESS_CLEAR = 'PROCESS_CLEAR',
    ABORT_TOO_MANY_FINGERS = 'ABORT_TOO_MANY_FINGERS',

    // Cursor snap-back actions
    SAVE_DRAG_START_CURSOR = 'SAVE_DRAG_START_CURSOR',           // Save cursor position when starting drag
    RESTORE_DRAG_START_CURSOR = 'RESTORE_DRAG_START_CURSOR',     // Restore cursor after canvas transform
    SNAP_CURSOR_TO_SELECTED_STROKE = 'SNAP_CURSOR_TO_SELECTED_STROKE', // Snap cursor back to selectedStrokeCursorPos

    // No action
    DO_NOTHING = 'DO_NOTHING'
}

// ============================================================================
// TRANSITION RESULT
// ============================================================================

export type TransitionResult = {
    newState: State;
    actions: Action[];
};

// ============================================================================
// CONSTANTS
// ============================================================================

// Timing constants (in milliseconds)
const DOUBLE_TAP_TIMEOUT = 300;    // Max time between taps for double-tap/tap-and-a-half
const SINGLE_TAP_TIMEOUT = 200;    // Max duration for a single tap to be "quick"

// Spatial constants
// TAP_PROXIMITY_THRESHOLD_MM: Maximum distance in millimeters for tap detection.
// Used for: single-tap (F1_UP close to F1_DOWN), tap-and-a-half (F1_DOWN close to previous F1_UP),
// and double-tap (second F1_UP close to tap-and-a-half position).
// All measurements are in screen-space (zoom-independent).
const TAP_PROXIMITY_THRESHOLD_MM = 5;

// Convert millimeters to screen pixels based on device DPI
// Assumes 96 DPI as default (standard for web), adjusted by devicePixelRatio
// 1 inch = 25.4 mm, so pixels = (mm / 25.4) * DPI * devicePixelRatio
function mmToPixels(mm: number): number {
    const dpi = 96;
    const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    return (mm / 25.4) * dpi * pixelRatio;
}

// Get tap proximity threshold in pixels (computed at runtime for correct devicePixelRatio)
function getTapProximityThresholdPx(): number {
    return mmToPixels(TAP_PROXIMITY_THRESHOLD_MM);
}

// ============================================================================
// STATE MACHINE
// ============================================================================

export class StateMachine {
    private currentState: State;
    private flags: EventFlags;
    private timestamps: EventTimestamps;

    // The selected stroke index - managed externally but checked via isStrokeSelected()
    // This replaces the old StateModifier pattern
    private selectedStrokeIdxRef: { current: number | null } = { current: null };

    constructor() {
        this.currentState = State.Idle;
        this.flags = {
            cursorMovedFarHappened: false,
            longStrokeDrawnHappened: false
        };
        this.timestamps = {
            singleTapHappenedTimestamp: 0,
            doubleTapHappenedTimestamp: 0,
            tapAndAHalfHappenedTimestamp: 0,
            F1_DOWN_TIMESTAMP: 0,
            F2_DOWN_TIMESTAMP: 0,
            F3_DOWN_TIMESTAMP: 0,
            F1_DOWN_POS: null,
            F2_DOWN_POS: null,
            F3_DOWN_POS: null,
            F1_UP_TIMESTAMP: 0,
            F2_UP_TIMESTAMP: 0,
            F3_UP_TIMESTAMP: 0,
            F1_UP_POS: null,
            F2_UP_POS: null,
            F3_UP_POS: null
        };
    }

    // ========================================================================
    // GETTERS
    // ========================================================================

    public getState(): State {
        return this.currentState;
    }

    public getFlags(): EventFlags {
        return { ...this.flags };
    }

    public getTimestamps(): EventTimestamps {
        return { ...this.timestamps };
    }

    /**
     * Set the reference to the selected stroke index (from app state)
     * This allows isStrokeSelected() to check the actual app state
     */
    public setSelectedStrokeIdxRef(ref: { current: number | null }): void {
        this.selectedStrokeIdxRef = ref;
    }

    // ========================================================================
    // CALCULATED FUNCTIONS (as per STATE_MACHINE.md)
    // ========================================================================

    /**
     * Returns true if a stroke is selected (selectedStrokeIdx != null)
     */
    public isStrokeSelected(): boolean {
        return this.selectedStrokeIdxRef.current !== null;
    }

    /**
     * Returns true if a single tap happened recently (within doubleTapTimeout)
     */
    public singleTapHappenedRecently(now: number): boolean {
        return this.timestamps.singleTapHappenedTimestamp !== 0 &&
               (now - this.timestamps.singleTapHappenedTimestamp) < DOUBLE_TAP_TIMEOUT;
    }

    /**
     * Returns true if singleTapHappenedTimestamp was set in this same pass (== now)
     */
    public singleTapJustHappened(now: number): boolean {
        return this.timestamps.singleTapHappenedTimestamp === now;
    }

    /**
     * Returns true if doubleTapHappenedTimestamp was set in this same pass (== now)
     */
    public doubleTapJustHappened(now: number): boolean {
        return this.timestamps.doubleTapHappenedTimestamp === now;
    }

    /**
     * Returns true if tapAndAHalfHappenedTimestamp is set (non-zero)
     */
    public tapAndAHalfHappened(): boolean {
        return this.timestamps.tapAndAHalfHappenedTimestamp !== 0;
    }

    /**
     * Returns true if tapAndAHalfHappenedTimestamp is set and within singleTapTimeout
     * (ensures the second tap of a double-tap is quick)
     */
    public tapAndAHalfHappenedRecently(now: number): boolean {
        return this.timestamps.tapAndAHalfHappenedTimestamp !== 0 &&
               (now - this.timestamps.tapAndAHalfHappenedTimestamp) < SINGLE_TAP_TIMEOUT;
    }

    /**
     * Returns true if F1_DOWN was the most recent finger-down event
     */
    public firstFingerWasTheLastFingerToGoDown(): boolean {
        const { F1_DOWN_TIMESTAMP, F2_DOWN_TIMESTAMP, F3_DOWN_TIMESTAMP } = this.timestamps;
        return F1_DOWN_TIMESTAMP > 0 &&
               F1_DOWN_TIMESTAMP >= F2_DOWN_TIMESTAMP &&
               F1_DOWN_TIMESTAMP >= F3_DOWN_TIMESTAMP;
    }

    /**
     * Returns true if the first finger went down recently (within singleTapTimeout)
     */
    public firstFingerWentDownRecently(now: number): boolean {
        return this.timestamps.F1_DOWN_TIMESTAMP !== 0 &&
               (now - this.timestamps.F1_DOWN_TIMESTAMP) < SINGLE_TAP_TIMEOUT;
    }

    /**
     * Returns true if two positions are within the tap proximity threshold (5mm).
     * If either position is null, returns true (falls back to temporal-only check).
     */
    private arePositionsClose(pos1: Position | null, pos2: Position | null): boolean {
        if (!pos1 || !pos2) {
            return true;
        }
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance <= getTapProximityThresholdPx();
    }

    /**
     * Returns true if the given F1_DOWN position is close to the previous F1_UP position.
     * Used for tap-and-a-half detection (second tap must be near first tap).
     */
    private isF1DownCloseToLastF1Up(f1DownPos: Position | null): boolean {
        return this.arePositionsClose(f1DownPos, this.timestamps.F1_UP_POS);
    }

    /**
     * Returns true if the given F1_UP position is close to the F1_DOWN position.
     * Used for single-tap detection (finger must lift close to where it landed).
     */
    private isF1UpCloseToF1Down(f1UpPos: Position | null): boolean {
        return this.arePositionsClose(f1UpPos, this.timestamps.F1_DOWN_POS);
    }

    // ========================================================================
    // MAIN EVENT PROCESSING
    // ========================================================================

    /**
     * Process an event and return the transition result.
     * The `now` parameter should be Date.now() for consistent timestamp handling.
     * The `pos` parameter is the screen-space position of the finger for F1_DOWN/F1_UP events.
     */
    public processEvent(event: Event, now: number = Date.now(), pos: Position | null = null): TransitionResult {
        // ====================================================================
        // BEFORE ALL - Flag calculations and timestamp assignments
        // ====================================================================
        this.processBeforeAll(event, now, pos);

        // ====================================================================
        // STATE-SPECIFIC TRANSITIONS
        // ====================================================================
        const result = this.transition(this.currentState, event, now);

        // Apply the state transition
        this.currentState = result.newState;

        // ====================================================================
        // AFTER ALL - Resets and zero assignments
        // ====================================================================
        this.processAfterAll(event);

        // ====================================================================
        // POSTPROCESSING - Record event timestamps and positions
        // ====================================================================
        this.recordEventTimestamp(event, now, pos);

        return result;
    }

    /**
     * BEFORE ALL processing - happens before state-specific transitions
     * Rule: Calculations/checks and timestamp assignments (setting to `now`) go here.
     */
    private processBeforeAll(event: Event, now: number, pos: Position | null): void {
        switch (event) {
            case Event.F1_DOWN:
                // If singleTapHappenedRecently() AND F1_DOWN is close to previous F1_UP -> set tapAndAHalfHappenedTimestamp = now
                if (this.singleTapHappenedRecently(now) && this.isF1DownCloseToLastF1Up(pos)) {
                    this.timestamps.tapAndAHalfHappenedTimestamp = now;
                }
                break;

            case Event.F1_UP:
                // Quick tap requires: no cursor movement, F1 was last finger down, F1 went down recently,
                // AND F1_UP is close to F1_DOWN (spatial proximity)
                const isQuickTap = !this.flags.cursorMovedFarHappened &&
                                   this.firstFingerWasTheLastFingerToGoDown() &&
                                   this.firstFingerWentDownRecently(now) &&
                                   this.isF1UpCloseToF1Down(pos);
                if (isQuickTap) {
                    if (this.tapAndAHalfHappenedRecently(now)) {
                        // Second quick tap (tapAndAHalf was set on F1_DOWN) -> double tap
                        this.timestamps.doubleTapHappenedTimestamp = now;
                    } else {
                        // First quick tap -> single tap
                        this.timestamps.singleTapHappenedTimestamp = now;
                    }
                }
                break;

            case Event.CURSOR_MOVED_FAR:
                // Set cursorMovedFarHappened = true
                this.flags.cursorMovedFarHappened = true;
                break;

            case Event.DELETE:
                // Go to Idle, do [CANCEL_SELECTION_RECTANGLE, PROCESS_DELETE]
                // (handled in transition, but state change happens here for "any state")
                this.currentState = State.Idle;
                break;

            case Event.CLEAR:
                // Go to Idle, do [CANCEL_SELECTION_RECTANGLE, PROCESS_CLEAR, DESELECT_STROKE]
                // (handled in transition, but state change happens here for "any state")
                this.currentState = State.Idle;
                break;
        }
    }

    /**
     * AFTER ALL processing - happens after state-specific transitions
     * Rule: Resets and zero assignments (setting to `0`) go here.
     */
    private processAfterAll(event: Event): void {
        switch (event) {
            case Event.F1_DOWN:
            case Event.F2_DOWN:
            case Event.F3_DOWN:
                // FINGER_DOWN_COMMON: Reset derived tap timestamps and flags
                this.timestamps.singleTapHappenedTimestamp = 0;
                this.timestamps.doubleTapHappenedTimestamp = 0;
                this.flags.cursorMovedFarHappened = false;
                this.flags.longStrokeDrawnHappened = false;
                break;

            case Event.F1_UP:
            case Event.F2_UP:
            case Event.F3_UP:
                // FINGER_UP_COMMON: Reset tapAndAHalfHappenedTimestamp
                this.timestamps.tapAndAHalfHappenedTimestamp = 0;
                break;
        }
    }

    /**
     * Record the timestamp and position for the current event (postprocessing)
     */
    private recordEventTimestamp(event: Event, now: number, pos: Position | null): void {
        switch (event) {
            case Event.F1_DOWN:
                this.timestamps.F1_DOWN_TIMESTAMP = now;
                this.timestamps.F1_DOWN_POS = pos;
                break;
            case Event.F2_DOWN:
                this.timestamps.F2_DOWN_TIMESTAMP = now;
                this.timestamps.F2_DOWN_POS = pos;
                break;
            case Event.F3_DOWN:
                this.timestamps.F3_DOWN_TIMESTAMP = now;
                this.timestamps.F3_DOWN_POS = pos;
                break;
            case Event.F1_UP:
                this.timestamps.F1_UP_TIMESTAMP = now;
                this.timestamps.F1_UP_POS = pos;
                break;
            case Event.F2_UP:
                this.timestamps.F2_UP_TIMESTAMP = now;
                this.timestamps.F2_UP_POS = pos;
                break;
            case Event.F3_UP:
                this.timestamps.F3_UP_TIMESTAMP = now;
                this.timestamps.F3_UP_POS = pos;
                break;
        }
    }

    // ========================================================================
    // STATE TRANSITION LOGIC
    // ========================================================================

    private transition(state: State, event: Event, now: number): TransitionResult {
        // Handle global events first (DELETE, CLEAR)
        if (event === Event.DELETE) {
            return {
                newState: State.Idle,
                actions: [Action.CANCEL_SELECTION_RECTANGLE, Action.PROCESS_DELETE]
            };
        }
        if (event === Event.CLEAR) {
            return {
                newState: State.Idle,
                actions: [Action.CANCEL_SELECTION_RECTANGLE, Action.PROCESS_CLEAR, Action.DEHIGHLIGHT_ALL]
            };
        }

        switch (state) {
            case State.Idle:
                return this.transitionFromIdle(event, now);
            case State.MovingCursor:
                return this.transitionFromMovingCursor(event, now);
            case State.Drawing:
                return this.transitionFromDrawing(event);
            case State.Transform:
                return this.transitionFromTransform(event);
            case State.SelectionRectangle:
                return this.transitionFromSelectionRectangle(event, now);
            default:
                return { newState: State.Idle, actions: [] };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM IDLE STATE
    // ========================================================================

    private transitionFromIdle(event: Event, now: number): TransitionResult {
        switch (event) {
            case Event.F1_DOWN:
                // If tapAndAHalfHappened() -> Go to SelectionRectangle
                // Else -> Go to MovingCursor, do [SAVE_DRAG_START_CURSOR]
                if (this.tapAndAHalfHappened()) {
                    return {
                        newState: State.SelectionRectangle,
                        actions: [Action.START_SELECTION_RECTANGLE, Action.DEHIGHLIGHT_ALL]
                    };
                } else {
                    return {
                        newState: State.MovingCursor,
                        actions: [Action.SAVE_DRAG_START_CURSOR]
                    };
                }

            case Event.F2_DOWN:
            case Event.F3_DOWN:
            case Event.F1_UP:
            case Event.F2_UP:
            case Event.F3_UP:
            case Event.PINCH_DETECTED:
                return { newState: State.Idle, actions: [] };

            default:
                return { newState: State.Idle, actions: [] };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM MOVING CURSOR STATE
    // ========================================================================

    private transitionFromMovingCursor(event: Event, now: number): TransitionResult {
        switch (event) {
            case Event.F2_DOWN:
                // Go to Drawing, do [CREATE_STROKE]
                return {
                    newState: State.Drawing,
                    actions: [Action.CREATE_STROKE]
                };

            case Event.F3_DOWN:
                // Go to Idle, do [ABORT_TOO_MANY_FINGERS, DESELECT_STROKE]
                return {
                    newState: State.Idle,
                    actions: [Action.ABORT_TOO_MANY_FINGERS, Action.DEHIGHLIGHT_ALL]
                };

            case Event.F1_UP:
                // If singleTapJustHappened() -> do [SINGLE_TAP] (handles highlighting, picker, menu interactions)
                // Else if isStrokeSelected() -> do [SNAP_CURSOR_TO_SELECTED_STROKE] (snap back after small movement)
                // Finally: Go to Idle
                // Note: doubleTapJustHappened() is handled in SelectionRectangle state, not here
                if (this.singleTapJustHappened(now)) {
                    return {
                        newState: State.Idle,
                        actions: [Action.SINGLE_TAP]
                    };
                } else if (this.isStrokeSelected()) {
                    // Not a tap, but stroke is selected - snap cursor back to anchor
                    return {
                        newState: State.Idle,
                        actions: [Action.SNAP_CURSOR_TO_SELECTED_STROKE]
                    };
                } else {
                    return {
                        newState: State.Idle,
                        actions: []
                    };
                }

            case Event.CURSOR_MOVED_FAR:
                // If isStrokeSelected() -> do [DEANCHOR_CURSOR]
                // This clears the anchor (no snap-back) but keeps the stroke highlighted
                if (this.isStrokeSelected()) {
                    return {
                        newState: State.MovingCursor,
                        actions: [Action.DEANCHOR_CURSOR]
                    };
                }
                return { newState: State.MovingCursor, actions: [] };

            case Event.PINCH_DETECTED:
                return { newState: State.MovingCursor, actions: [] };

            default:
                return { newState: State.MovingCursor, actions: [] };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM DRAWING STATE
    // ========================================================================

    private transitionFromDrawing(event: Event): TransitionResult {
        switch (event) {
            case Event.F1_DOWN:
            case Event.F2_DOWN:
                return { newState: State.Drawing, actions: [] };

            case Event.PINCH_DETECTED:
                // Go to Transform, do [ABANDON_STROKE, INIT_TRANSFORM]
                return {
                    newState: State.Transform,
                    actions: [Action.ABANDON_STROKE, Action.INIT_TRANSFORM]
                };

            case Event.F3_DOWN:
                // Go to Transform. If longStrokeDrawnHappened -> do [SAVE_STROKE, INIT_TRANSFORM]
                // else do [ABANDON_STROKE, INIT_TRANSFORM]
                if (this.flags.longStrokeDrawnHappened) {
                    return {
                        newState: State.Transform,
                        actions: [Action.SAVE_STROKE, Action.INIT_TRANSFORM]
                    };
                } else {
                    return {
                        newState: State.Transform,
                        actions: [Action.ABANDON_STROKE, Action.INIT_TRANSFORM]
                    };
                }

            case Event.F2_UP:
                // Go to MovingCursor, do [SAVE_STROKE, FINISH_STROKE]
                // FINISH_STROKE always runs - it selects and highlights the last stroke in history
                return {
                    newState: State.MovingCursor,
                    actions: [Action.SAVE_STROKE, Action.FINISH_STROKE]
                };

            case Event.LONG_STROKE_DRAWN:
                // Set longStrokeDrawnHappened = true (done here since it's state-specific)
                this.flags.longStrokeDrawnHappened = true;
                return { newState: State.Drawing, actions: [] };

            default:
                return { newState: State.Drawing, actions: [] };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM TRANSFORM STATE
    // ========================================================================

    private transitionFromTransform(event: Event): TransitionResult {
        switch (event) {
            case Event.F1_DOWN:
            case Event.PINCH_DETECTED:
                return { newState: State.Transform, actions: [] };

            case Event.F2_DOWN:
                // Re-initialize transform with 2 fingers
                return { newState: State.Transform, actions: [Action.INIT_TRANSFORM] };

            case Event.F3_DOWN:
                // Re-initialize transform with 3 fingers
                return { newState: State.Transform, actions: [Action.INIT_TRANSFORM] };

            case Event.F1_UP:
                // Go to Idle, do [RESTORE_DRAG_START_CURSOR]
                return {
                    newState: State.Idle,
                    actions: [Action.RESTORE_DRAG_START_CURSOR]
                };

            case Event.F2_UP:
                // Re-initialize as 1-finger canvas pan
                return { newState: State.Transform, actions: [Action.INIT_TRANSFORM] };

            case Event.F3_UP:
                // Re-initialize as 2-finger canvas transform
                return { newState: State.Transform, actions: [Action.INIT_TRANSFORM] };

            default:
                return { newState: State.Transform, actions: [] };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM SELECTION RECTANGLE STATE
    // ========================================================================

    private transitionFromSelectionRectangle(event: Event, now: number): TransitionResult {
        switch (event) {
            case Event.F1_DOWN:
                return { newState: State.SelectionRectangle, actions: [] };

            case Event.F2_DOWN:
            case Event.F3_DOWN:
                // Go to Idle, do [CANCEL_SELECTION_RECTANGLE]
                return {
                    newState: State.Idle,
                    actions: [Action.CANCEL_SELECTION_RECTANGLE]
                };

            case Event.F1_UP:
            case Event.F2_UP:
            case Event.F3_UP:
                // FINGER_UP_COMMON: If doubleTapJustHappened() -> do [CANCEL_SELECTION_RECTANGLE, SELECT_CLOSEST_STROKE]
                // Else -> do [APPLY_SELECTION_RECTANGLE]
                if (this.doubleTapJustHappened(now)) {
                    return {
                        newState: State.Idle,
                        actions: [Action.CANCEL_SELECTION_RECTANGLE, Action.SELECT_CLOSEST_STROKE]
                    };
                }
                return {
                    newState: State.Idle,
                    actions: [Action.APPLY_SELECTION_RECTANGLE]
                };

            case Event.PINCH_DETECTED:
                return { newState: State.SelectionRectangle, actions: [] };

            default:
                return { newState: State.SelectionRectangle, actions: [] };
        }
    }

    // ========================================================================
    // RESET
    // ========================================================================

    public reset(): void {
        this.currentState = State.Idle;
        this.flags = {
            cursorMovedFarHappened: false,
            longStrokeDrawnHappened: false
        };
        this.timestamps = {
            singleTapHappenedTimestamp: 0,
            doubleTapHappenedTimestamp: 0,
            tapAndAHalfHappenedTimestamp: 0,
            F1_DOWN_TIMESTAMP: 0,
            F2_DOWN_TIMESTAMP: 0,
            F3_DOWN_TIMESTAMP: 0,
            F1_DOWN_POS: null,
            F2_DOWN_POS: null,
            F3_DOWN_POS: null,
            F1_UP_TIMESTAMP: 0,
            F2_UP_TIMESTAMP: 0,
            F3_UP_TIMESTAMP: 0,
            F1_UP_POS: null,
            F2_UP_POS: null,
            F3_UP_POS: null
        };
    }

    // ========================================================================
    // UTILITIES (for debugging/documentation)
    // ========================================================================

    public static getAllStates(): State[] {
        return Object.values(State);
    }

    public static getAllEvents(): Event[] {
        return Object.values(Event);
    }

    public static getAllActions(): Action[] {
        return Object.values(Action);
    }
}
