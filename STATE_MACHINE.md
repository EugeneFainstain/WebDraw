# WebDraw State Machine Documentation

This document describes the state machine implementation for the WebDraw application.

## Overview

The state machine is implemented in [src/stateMachine.ts](src/stateMachine.ts) and manages all gesture interactions in the WebDraw application. It provides a clean separation between interaction logic and rendering logic.

## Two-Finger Gesture Disambiguation

The application distinguishes between two-finger **drawing** gestures and two-finger **zoom/pan/rotate** gestures:

1. When a second finger lands, the gesture initially assumes it's a drawing gesture and enters the **Drawing** state
2. The distance between the two fingers is recorded at the moment the second finger lands
3. **Pinch Detection**: If the distance between the fingers changes by more than 8mm (PINCH_THRESHOLD_MM), a `PINCH_DETECTED` event is fired, abandoning the stroke and transitioning to **Transform** state
4. **Drawing Lock**: If the drawn stroke reaches a path length of 8mm (STROKE_LEN_THRESHOLD_MM) before any pinch is detected, the gesture is locked as a drawing gesture. Future changes in finger distance are ignored, and the stroke continues normally
5. This allows natural drawing with two fingers while still supporting zoom/pan/rotate when fingers move apart or together

**Note on Thresholds**:
- All thresholds are specified in millimeters (mm) to ensure consistent physical gesture recognition
- Thresholds are converted to pixels using device DPI (96) and `devicePixelRatio`
- **Screen-space measurements** (pinch detection, finger movement): Measured in screen pixels, unaffected by canvas zoom
- **Canvas-space measurements** (stroke path length): The threshold is dynamically adjusted by dividing by the current canvas zoom scale, ensuring 8mm of physical finger movement always locks the drawing gesture regardless of zoom level

## States

The application has **5 distinct states**:

1. **Idle** - No fingers touching the screen
2. **MovingCursor** - One finger on screen, moving the drawing cursor
3. **Drawing** - Two fingers on screen, actively drawing a stroke
4. **Transform** - Two or three fingers on screen, transforming canvas or selected stroke (zoom/pan/rotate)
5. **SelectionRectangle** - Tap-and-a-half gesture active, dragging selection rectangle

## State Modifier

**Selected Stroke Mode** (`isStrokeSelected()`: function)

- **isStrokeSelected()** - Returns true if `selectedStrokeIdx != null` (i.e., a stroke is selected)
- When true: A stroke is selected (cursor shows green)
- When false: No selection (normal mode)
- The underlying `selectedStrokeIdx` is managed by actions like [SELECT_STROKE], [SELECT_CLOSEST_STROKE], and [DESELECT_STROKE]

## Gesture Separation: 2-Finger vs 3-Finger Transform

The application separates zoom/pan/rotate gestures by finger count:

- **2-finger gesture**: ALWAYS transforms the **canvas** (zoom/pan/rotate the entire view), regardless of whether any strokes are selected or highlighted
- **3-finger gesture**: ALWAYS transforms the **selected stroke AND all highlighted strokes** together. If no stroke is selected and no strokes are highlighted, the 3-finger gesture does nothing

**Multi-stroke transformation behavior:**
- All transformed strokes rotate and scale around a shared pivot point
- The pivot point is the center of the combined bounding box of all selected/highlighted strokes
- This allows coherent group transformations where strokes maintain their relative positions

This separation allows users to:
1. Zoom/pan the canvas while keeping selected/highlighted strokes intact (using 2 fingers)
2. Transform selected and highlighted strokes together without affecting the canvas view (using 3 fingers)

## Events

The state machine responds to **13 events**:

1. **F1_DOWN** - First finger touches screen
2. **F2_DOWN** - Second finger touches screen
3. **F3_DOWN** - Third finger touches screen
4. **FINGER_DOWN** - Any finger touches screen (fires along with F1/F2/F3_DOWN)
5. **F1_UP** - Last finger lifted (was 1 finger, now 0)
6. **F2_UP** - One of two fingers lifted (was 2 fingers, now 1)
7. **F3_UP** - One of three fingers lifted (was 3 fingers, now 2)
8. **FINGER_UP** - Any finger lifts from screen (fires along with F1/F2/F3_UP)
9. **CURSOR_MOVED_FAR** - Cursor moved >3mm from `selectedStrokeCursorPos` (screen-space). Used for deselection and snap-back.
10. **LONG_STROKE_DRAWN** - Stroke path length exceeded threshold (~4mm). Used for gesture disambiguation (pinch vs draw) and stroke protection.
11. **PINCH_DETECTED** - Two-finger distance changed beyond threshold (8mm screen-space), indicating zoom/pan/rotate gesture
12. **DELETE** - Delete button pressed
13. **CLEAR** - Clear button pressed

