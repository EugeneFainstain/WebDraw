# WebDraw State Machine Documentation

This document describes the state machine implementation for the WebDraw application.

## Overview

The state machine is implemented in [src/stateMachine.ts](src/stateMachine.ts) and manages all gesture interactions in the WebDraw application. It provides a clean separation between interaction logic and rendering logic.

## States

The application has **4 distinct states**:

1. **Idle** - No fingers touching the screen
2. **MovingMarker** - One finger on screen, moving the drawing marker
3. **Drawing** - Two fingers on screen, actively drawing a stroke
4. **Transform** - Three fingers on screen, transforming canvas or fresh stroke

## State Modifier

**Fresh Stroke Mode** (`isFreshStroke: boolean`)

- When `true`: The marker shows green, and 3-finger transform affects only the last stroke
- When `false`: Normal mode, 3-finger transform affects entire canvas

## Events

The state machine responds to **8 events**:

1. **F1_DOWN** - First finger touches screen
2. **F2_DOWN** - Second finger touches screen
3. **F3_DOWN** - Third finger touches screen
4. **FINGER_UP** - Any finger lifts from screen
5. **TIMEOUT** - 250ms has elapsed since ANY finger down
6. **FINGER_MOVED_FAR** - Finger moved >30px from reference point
7. **UNDO** - Undo button pressed
8. **CLEAR** - Clear button pressed

## Event Flags

The state machine maintains **2 persistent flags** that are set by events and checked by later transitions:

1. **TIMEOUT_HAPPENED** - Set when TIMEOUT event fires
2. **FINGER_MOVED_FAR_HAPPENED** - Set when FINGER_MOVED_FAR event fires

These flags are reset on every finger down event (F1_DOWN, F2_DOWN, or F3_DOWN).

## Actions

When a state transition occurs, the state machine returns a list of **actions** to execute:

| Action | Description |
|--------|-------------|
| `MOVE_MARKER` | Move the drawing marker |
| `CREATE_STROKE` | Create a new stroke |
| `SAVE_STROKE` | Save current stroke to history |
| `ABANDON_STROKE` | Discard current stroke |
| `ENTER_FRESH_STROKE` | Enter fresh stroke mode |
| `EXIT_FRESH_STROKE` | Exit fresh stroke mode |
| `INIT_TRANSFORM` | Initialize 3-finger transform |
| `APPLY_TRANSFORM` | Apply transform (continuous) |
| `PROCESS_UNDO` | Execute undo operation |
| `PROCESS_CLEAR` | Execute clear operation |
| `ABORT_TOO_MANY_FINGERS` | Abort gesture (too many fingers) |
| `SET_TIMEOUT_FLAG` | Set TIMEOUT_HAPPENED flag |
| `SET_FINGER_MOVED_FAR_FLAG` | Set FINGER_MOVED_FAR_HAPPENED flag |
| `DO_NOTHING` | No action required |

## Transition Tables

### FROM Idle State

| Event | Normal Mode → | Fresh Stroke Mode → |
|-------|---------------|---------------------|
| F1_DOWN | MovingMarker (Normal) | MovingMarker (Fresh Stroke) |
| F2_DOWN | Idle (Normal) - do nothing | Idle (Fresh Stroke) - do nothing |
| F3_DOWN | Idle (Normal) - do nothing | Idle (Fresh Stroke) - do nothing |
| FINGER_UP | Idle (Normal) - do nothing | Idle (Fresh Stroke) - do nothing |
| TIMEOUT | Idle (Normal) - set TIMEOUT_HAPPENED flag | Idle (Fresh Stroke) - set TIMEOUT_HAPPENED flag |
| FINGER_MOVED_FAR | Idle (Normal) - do nothing | Idle (Fresh Stroke) - do nothing |
| UNDO | Idle (Normal) - process undo, exit Fresh Stroke | Idle (Normal) - process undo, exit Fresh Stroke |
| CLEAR | Idle (Normal) - process clear, exit Fresh Stroke | Idle (Normal) - process clear, exit Fresh Stroke |

### FROM MovingMarker State

| Event | Normal Mode → | Fresh Stroke Mode → |
|-------|---------------|---------------------|
| F1_DOWN | MovingMarker (Normal) - do nothing | MovingMarker (Fresh Stroke) - do nothing |
| F2_DOWN | Drawing (Normal) - create stroke | Drawing (Fresh Stroke) - create stroke |
| F3_DOWN | Idle (Normal) - abort, exit Fresh Stroke | Idle (Normal) - abort, exit Fresh Stroke |
| FINGER_UP | Idle (Normal) | Idle (Fresh Stroke) |
| TIMEOUT | MovingMarker (Normal) - set TIMEOUT_HAPPENED flag | MovingMarker (Fresh Stroke) - set TIMEOUT_HAPPENED flag |
| FINGER_MOVED_FAR | MovingMarker (Normal) - exit Fresh Stroke, set flag | MovingMarker (Normal) - exit Fresh Stroke, set flag |
| UNDO | MovingMarker (Normal) - process undo, exit Fresh Stroke | MovingMarker (Normal) - process undo, exit Fresh Stroke |
| CLEAR | MovingMarker (Normal) - process clear, exit Fresh Stroke | MovingMarker (Normal) - process clear, exit Fresh Stroke |

### FROM Drawing State

