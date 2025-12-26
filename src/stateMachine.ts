/**
 * WebDraw State Machine
 *
 * This module defines the complete state machine for the WebDraw application,
 * including all states, events, transitions, and the Fresh Stroke feature.
 */

// ============================================================================
// STATES
// ============================================================================

export enum State {
    Idle = 'Idle',
    MovingMarker = 'MovingMarker',
    Drawing = 'Drawing',
    Transform = 'Transform'
}

// ============================================================================
// STATE MODIFIERS
// ============================================================================

/**
 * Fresh Stroke Mode (boolean flag isFreshStroke)
 * When true: The marker shows green, and 3-finger transform affects only the last stroke
 * When false: Normal mode, 3-finger transform affects entire canvas
 */
export type StateModifier = {
    isFreshStroke: boolean;
};

// ============================================================================
// EVENTS
// ============================================================================

export enum Event {
    F1_DOWN = 'F1_DOWN',              // First finger touches screen
    F2_DOWN = 'F2_DOWN',              // Second finger touches screen
    F3_DOWN = 'F3_DOWN',              // Third finger touches screen
    FINGER_UP = 'FINGER_UP',          // Any finger lifts from screen
    TIMEOUT = 'TIMEOUT',              // 250ms has elapsed since ANY finger down
    FINGER_MOVED_FAR = 'FINGER_MOVED_FAR', // Finger moved >30px from reference point
    UNDO = 'UNDO',                    // Undo button pressed
    CLEAR = 'CLEAR'                   // Clear button pressed
}

// ============================================================================
// EVENT FLAGS
// ============================================================================

/**
 * Persistent flags set by events and checked by later transitions
 */
export type EventFlags = {
    TIMEOUT_HAPPENED: boolean;
    FINGER_MOVED_FAR_HAPPENED: boolean;
};

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Actions to execute during state transitions
 */
export enum Action {
    // Marker actions
    MOVE_MARKER = 'MOVE_MARKER',

    // Stroke actions
    CREATE_STROKE = 'CREATE_STROKE',
    SAVE_STROKE = 'SAVE_STROKE',
    ABANDON_STROKE = 'ABANDON_STROKE',

    // Fresh stroke actions
    ENTER_FRESH_STROKE = 'ENTER_FRESH_STROKE',
    EXIT_FRESH_STROKE = 'EXIT_FRESH_STROKE',

    // Transform actions
    INIT_TRANSFORM = 'INIT_TRANSFORM',
    APPLY_TRANSFORM = 'APPLY_TRANSFORM',

    // Global actions
    PROCESS_UNDO = 'PROCESS_UNDO',
    PROCESS_CLEAR = 'PROCESS_CLEAR',
    ABORT_TOO_MANY_FINGERS = 'ABORT_TOO_MANY_FINGERS',

    // Flag actions
    SET_TIMEOUT_FLAG = 'SET_TIMEOUT_FLAG',
    SET_FINGER_MOVED_FAR_FLAG = 'SET_FINGER_MOVED_FAR_FLAG',

    // No action
    DO_NOTHING = 'DO_NOTHING'
}

// ============================================================================
// TRANSITION RESULT
// ============================================================================

export type TransitionResult = {
    newState: State;
    newModifier: StateModifier;
    actions: Action[];
};

// ============================================================================
// STATE MACHINE
// ============================================================================

export class StateMachine {
    private currentState: State;
    private modifier: StateModifier;
    private flags: EventFlags;

    constructor() {
        this.currentState = State.Idle;
        this.modifier = { isFreshStroke: false };
        this.flags = {
            TIMEOUT_HAPPENED: false,
            FINGER_MOVED_FAR_HAPPENED: false
        };
    }

    // Getters
    public getState(): State {
        return this.currentState;
    }

    public getModifier(): StateModifier {
        return { ...this.modifier };
    }

    public getFlags(): EventFlags {
        return { ...this.flags };
    }

    public isFreshStroke(): boolean {
        return this.modifier.isFreshStroke;
    }