## Event Flags

The state machine maintains **2 flags** and **3 timestamps**:

**Timestamps:**
- **singleTapHappenedTimestamp** - Set to current time on F1_UP if quick single-finger tap. Reset to 0 on FINGER_DOWN.
- **doubleTapHappenedTimestamp** - Set to current time on F1_UP if quick single-finger tap AND singleTapHappenedRecently(). Reset to 0 on FINGER_DOWN.
- **tapAndAHalfHappenedTimestamp** - Set to current time on F1_DOWN if singleTapHappenedRecently(). Reset to 0 on FINGER_UP.

**Calculated functions:**
- **isStrokeSelected()** - Returns true if `selectedStrokeIdx != null`. Managed by [SELECT_STROKE], [SELECT_CLOSEST_STROKE], [DESELECT_STROKE] actions.
- **singleTapHappenedRecently()** - Returns true if singleTapHappenedTimestamp != 0 AND (now - singleTapHappenedTimestamp) < doubleTapTimeout.
- **singleTapJustHappened()** - Returns true if singleTapHappenedTimestamp == now. Used to detect if a single tap was set in this same state machine pass.
- **doubleTapJustHappened()** - Returns true if doubleTapHappenedTimestamp == now. Used to detect if a double tap was set in this same state machine pass.
- **tapAndAHalfHappened()** - Returns true if tapAndAHalfHappenedTimestamp != 0.
- **FirstFingerWasTheLastFingerToGoDown()** - Returns true if F1_DOWN was the most recent finger-down event (no F2_DOWN or F3_DOWN after it).
- **FirstFingerWentDownRecently()** - Returns true if (now - F1_DOWN_TIMESTAMP) < singleTapTimeout. Ensures the tap was quick.

**Set by events** (reset on FINGER_DOWN):
1. **cursorMovedFarHappened** - Set when CURSOR_MOVED_FAR event fires
2. **longStrokeDrawnHappened** - Set when LONG_STROKE_DRAWN event fires

## Actions

When a state transition occurs, the state machine returns a list of **actions** to execute:

| Action | Description |
|--------|-------------|
| `MOVE_CURSOR` | Move the drawing cursor |
| `CREATE_STROKE` | Create a new stroke |
| `SAVE_STROKE` | Save current stroke to history |
| `ABANDON_STROKE` | Discard current stroke |
| `SELECT_STROKE` | Select a stroke (enter selected stroke mode) |
| `SELECT_CLOSEST_STROKE` | Select closest stroke to cursor |
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
| `SAVE_DRAG_START_CURSOR` | Save cursor position when starting drag (for snap-back after transform) |
| `RESTORE_DRAG_START_CURSOR` | Restore cursor after canvas transform (2-finger zoom) |
| `DO_NOTHING` | No action required |

## Transition Tables

**Table Format:**
- "-----" means no transition and no action
- "Stay" means remain in current state
- Only state changes and modifier changes are mentioned explicitly

### FROM Any State - BEFORE ALL

These flag updates happen regardless of current state, before state-specific transitions are processed.

**Rule of thumb:** Calculations/checks and timestamp assignments (setting to `now`) go here.

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | If singleTapHappenedRecently() -> set tapAndAHalfHappenedTimestamp = now. |
| F1_UP | If quick single-finger tap (i.e. !cursorMovedFarHappened && FirstFingerWasTheLastFingerToGoDown() && FirstFingerWentDownRecently()): if singleTapHappenedRecently() -> set doubleTapHappenedTimestamp = now, else -> set singleTapHappenedTimestamp = now |
| CURSOR_MOVED_FAR | Set cursorMovedFarHappened = true |
| DELETE | Go to Idle. do [CANCEL_SELECTION_RECTANGLE, PROCESS_DELETE] |
| CLEAR | Go to Idle. do [CANCEL_SELECTION_RECTANGLE, PROCESS_CLEAR, DESELECT_STROKE] |