| Event | Normal Mode → | Fresh Stroke Mode → |
|-------|---------------|---------------------|
| F1_DOWN | Drawing (Normal) - do nothing | Drawing (Fresh Stroke) - do nothing |
| F2_DOWN | Drawing (Normal) - do nothing | Drawing (Fresh Stroke) - do nothing |
| F3_DOWN | Transform (Normal) - save stroke if FINGER_MOVED_FAR_HAPPENED, else abandon | Transform (Fresh Stroke) - save stroke if FINGER_MOVED_FAR_HAPPENED, else abandon |
| FINGER_UP | Idle (Fresh Stroke) - save stroke, enter Fresh Stroke | Idle (Fresh Stroke) - save stroke, stay Fresh Stroke |
| TIMEOUT | Drawing (Normal) - set TIMEOUT_HAPPENED flag | Drawing (Fresh Stroke) - set TIMEOUT_HAPPENED flag |
| FINGER_MOVED_FAR | Drawing (Normal) - exit Fresh Stroke, set flag | Drawing (Normal) - exit Fresh Stroke, set flag |
| UNDO | Idle (Normal) - exit drawing, process undo, exit Fresh Stroke | Idle (Normal) - exit drawing, process undo, exit Fresh Stroke |
| CLEAR | Idle (Normal) - exit drawing, process clear, exit Fresh Stroke | Idle (Normal) - exit drawing, process clear, exit Fresh Stroke |

### FROM Transform State

| Event | Normal Mode → | Fresh Stroke Mode → |
|-------|---------------|---------------------|
| F1_DOWN | Transform (Normal) - do nothing | Transform (Fresh Stroke) - do nothing |
| F2_DOWN | Transform (Normal) - do nothing | Transform (Fresh Stroke) - do nothing |
| F3_DOWN | Transform (Normal) - do nothing | Transform (Fresh Stroke) - do nothing |
| FINGER_UP | Idle (Normal) | Idle (Fresh Stroke) |
| TIMEOUT | Transform (Normal) - set TIMEOUT_HAPPENED flag | Transform (Fresh Stroke) - set TIMEOUT_HAPPENED flag |
| FINGER_MOVED_FAR | Transform (Normal) - set flag | Transform (Fresh Stroke) - set flag |
| UNDO | Idle (Normal) - process undo | Idle (Normal) - process undo, exit Fresh Stroke |
| CLEAR | Idle (Normal) - process clear | Idle (Normal) - process clear, exit Fresh Stroke |

## Implementation Notes

### Event Flags Usage

1. **TIMEOUT_HAPPENED**: Set after 250ms from any finger down. This flag provides timing information for stroke protection.

2. **FINGER_MOVED_FAR_HAPPENED**: Set when any finger moves >30px from its reference point. Used in Drawing state to determine whether to save or abandon a stroke when F3_DOWN occurs.

### Fresh Stroke Mode

**Entry Conditions:**
- Only entered when completing a stroke (FINGER_UP in Drawing state)

**Exit Conditions:**
- UNDO button pressed
- CLEAR button pressed
- Starting a new stroke (F2_DOWN in MovingMarker)
- Marker movement >30px from fresh stroke position (FINGER_MOVED_FAR in MovingMarker)
- Canvas transform completion (FINGER_UP in Transform when in Normal mode)

**Behavior:**
- In Fresh Stroke mode, transform only affects the last stroke
- In Normal mode, transform affects the entire canvas
- Visual indicator: marker shows green ring instead of white

### Stroke Protection

When in Drawing state and F3_DOWN event occurs:
- If `FINGER_MOVED_FAR_HAPPENED` flag is true: stroke is saved before entering Transform
- If `FINGER_MOVED_FAR_HAPPENED` flag is false: stroke is abandoned (assumed accidental)

## Code Structure

### Files

1. **[src/stateMachine.ts](src/stateMachine.ts)** - State machine core
   - `State` enum - All possible states
   - `Event` enum - All possible events
   - `Action` enum - All possible actions
   - `StateModifier` type - Fresh stroke mode flag
   - `EventFlags` type - Persistent event flags
   - `StateMachine` class - Main state machine logic

2. **[src/eventHandler.ts](src/eventHandler.ts)** - Event generation
   - Tracks pointer positions
   - Generates state machine events based on pointer interactions
   - Manages timeout and movement threshold detection

3. **[src/app.ts](src/app.ts)** - Application integration
   - Creates `StateMachine` and `EventHandler` instances
   - Implements action handlers
   - Manages rendering and canvas state

### Usage Example

```typescript
import { StateMachine, Event } from './stateMachine';

const stateMachine = new StateMachine();

// Process an event
const result = stateMachine.processEvent(Event.F1_DOWN);
console.log(result.newState);  // State.MovingMarker
console.log(result.actions);    // []

// Check current state
console.log(stateMachine.getState());  // State.MovingMarker

// Check if in fresh stroke mode
console.log(stateMachine.isFreshStroke());  // false
```

### Debugging Utilities

The `StateMachine` class provides utility methods for debugging and documentation:

```typescript
// Get all possible states
const states = StateMachine.getAllStates();

// Get all possible events
const events = StateMachine.getAllEvents();

// Get all possible actions
const actions = StateMachine.getAllActions();

// Get all transitions from a specific state
const machine = new StateMachine();
const transitions = machine.getTransitionsFrom(State.Idle);
```

## Testing

To verify state machine behavior, you can:

1. **Check current state:**
   ```typescript
   console.log(stateMachine.getState());
   ```

2. **Check modifier:**
   ```typescript
   console.log(stateMachine.getModifier());
   ```

3. **Check flags:**
   ```typescript
   console.log(stateMachine.getFlags());
   ```

4. **Trace transitions:**
   ```typescript
   eventHandler.setEventCallback((event) => {
     console.log(`Event: ${event}`);
     const result = stateMachine.processEvent(event);
     console.log(`State: ${result.newState}`);
     console.log(`Actions: ${result.actions}`);
   });
   ```
