# WebDraw State Machine Documentation

This document describes the state machine implementation for the WebDraw application.

## Overview

The state machine is implemented in [src/stateMachine.ts](src/stateMachine.ts) and manages all gesture interactions in the WebDraw application. It provides a clean separation between interaction logic and rendering logic.

## States

The application has **5 distinct states**:

1. **Idle** - No fingers touching the screen
2. **MovingMarker** - One finger on screen, moving the drawing marker
3. **Drawing** - Two fingers on screen, actively drawing a stroke
4. **Transform** - Three fingers on screen, transforming canvas or selected stroke
5. **SelectionRectangle** - Tap-and-a-half gesture active, dragging selection rectangle

## State Modifier

**Selected Stroke Mode** (`isStrokeSelected: boolean`)

- When `true`: A stroke is selected (marker shows green), and 3-finger transform affects only the selected stroke
- When `false`: No selection (normal mode), 3-finger transform affects entire canvas
- The actual selected stroke index is tracked separately in `app.ts` as `selectedStrokeIdx`
- Note: `app.ts` also tracks `isFreshStroke` to distinguish between freshly-drawn selections vs manual selections

## Events

The state machine responds to **8 events**:

1. **F1_DOWN** - First finger touches screen
2. **F2_DOWN** - Second finger touches screen
3. **F3_DOWN** - Third finger touches screen
4. **FINGER_UP** - Any finger lifts from screen
5. **TIMEOUT** - 250ms has elapsed since ANY finger down
6. **FINGER_MOVED_FAR** - Finger moved >30px from reference point
7. **DELETE** - Delete button pressed
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
| `SELECT_STROKE` | Select a stroke (enter selected stroke mode) |
| `SELECT_CLOSEST_STROKE` | Select closest stroke to marker |
| `DESELECT_STROKE` | Deselect stroke (exit selected stroke mode) |
| `START_SELECTION_RECTANGLE` | Start selection rectangle mode |
| `UPDATE_SELECTION_RECTANGLE` | Update selection rectangle during drag (also updates real-time highlighting) |
| `APPLY_SELECTION_RECTANGLE` | Complete selection rectangle and keep strokes highlighted |
| `CANCEL_SELECTION_RECTANGLE` | Cancel selection rectangle and clear highlighting |
| `CLEAR_HIGHLIGHTING` | Clear all highlighted strokes |
| `INIT_TRANSFORM` | Initialize 3-finger transform |
| `APPLY_TRANSFORM` | Apply transform (continuous) |
| `PROCESS_DELETE` | Execute delete operation |
| `PROCESS_CLEAR` | Execute clear operation |
| `ABORT_TOO_MANY_FINGERS` | Abort gesture (too many fingers) |
| `SET_TIMEOUT_FLAG` | Set TIMEOUT_HAPPENED flag |
| `SET_FINGER_MOVED_FAR_FLAG` | Set FINGER_MOVED_FAR_HAPPENED flag |
| `DO_NOTHING` | No action required |

## Transition Tables

**Table Format:** Each cell shows: `NewState (NewModifier) - [Actions]`
- When modifier doesn't change, it's inherited from the current state
- Empty actions list means no actions are executed

### FROM Idle State

| Event | IF Normal Mode → | IF Stroke Selected → |
|-------|------------------|------------------------|
| F1_DOWN | MovingMarker (keep Normal) | MovingMarker (keep Selected) |
| F2_DOWN | Idle (keep Normal) | Idle (keep Selected) |
| F3_DOWN | Idle (keep Normal) | Idle (keep Selected) |
| FINGER_UP | Idle (keep Normal) | Idle (keep Selected) |
| TIMEOUT | Idle (keep Normal) - [SET_TIMEOUT_FLAG] | Idle (keep Fresh) - [SET_TIMEOUT_FLAG] |
| FINGER_MOVED_FAR | Idle (keep Normal) | Idle (keep Selected) |
| DELETE | Idle (keep) - [PROCESS_DELETE] | Idle (keep) - [PROCESS_DELETE] |
| CLEAR | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] |

### FROM MovingMarker State