### FROM Any State - AFTER ALL

These updates happen regardless of current state, after state-specific transitions are processed.

**Rule of thumb:** Resets and zero assignments (setting to `0`) go here.

| Event | Transitions and/or Actions |
|-------|---------------------------|
| FINGER_DOWN | Set singleTapHappenedTimestamp = 0, doubleTapHappenedTimestamp = 0. Reset cursorMovedFarHappened, longStrokeDrawnHappened. |
| FINGER_UP | Set tapAndAHalfHappenedTimestamp = 0. |

### Postprocessing

After all tables have been processed, record the timestamp for the current event. For every event X, we maintain X_TIMESTAMP which is set to the current time when event X fires. For example, F1_DOWN sets F1_DOWN_TIMESTAMP = now, FINGER_UP sets FINGER_UP_TIMESTAMP = now, etc.

### FROM Idle State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | If tapAndAHalfHappened() -> Go to SelectionRectangle, do [START_SELECTION_RECTANGLE, DESELECT_STROKE]. Else -> Go to MovingCursor, do [SAVE_DRAG_START_CURSOR] |
| F2_DOWN | ----- |
| F3_DOWN | ----- |
| FINGER_UP | ----- |
| PINCH_DETECTED | ----- |

### FROM MovingCursor State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F2_DOWN | Go to Drawing. do [CREATE_STROKE] |
| F3_DOWN | Go to Idle. do [ABORT_TOO_MANY_FINGERS, DESELECT_STROKE] |
| F1_UP | If doubleTapJustHappened() -> do [SELECT_CLOSEST_STROKE]. Else if singleTapJustHappened() -> do [CLEAR_HIGHLIGHTING]; if isStrokeSelected() -> also do [DESELECT_STROKE]. Finally: Go to Idle. |
| CURSOR_MOVED_FAR | If isStrokeSelected() -> do [DESELECT_STROKE] |
| PINCH_DETECTED | ----- |

### FROM Drawing State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | ----- |
| PINCH_DETECTED | Go to Transform. do [ABANDON_STROKE, INIT_TRANSFORM] |
| F3_DOWN | Go to Transform. If longStrokeDrawnHappened -> do [SAVE_STROKE, INIT_TRANSFORM], else do [ABANDON_STROKE, INIT_TRANSFORM] |
| FINGER_UP | Go to MovingCursor. do [SAVE_STROKE]. If not isStrokeSelected() -> do [SELECT_STROKE] |
| LONG_STROKE_DRAWN | Set longStrokeDrawnHappened = true |

**Note on PINCH_DETECTED:** Triggered when two-finger distance changes by >8mm (screen-space). The stroke is abandoned (not saved) and transform begins. However, if the stroke has already reached the length threshold (LONG_STROKE_DRAWN fired), the gesture is locked as drawing and PINCH_DETECTED won't fire.

**Note on Drawing Lock and Highlighting:** When in Drawing state, one of two mutually exclusive events will occur first:
1. **PINCH_DETECTED fires first** - Gesture becomes zoom/pan. Stroke is abandoned, highlighting is preserved (user can continue to transform highlighted strokes).
2. **LONG_STROKE_DRAWN fires first** - Gesture is locked as drawing. Highlighting is cleared (user is committed to drawing a new stroke). This happens in `cursorMovement.ts` when `lockGestureAsDrawing()` is called.

### FROM Transform State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | ----- |
| F3_DOWN | ----- |
| FINGER_UP | Go to Idle. do [RESTORE_DRAG_START_CURSOR] |
| PINCH_DETECTED | ----- |

### FROM SelectionRectangle State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | Go to Idle. do [CANCEL_SELECTION_RECTANGLE] |
| F3_DOWN | Go to Idle. do [CANCEL_SELECTION_RECTANGLE] |
| FINGER_UP | Go to Idle. do [APPLY_SELECTION_RECTANGLE] |
| PINCH_DETECTED | ----- |

**Note:** SelectionRectangle state always has isStrokeSelected() = false.