    // Process an event and return the transition result
    public processEvent(event: Event): TransitionResult {
        const result = this.transition(this.currentState, this.modifier, event, this.flags);

        // Apply the transition
        this.currentState = result.newState;
        this.modifier = result.newModifier;

        // Update flags based on actions
        if (result.actions.includes(Action.SET_TIMEOUT_FLAG)) {
            this.flags.TIMEOUT_HAPPENED = true;
        }
        if (result.actions.includes(Action.SET_FINGER_MOVED_FAR_FLAG)) {
            this.flags.FINGER_MOVED_FAR_HAPPENED = true;
        }

        // Clear flags on every finger down event
        if (event === Event.F1_DOWN || event === Event.F2_DOWN || event === Event.F3_DOWN) {
            // Reset flags when any finger touches down
            this.flags.TIMEOUT_HAPPENED = false;
            this.flags.FINGER_MOVED_FAR_HAPPENED = false;
        }

        return result;
    }

    // Reset the state machine
    public reset(): void {
        this.currentState = State.Idle;
        this.modifier = { isFreshStroke: false };
        this.flags = {
            TIMEOUT_HAPPENED: false,
            FINGER_MOVED_FAR_HAPPENED: false
        };
    }

    // ========================================================================
    // TRANSITION LOGIC
    // ========================================================================

    private transition(
        state: State,
        modifier: StateModifier,
        event: Event,
        flags: EventFlags
    ): TransitionResult {
        switch (state) {
            case State.Idle:
                return this.transitionFromIdle(modifier, event);

            case State.MovingMarker:
                return this.transitionFromMovingMarker(modifier, event);

            case State.Drawing:
                return this.transitionFromDrawing(modifier, event, flags);

            case State.Transform:
                return this.transitionFromTransform(modifier, event);

            default:
                // Should never happen
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },
                    actions: [Action.DO_NOTHING]
                };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM IDLE STATE
    // ========================================================================

    private transitionFromIdle(modifier: StateModifier, event: Event): TransitionResult {
        const { isFreshStroke } = modifier;

        switch (event) {
            case Event.F1_DOWN:
                // Keep modifier unchanged
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke },  // keep
                    actions: []
                };