| Event | IF Normal Mode → | IF Stroke Selected → |
|-------|------------------|------------------------|
| F1_DOWN (tap-and-a-half) | SelectionRectangle (→ Normal) - [START_SELECTION_RECTANGLE, DESELECT_STROKE] | SelectionRectangle (→ Normal) - [START_SELECTION_RECTANGLE, DESELECT_STROKE] |
| F1_DOWN (otherwise) | MovingMarker (keep Normal) | MovingMarker (keep Selected) |
| F2_DOWN | Drawing (keep Normal) - [CREATE_STROKE] | Drawing (keep Fresh) - [CREATE_STROKE] |
| F3_DOWN | Idle (→ Normal) - [ABORT_TOO_MANY_FINGERS, DESELECT_STROKE] | Idle (→ Normal) - [ABORT_TOO_MANY_FINGERS, DESELECT_STROKE] |
| FINGER_UP (if single tap) | Idle (keep Normal) - [CLEAR_HIGHLIGHTING] | Idle (→ Normal) - [CLEAR_HIGHLIGHTING, DESELECT_STROKE] |
| FINGER_UP (otherwise) | Idle (keep Normal) | Idle (keep Selected) |
| TIMEOUT | MovingMarker (keep Normal) - [SET_TIMEOUT_FLAG] | MovingMarker (keep Fresh) - [SET_TIMEOUT_FLAG] |
| FINGER_MOVED_FAR | MovingMarker (→ Normal) - [SET_FINGER_MOVED_FAR_FLAG, DESELECT_STROKE] | MovingMarker (→ Normal) - [SET_FINGER_MOVED_FAR_FLAG, DESELECT_STROKE] |
| DELETE | MovingMarker (keep) - [PROCESS_DELETE] | MovingMarker (keep) - [PROCESS_DELETE] |
| CLEAR | MovingMarker (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] | MovingMarker (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] |

**Note on F1_DOWN:** Tap-and-a-half is detected when F1_DOWN occurs without timeout and without movement (quick tap then another tap).

### FROM Drawing State

| Event | IF Normal Mode → | IF Stroke Selected → |
|-------|------------------|------------------------|
| F1_DOWN | Drawing (keep Normal) | Drawing (keep Selected) |
| F2_DOWN | Drawing (keep Normal) | Drawing (keep Selected) |
| F3_DOWN | Transform (keep Normal) - [SAVE if flag, else ABANDON, INIT_TRANSFORM] | Transform (keep Selected) - [SAVE if flag, else ABANDON, INIT_TRANSFORM] |
| FINGER_UP | MovingMarker (→ Selected) - [SAVE_STROKE, SELECT_STROKE] | MovingMarker (keep Selected) - [SAVE_STROKE] |
| TIMEOUT | Drawing (keep Normal) - [SET_TIMEOUT_FLAG] | Drawing (keep Selected) - [SET_TIMEOUT_FLAG] |
| FINGER_MOVED_FAR | Drawing (→ Normal) - [SET_FINGER_MOVED_FAR_FLAG, DESELECT_STROKE] | Drawing (→ Normal) - [SET_FINGER_MOVED_FAR_FLAG, DESELECT_STROKE] |
| DELETE | Idle (keep) - [PROCESS_DELETE] | Idle (keep) - [PROCESS_DELETE] |
| CLEAR | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] |

**Note on F3_DOWN:** Actions depend on FINGER_MOVED_FAR_HAPPENED flag:
- If flag is true: [SAVE_STROKE, INIT_TRANSFORM]
- If flag is false: [ABANDON_STROKE, INIT_TRANSFORM]

### FROM Transform State

| Event | IF Normal Mode → | IF Stroke Selected → |
|-------|------------------|------------------------|
| F1_DOWN | Transform (keep Normal) | Transform (keep Selected) |
| F2_DOWN | Transform (keep Normal) | Transform (keep Selected) |
| F3_DOWN | Transform (keep Normal) | Transform (keep Selected) |
| FINGER_UP | Idle (keep Normal) | Idle (keep Selected) |
| TIMEOUT | Transform (keep Normal) - [SET_TIMEOUT_FLAG] | Transform (keep Fresh) - [SET_TIMEOUT_FLAG] |
| FINGER_MOVED_FAR | Transform (keep Normal) - [SET_FINGER_MOVED_FAR_FLAG] | Transform (keep Fresh) - [SET_FINGER_MOVED_FAR_FLAG] |
| DELETE | Idle (keep) - [PROCESS_DELETE] | Idle (keep) - [PROCESS_DELETE] |
| CLEAR | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] | Idle (→ Normal) - [PROCESS_CLEAR, DESELECT_STROKE] |

### FROM SelectionRectangle State