**Note:** While in SelectionRectangle state, the rectangle updates continuously on cursor movement (handled outside state machine transitions).

## Implementation Notes

### Event Flags Usage

1. **cursorMovedFarHappened**: Set when the cursor moves >3mm from `selectedStrokeCursorPos` (the anchor point on the selected stroke). Used for:
   - Single tap detection (deselection requires no cursor movement)
   - Cursor drag restoration when finger is lifted without significant movement

2. **longStrokeDrawnHappened**: Set when the stroke being drawn exceeds the path length threshold (~4mm). Used for:
   - Stroke protection: if F3_DOWN occurs while drawing, save the stroke only if this flag is true
   - Gesture disambiguation: locks the gesture as drawing, preventing PINCH_DETECTED from firing

### Selected Stroke Mode

**isStrokeSelected()** returns true when `selectedStrokeIdx != null`.

**Entry Conditions** (actions that set `selectedStrokeIdx`):
- [SELECT_STROKE] - Automatically when completing a stroke (FINGER_UP in Drawing state)
- [SELECT_CLOSEST_STROKE] - On double-tap, selects the closest stroke to the cursor

**Exit Conditions** (actions that clear `selectedStrokeIdx`):
- [DESELECT_STROKE] - Called on:
  - Single tap (quick tap without timeout or movement) when a stroke is selected
  - CLEAR button pressed
  - Cursor movement >3mm from `selectedStrokeCursorPos` (CURSOR_MOVED_FAR event)
  - Too many fingers (F3_DOWN in MovingCursor)
  - Tap-and-a-half (entering SelectionRectangle mode)
- DELETE button pressed (removes selected stroke, may select another)

**Note on Deselection Distance:** The deselection distance is measured from `selectedStrokeCursorPos`, which is:
- Updated continuously while drawing (tracks the last point added to the stroke)
- Set to the closest point on the stroke when manually selecting via double-tap
This anchor-based approach provides more intuitive deselection behavior compared to using finger movement thresholds.

**Behavior:**
- 2-finger transform always affects the entire canvas (regardless of selection/highlighting)
- 3-finger transform affects the selected stroke AND all highlighted strokes together (does nothing if none)
- Visual indicator: cursor shows green when a stroke is selected, white otherwise
- The selected stroke index is tracked in `app.ts` as `selectedStrokeIdx` (null = no selection)

### Stroke Protection

When in Drawing state and F3_DOWN event occurs:
- If `longStrokeDrawnHappened` flag is true: stroke is saved before entering Transform
- If `longStrokeDrawnHappened` flag is false: stroke is abandoned (assumed accidental)

### Selection Rectangle Mode

**Entry Condition:**
- Tap-and-a-half gesture: Quick tap (F1_DOWN -> FINGER_UP without timing out or cursor moving more than a few pixels), then another F1_DOWN before timeout

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
   - `isStrokeSelected()` function - checks if a stroke is selected
   - `EventFlags` type - Persistent event flags
   - `StateMachine` class - Main state machine logic

2. **[src/actions.ts](src/actions.ts)** - Action handlers
   - `handleActions()` - Executes actions returned by state machine transitions
   - Handles stroke creation, selection, deselection, transforms, etc.

3. **[src/eventHandler.ts](src/eventHandler.ts)** - Event generation
   - Tracks pointer positions
   - Generates state machine events based on pointer interactions
   - Manages timeout and movement threshold detection

4. **[src/app.ts](src/app.ts)** - Application integration
   - Creates `StateMachine` and `EventHandler` instances
   - Wires up event callback to process events and execute actions
   - Manages rendering and canvas state

### Usage Example

```typescript
import { StateMachine, Event } from './stateMachine';

const stateMachine = new StateMachine();

// Process an event
const result = stateMachine.processEvent(Event.F1_DOWN);
console.log(result.newState);  // State.MovingCursor
console.log(result.actions);    // []

// Check current state
console.log(stateMachine.getState());  // State.MovingCursor

// Check if a stroke is selected (returns selectedStrokeIdx != null)
console.log(isStrokeSelected());  // false
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

2. **Check if stroke is selected:**
   ```typescript
   console.log(isStrokeSelected());  // true if selectedStrokeIdx != null
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