            case Event.F2_DOWN:
            case Event.F3_DOWN:
            case Event.FINGER_UP:
            case Event.FINGER_MOVED_FAR:
                // Keep modifier unchanged
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.DO_NOTHING]
                };

            case Event.TIMEOUT:
                // Keep modifier unchanged
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.SET_TIMEOUT_FLAG, Action.DO_NOTHING]
                };

            case Event.UNDO:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_UNDO, Action.EXIT_FRESH_STROKE]
                };

            case Event.CLEAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_CLEAR, Action.EXIT_FRESH_STROKE]
                };

            default:
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke },
                    actions: [Action.DO_NOTHING]
                };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM MOVING MARKER STATE
    // ========================================================================

    private transitionFromMovingMarker(modifier: StateModifier, event: Event): TransitionResult {
        const { isFreshStroke } = modifier;

        switch (event) {
            case Event.F1_DOWN:
                // Keep modifier unchanged
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.DO_NOTHING]
                };

            case Event.F2_DOWN:
                // Keep modifier unchanged
                return {
                    newState: State.Drawing,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.CREATE_STROKE]
                };

            case Event.F3_DOWN:
                // Too many fingers - abort and exit Fresh Stroke (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.ABORT_TOO_MANY_FINGERS, Action.EXIT_FRESH_STROKE]
                };

            case Event.FINGER_UP:
                // Keep modifier unchanged
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke },  // keep
                    actions: []
                };

            case Event.TIMEOUT:
                // Keep modifier unchanged
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.SET_TIMEOUT_FLAG]
                };

            case Event.FINGER_MOVED_FAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.SET_FINGER_MOVED_FAR_FLAG, Action.EXIT_FRESH_STROKE, Action.MOVE_MARKER]
                };

            case Event.UNDO:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_UNDO, Action.EXIT_FRESH_STROKE]
                };

            case Event.CLEAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_CLEAR, Action.EXIT_FRESH_STROKE]
                };

            default:
                return {
                    newState: State.MovingMarker,
                    newModifier: { isFreshStroke },
                    actions: [Action.DO_NOTHING]
                };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM DRAWING STATE
    // ========================================================================

    private transitionFromDrawing(
        modifier: StateModifier,
        event: Event,
        flags: EventFlags
    ): TransitionResult {
        const { isFreshStroke } = modifier;

        switch (event) {
            case Event.F1_DOWN:
            case Event.F2_DOWN:
                // Keep modifier unchanged
                return {
                    newState: State.Drawing,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.DO_NOTHING]
                };

            case Event.F3_DOWN:
                // Keep modifier unchanged, but action depends on flag
                // Save stroke only if FINGER_MOVED_FAR_HAPPENED, else abandon
                if (flags.FINGER_MOVED_FAR_HAPPENED) {
                    return {
                        newState: State.Transform,
                        newModifier: { isFreshStroke },  // keep
                        actions: [Action.SAVE_STROKE, Action.INIT_TRANSFORM]
                    };
                } else {
                    return {
                        newState: State.Transform,
                        newModifier: { isFreshStroke },  // keep
                        actions: [Action.ABANDON_STROKE, Action.INIT_TRANSFORM]
                    };
                }

            case Event.FINGER_UP:
                // Enter Fresh Stroke mode (Normal → Fresh, Fresh → keep Fresh)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: true },  // → Fresh Stroke
                    actions: isFreshStroke ?
                        [Action.SAVE_STROKE] :  // already Fresh, just save
                        [Action.SAVE_STROKE, Action.ENTER_FRESH_STROKE]  // Normal → Fresh
                };

            case Event.TIMEOUT:
                // Keep modifier unchanged
                return {
                    newState: State.Drawing,
                    newModifier: { isFreshStroke },  // keep
                    actions: [Action.SET_TIMEOUT_FLAG]
                };

            case Event.FINGER_MOVED_FAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Drawing,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.SET_FINGER_MOVED_FAR_FLAG, Action.EXIT_FRESH_STROKE]
                };

            case Event.UNDO:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_UNDO, Action.EXIT_FRESH_STROKE]
                };

            case Event.CLEAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_CLEAR, Action.EXIT_FRESH_STROKE]
                };

            default:
                return {
                    newState: State.Drawing,
                    newModifier: { isFreshStroke },
                    actions: [Action.DO_NOTHING]
                };
        }
    }

    // ========================================================================
    // TRANSITIONS FROM TRANSFORM STATE
    // ========================================================================

    private transitionFromTransform(modifier: StateModifier, event: Event): TransitionResult {
        switch (event) {
            case Event.F1_DOWN:
            case Event.F2_DOWN:
            case Event.F3_DOWN:
                // Keep modifier unchanged
                return {
                    newState: State.Transform,
                    newModifier: modifier,  // keep
                    actions: [Action.DO_NOTHING]
                };

            case Event.FINGER_UP:
                // Keep modifier unchanged (Normal stays Normal, Fresh stays Fresh)
                return {
                    newState: State.Idle,
                    newModifier: modifier,  // keep
                    actions: []
                };

            case Event.TIMEOUT:
                // Keep modifier unchanged
                return {
                    newState: State.Transform,
                    newModifier: modifier,  // keep
                    actions: [Action.SET_TIMEOUT_FLAG]
                };

            case Event.FINGER_MOVED_FAR:
                // Keep modifier unchanged
                return {
                    newState: State.Transform,
                    newModifier: modifier,  // keep
                    actions: [Action.SET_FINGER_MOVED_FAR_FLAG]
                };

            case Event.UNDO:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_UNDO, Action.EXIT_FRESH_STROKE]
                };

            case Event.CLEAR:
                // Exit Fresh Stroke mode (→ Normal)
                return {
                    newState: State.Idle,
                    newModifier: { isFreshStroke: false },  // → Normal
                    actions: [Action.PROCESS_CLEAR, Action.EXIT_FRESH_STROKE]
                };

            default:
                return {
                    newState: State.Transform,
                    newModifier: modifier,
                    actions: [Action.DO_NOTHING]
                };
        }
    }

    // ========================================================================
    // TRANSITION TABLE UTILITIES (for debugging/documentation)
    // ========================================================================

    /**
     * Get all possible transitions from a given state
     */
    public getTransitionsFrom(state: State): Map<Event, TransitionResult> {
        const transitions = new Map<Event, TransitionResult>();

        for (const event of Object.values(Event)) {
            const normalMode = this.transition(state, { isFreshStroke: false }, event, {
                TIMEOUT_HAPPENED: false,
                FINGER_MOVED_FAR_HAPPENED: false
            });
            transitions.set(event, normalMode);
        }

        return transitions;
    }

    /**
     * Get all states
     */
    public static getAllStates(): State[] {
        return Object.values(State);
    }

    /**
     * Get all events
     */
    public static getAllEvents(): Event[] {
        return Object.values(Event);
    }

    /**
     * Get all actions
     */
    public static getAllActions(): Action[] {
        return Object.values(Action);
    }
}