| Event | Transition → |
|-------|--------------|
| F1_DOWN | SelectionRectangle (keep Normal) |
| F2_DOWN | Idle (→ Normal) - [CANCEL_SELECTION_RECTANGLE, DESELECT_STROKE] |
| F3_DOWN | Idle (→ Normal) - [CANCEL_SELECTION_RECTANGLE, DESELECT_STROKE] |
| FINGER_UP | Idle (→ Normal) - [APPLY_SELECTION_RECTANGLE, DESELECT_STROKE] |
| TIMEOUT | SelectionRectangle (keep Normal) - [SET_TIMEOUT_FLAG, UPDATE_SELECTION_RECTANGLE] |
| FINGER_MOVED_FAR | SelectionRectangle (keep Normal) - [SET_FINGER_MOVED_FAR_FLAG, UPDATE_SELECTION_RECTANGLE] |
| DELETE | Idle (→ Normal) - [CANCEL_SELECTION_RECTANGLE, PROCESS_DELETE] |
| CLEAR | Idle (→ Normal) - [CANCEL_SELECTION_RECTANGLE, PROCESS_CLEAR, DESELECT_STROKE] |

**Note:** Selection rectangle is always in Normal mode (no stroke selection active).

## Implementation Notes

### Event Flags Usage

1. **TIMEOUT_HAPPENED**: Set after 250ms from any finger down. This flag provides timing information for stroke protection.

2. **FINGER_MOVED_FAR_HAPPENED**: Set when any finger moves >30px from its reference point. Used in Drawing state to determine whether to save or abandon a stroke when F3_DOWN occurs.

### Selected Stroke Mode

**Entry Conditions:**
- Automatically when completing a stroke (FINGER_UP in Drawing state) - selects the stroke that was just drawn
- Manually via double-tap (handled in `app.ts`) - selects the closest stroke to the marker
  - Manual selection calls `stateMachine.setStrokeSelected(true)` to update the state machine

**Exit Conditions:**
- Single tap (quick tap without timeout or movement) when a stroke is selected - deselects the stroke
- DELETE button pressed (removes selected stroke, selects another)
- CLEAR button pressed
- Marker movement >30px from selected stroke position (FINGER_MOVED_FAR in MovingMarker)
- Too many fingers (F3_DOWN in MovingMarker)

**Behavior:**
- When a stroke is selected: 3-finger transform only affects the selected stroke
- When no stroke is selected (Normal mode): 3-finger transform affects the entire canvas
- Visual indicator: marker shows green ring when a stroke is selected, white ring otherwise
- The selected stroke index is tracked in `app.ts` as `selectedStrokeIdx` (null = no selection)
- The `isFreshStroke` flag in `app.ts` distinguishes freshly-drawn vs manually-selected strokes (for button behavior)

### Stroke Protection

When in Drawing state and F3_DOWN event occurs:
- If `FINGER_MOVED_FAR_HAPPENED` flag is true: stroke is saved before entering Transform
- If `FINGER_MOVED_FAR_HAPPENED` flag is false: stroke is abandoned (assumed accidental)

### Selection Rectangle Mode

**Entry Condition:**
- Tap-and-a-half gesture: Quick tap (F1_DOWN -> FINGER_UP without timeout/movement), then another F1_DOWN before timeout

**Behavior:**
- Dragging creates a semi-transparent blue selection rectangle
- **Real-time highlighting**: As the rectangle is dragged, strokes that intersect the rectangle are highlighted in real-time
  - Highlighted strokes are drawn with a light grey outline at 2x thickness, then the normal stroke is drawn on top
  - The highlighting updates continuously as the rectangle changes
- On FINGER_UP, the selection rectangle disappears but strokes **remain highlighted**
  - Highlighted strokes stay highlighted until explicitly cleared
  - Changing color or stroke width applies to **all highlighted strokes**
  - Any stroke with at least one point inside the rectangle is affected

**Clearing Highlighting:**
- Single tap (quick tap without timeout or movement) clears all highlighted strokes
  - Since double-tap and tap-and-a-half both start with a single tap, they automatically clear highlighting
- CLEAR button clears highlighting

**Exit Conditions:**
- FINGER_UP (completes selection, keeps strokes highlighted)
- F2_DOWN or F3_DOWN (cancels selection rectangle and clears highlighting)
- DELETE or CLEAR buttons (cancels selection rectangle and clears highlighting)

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

// Check if a stroke is selected
console.log(stateMachine.isStrokeSelected());  // false

// Manually set stroke selection (for double-tap manual selection)
stateMachine.setStrokeSelected(true);
console.log(stateMachine.isStrokeSelected());  // true
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
