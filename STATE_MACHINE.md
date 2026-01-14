# WebDraw State Machine Documentation

**⚠️ THIS DOCUMENT IS THE GOLDEN REFERENCE ⚠️**

This document is the authoritative specification for the state machine. When there is a discrepancy between this documentation and the code, **the code is wrong** and must be fixed to match this document. Never modify this document to match buggy code.

## Overview

The state machine is implemented in [src/stateMachine.ts](src/stateMachine.ts) and manages all gesture interactions in the WebDraw application. It provides a clean separation between interaction logic and rendering logic.

## Two-Finger Gesture Disambiguation

The application distinguishes between two-finger **drawing** gestures and two-finger **zoom/pan/rotate** gestures:

1. When a second finger lands, the gesture initially assumes it's a drawing gesture and enters the **Drawing** state
2. The distance between the two fingers is recorded at the moment the second finger lands
3. **Pinch Detection**: If the distance between the fingers changes by more than 4mm (PINCH_THRESHOLD_MM), a `PINCH_DETECTED` event is fired, abandoning the stroke and transitioning to **Transform** state
4. **Drawing Lock**: If the drawn stroke reaches a path length of 4mm (STROKE_LEN_THRESHOLD_MM) before any pinch is detected, the gesture is locked as a drawing gesture. Future changes in finger distance are ignored, and the stroke continues normally
5. This allows natural drawing with two fingers while still supporting zoom/pan/rotate when fingers move apart or together

**Note on Thresholds**:
- All thresholds are specified in millimeters (mm) to ensure consistent physical gesture recognition
- Thresholds are converted to pixels using device DPI (96) and `devicePixelRatio`
- **Screen-space measurements** (pinch detection, finger movement): Measured in screen pixels, unaffected by canvas zoom
- **Canvas-space measurements** (stroke path length): The threshold is dynamically adjusted by dividing by the current canvas zoom scale, ensuring 4mm of physical finger movement always locks the drawing gesture regardless of zoom level

## States

The application has **5 distinct states**:

1. **Idle** - No fingers touching the screen
2. **MovingCursor** - One finger on screen, moving the drawing cursor
3. **Drawing** - Two fingers on screen, actively drawing a stroke
4. **Transform** - Two or three fingers on screen, transforming canvas or selected stroke (zoom/pan/rotate)
5. **SelectionRectangle** - Tap-and-a-half gesture active, dragging selection rectangle

## State Modifier

**Selected Stroke Mode** (`isOnlyOneStrokeHighlighted()`: function)

- **isOnlyOneStrokeHighlighted()** - Returns true if exactly one stroke is highlighted (i.e., `highlightedStrokes.size === 1`)
- When true: A stroke is selected (cursor shows green)
- When false: No selection (normal mode, or multiple strokes highlighted)
- The selected stroke is derived from `highlightedStrokes` - when exactly one stroke is highlighted, it's the "selected" stroke

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

The state machine responds to **11 events**:

1. **F1_DOWN** - First finger touches screen
2. **F2_DOWN** - Second finger touches screen
3. **F3_DOWN** - Third finger touches screen
4. **F1_UP** - Last finger lifted (was 1 finger, now 0)
5. **F2_UP** - One of two fingers lifted (was 2 fingers, now 1)
6. **F3_UP** - One of three fingers lifted (was 3 fingers, now 2)
7. **CURSOR_MOVED_FAR** - Cursor moved >3mm from `cursorAnchorPos` (screen-space). Used for de-anchoring (clearing anchor while keeping stroke highlighted).
8. **LONG_STROKE_DRAWN** - Stroke path length exceeded threshold (4mm). Used for gesture disambiguation (pinch vs draw) and stroke protection.
9. **PINCH_DETECTED** - Two-finger distance changed beyond threshold (4mm screen-space), indicating zoom/pan/rotate gesture
10. **DELETE** - Delete button pressed
11. **CLEAR** - Clear button pressed

**Documentation Aliases** (not separate events, just shorthand for common logic):
- **FINGER_DOWN_COMMON** - Refers to logic executed for ALL finger-down events (F1_DOWN, F2_DOWN, F3_DOWN)
- **FINGER_UP_COMMON** - Refers to logic executed for ALL finger-up events (F1_UP, F2_UP, F3_UP)

## Event Flags

The state machine maintains **2 flags**, **derived tap timestamps**, and **raw event timestamps/positions**:

**Derived Tap Timestamps** (reset on any finger down via FINGER_DOWN_COMMON):
- **singleTapHappenedTimestamp** - Set to current time on F1_UP if quick single-finger tap (see criteria below). Reset to 0 on any finger down.
- **doubleTapHappenedTimestamp** - Set to current time on F1_UP if quick single-finger tap AND tapAndAHalfHappenedRecently(). Reset to 0 on any finger down.
- **tapAndAHalfHappenedTimestamp** - Set to current time on F1_DOWN if singleTapHappenedRecently() AND isF1DownCloseToLastF1Up(). Reset to 0 on any finger up (FINGER_UP_COMMON).

**Raw Event Timestamps and Positions** (recorded in postprocessing for each event):
- **F1_DOWN_TIMESTAMP**, **F1_DOWN_POS** - When and where F1_DOWN last fired
- **F2_DOWN_TIMESTAMP**, **F2_DOWN_POS** - When and where F2_DOWN last fired
- **F3_DOWN_TIMESTAMP**, **F3_DOWN_POS** - When and where F3_DOWN last fired
- **F1_UP_TIMESTAMP**, **F1_UP_POS** - When and where F1_UP last fired
- **F2_UP_TIMESTAMP**, **F2_UP_POS** - When and where F2_UP last fired
- **F3_UP_TIMESTAMP**, **F3_UP_POS** - When and where F3_UP last fired

All positions are in screen-space pixels (zoom-independent).

**Calculated functions:**
- **isOnlyOneStrokeHighlighted()** - Returns true if `highlightedStrokes.size === 1`. Derived from highlightedStrokes set.
- **singleTapHappenedRecently()** - Returns true if singleTapHappenedTimestamp != 0 AND (now - singleTapHappenedTimestamp) < doubleTapTimeout.
- **singleTapJustHappened()** - Returns true if singleTapHappenedTimestamp == now. Used to detect if a single tap was set in this same state machine pass.
- **doubleTapJustHappened()** - Returns true if doubleTapHappenedTimestamp == now. Used to detect if a double tap was set in this same state machine pass.
- **tapAndAHalfHappened()** - Returns true if tapAndAHalfHappenedTimestamp != 0.
- **tapAndAHalfHappenedRecently()** - Returns true if tapAndAHalfHappenedTimestamp != 0 AND (now - tapAndAHalfHappenedTimestamp) < singleTapTimeout. Used for double-tap detection (ensures the second tap is quick).
- **FirstFingerWasTheLastFingerToGoDown()** - Returns true if F1_DOWN was the most recent finger-down event (no F2_DOWN or F3_DOWN after it).
- **FirstFingerWentDownRecently()** - Returns true if (now - F1_DOWN_TIMESTAMP) < singleTapTimeout. Ensures the tap was quick.
- **arePositionsClose(pos1, pos2)** - Returns true if pos1 and pos2 are within TAP_PROXIMITY_THRESHOLD_MM (5mm) of each other. If either position is null, returns true (falls back to temporal-only check).
- **isF1DownCloseToLastF1Up(pos)** - Returns arePositionsClose(pos, F1_UP_POS). Used for tap-and-a-half detection.
- **isF1UpCloseToF1Down(pos)** - Returns arePositionsClose(pos, F1_DOWN_POS). Used for single-tap detection.

**Set by events** (reset on any finger down via FINGER_DOWN_COMMON):
1. **cursorMovedFarHappened** - Set when CURSOR_MOVED_FAR event fires
2. **longStrokeDrawnHappened** - Set when LONG_STROKE_DRAWN event fires

## Actions

When a state transition occurs, the state machine returns a list of **actions** to execute:

| Action | Description |
|--------|-------------|
| `MOVE_CURSOR` | Move the drawing cursor |
| `CREATE_STROKE` | Create a new stroke, or continue an existing selected stroke if cursor is at its last point |
| `SAVE_STROKE` | Save current stroke to history, select it, and highlight it |
| `ABANDON_STROKE` | Discard current stroke |
| `SELECT_CLOSEST_STROKE` | Select closest stroke to cursor, snap cursor to that point, update pickers |
| `DEHIGHLIGHT_ALL` | Clear all highlighting and anchor state |
| `DEANCHOR_CURSOR` | Clear cursor anchor only (selectedStrokePointIdx, cursorAnchorPos) - keeps stroke highlighted |
| `START_SELECTION_RECTANGLE` | Start selection rectangle mode |
| `UPDATE_SELECTION_RECTANGLE` | Update selection rectangle during drag (also updates real-time highlighting) |
| `APPLY_SELECTION_RECTANGLE` | Complete selection rectangle and keep strokes highlighted |
| `CANCEL_SELECTION_RECTANGLE` | Cancel selection rectangle and clear highlighting |
| `SINGLE_TAP` | Handle single tap gesture (may clear highlighting, interact with picker/menu) |
| `INIT_TRANSFORM` | Initialize 3-finger transform |
| `APPLY_TRANSFORM` | Apply transform (continuous) |
| `PROCESS_DELETE` | Execute delete operation |
| `PROCESS_CLEAR` | Execute clear operation |
| `ABORT_TOO_MANY_FINGERS` | Abort gesture (too many fingers) |
| `SAVE_DRAG_START_CURSOR` | Save cursor position when starting drag (for snap-back after transform) |
| `RESTORE_DRAG_START_CURSOR` | Restore cursor after canvas transform (2-finger zoom) |
| `SNAP_CURSOR_TO_SELECTED_STROKE` | Snap cursor back to `cursorAnchorPos` when lifting finger with stroke selected |
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
| F1_DOWN | If singleTapHappenedRecently() AND isF1DownCloseToLastF1Up() -> set tapAndAHalfHappenedTimestamp = now. |
| F1_UP | If quick single-finger tap (i.e. !cursorMovedFarHappened && FirstFingerWasTheLastFingerToGoDown() && FirstFingerWentDownRecently() && isF1UpCloseToF1Down()): if tapAndAHalfHappenedRecently() -> set doubleTapHappenedTimestamp = now, else -> set singleTapHappenedTimestamp = now |
| CURSOR_MOVED_FAR | Set cursorMovedFarHappened = true |
| DELETE | Go to Idle. do [CANCEL_SELECTION_RECTANGLE, PROCESS_DELETE] |
| CLEAR | Go to Idle. do [CANCEL_SELECTION_RECTANGLE, PROCESS_CLEAR, DEHIGHLIGHT_ALL] |

### FROM Any State - AFTER ALL

These updates happen regardless of current state, after state-specific transitions are processed.

**Rule of thumb:** Resets and zero assignments (setting to `0`) go here.

| Event | Transitions and/or Actions |
|-------|---------------------------|
| FINGER_DOWN_COMMON | Set singleTapHappenedTimestamp = 0, doubleTapHappenedTimestamp = 0. Reset cursorMovedFarHappened, longStrokeDrawnHappened. |
| FINGER_UP_COMMON | Set tapAndAHalfHappenedTimestamp = 0. |

### Postprocessing

After all tables have been processed, record the timestamp and position for the current event. For every finger event X, we maintain X_TIMESTAMP (set to current time) and X_POS (set to screen-space position). For example, F1_DOWN sets F1_DOWN_TIMESTAMP = now and F1_DOWN_POS = position, F1_UP sets F1_UP_TIMESTAMP = now and F1_UP_POS = position, etc.

### FROM Idle State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | If tapAndAHalfHappened() -> Go to SelectionRectangle, do [START_SELECTION_RECTANGLE, DEHIGHLIGHT_ALL]. Else -> Go to MovingCursor, do [SAVE_DRAG_START_CURSOR] |
| F2_DOWN | ----- |
| F3_DOWN | ----- |
| FINGER_UP_COMMON | ----- |
| PINCH_DETECTED | ----- |

### FROM MovingCursor State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F2_DOWN | Go to Drawing. do [CREATE_STROKE] |
| F3_DOWN | Go to Idle. do [ABORT_TOO_MANY_FINGERS, DEHIGHLIGHT_ALL] |
| F1_UP | If singleTapJustHappened() -> do [SINGLE_TAP]. Else if isOnlyOneStrokeHighlighted() -> do [SNAP_CURSOR_TO_SELECTED_STROKE]. Finally: Go to Idle. |
| CURSOR_MOVED_FAR | If isOnlyOneStrokeHighlighted() -> do [DEANCHOR_CURSOR] (clears anchor but keeps stroke highlighted) |
| PINCH_DETECTED | ----- |

### FROM Drawing State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | ----- |
| PINCH_DETECTED | Go to Transform. do [ABANDON_STROKE, INIT_TRANSFORM] |
| F3_DOWN | Go to Transform. If longStrokeDrawnHappened -> do [SAVE_STROKE, INIT_TRANSFORM], else do [ABANDON_STROKE, INIT_TRANSFORM] |
| F2_UP | Go to MovingCursor. do [SAVE_STROKE] |
| LONG_STROKE_DRAWN | Set longStrokeDrawnHappened = true |

**Note on PINCH_DETECTED:** Triggered when two-finger distance changes by >4mm (screen-space). The stroke is abandoned (not saved) and transform begins. However, if the stroke has already reached the length threshold (LONG_STROKE_DRAWN fired), the gesture is locked as drawing and PINCH_DETECTED won't fire.

**Note on Drawing Lock and Highlighting:** When in Drawing state, one of two mutually exclusive events will occur first:
1. **PINCH_DETECTED fires first** - Gesture becomes zoom/pan. Stroke is abandoned, highlighting is preserved (user can continue to transform highlighted strokes).
2. **LONG_STROKE_DRAWN fires first** - Gesture is locked as drawing. Highlighting is cleared (user is committed to drawing a new stroke). This happens in `cursorMovement.ts` when `lockGestureAsDrawing()` is called.

### FROM Transform State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | do [INIT_TRANSFORM] |
| F3_DOWN | do [INIT_TRANSFORM] |
| F1_UP | Go to Idle. do [RESTORE_DRAG_START_CURSOR] |
| F2_UP | do [INIT_TRANSFORM] |
| F3_UP | do [INIT_TRANSFORM] |
| PINCH_DETECTED | ----- |

### FROM SelectionRectangle State

| Event | Transitions and/or Actions |
|-------|---------------------------|
| F1_DOWN | ----- |
| F2_DOWN | Go to Idle. do [CANCEL_SELECTION_RECTANGLE] |
| F3_DOWN | Go to Idle. do [CANCEL_SELECTION_RECTANGLE] |
| FINGER_UP_COMMON | If doubleTapJustHappened() -> Go to Idle. do [CANCEL_SELECTION_RECTANGLE, SELECT_CLOSEST_STROKE]. Else -> Go to Idle. do [APPLY_SELECTION_RECTANGLE] |
| PINCH_DETECTED | ----- |

**Note:** SelectionRectangle state always has isOnlyOneStrokeHighlighted() = false.

**Note:** While in SelectionRectangle state, the rectangle updates continuously on cursor movement (handled outside state machine transitions).

## Implementation Notes

### Event Flags Usage

1. **cursorMovedFarHappened**: Set when the cursor moves >3mm from `cursorAnchorPos` (the anchor point on the selected stroke). Used for:
   - Single tap detection (deselection requires no cursor movement)
   - Cursor drag restoration when finger is lifted without significant movement

2. **longStrokeDrawnHappened**: Set when the stroke being drawn exceeds the path length threshold (~4mm). Used for:
   - Stroke protection: if F3_DOWN occurs while drawing, save the stroke only if this flag is true
   - Gesture disambiguation: locks the gesture as drawing, preventing PINCH_DETECTED from firing

### Selected Stroke Mode

**isOnlyOneStrokeHighlighted()** returns true when `highlightedStrokes.size === 1` (exactly one stroke is highlighted).

The "selected stroke" is derived from `highlightedStrokes`:
- When exactly 1 stroke is highlighted → that stroke is "selected" (`getSelectedStrokeIdx()` returns its index)
- When 0 or 2+ strokes are highlighted → no stroke is "selected" (`getSelectedStrokeIdx()` returns null)

**Entry Conditions** (actions that result in exactly 1 highlighted stroke):
- [SAVE_STROKE] - Automatically when saving a stroke (clears highlights and highlights the new/merged stroke)
- [SELECT_CLOSEST_STROKE] - On double-tap, clears highlights and highlights the closest stroke

**Exit Conditions** (actions that clear or change highlighting):
- [DEHIGHLIGHT_ALL] - Clears all highlighting, called on:
  - CLEAR button pressed
  - Too many fingers (F3_DOWN in MovingCursor)
  - Tap-and-a-half (entering SelectionRectangle mode)
- [SINGLE_TAP] - Handles single tap gesture, clears highlighting if cursor is on canvas (not on picker/menu)
- DELETE button pressed (removes highlighted strokes)
- Selection rectangle (can highlight multiple strokes, making `isOnlyOneStrokeHighlighted()` return false)

**De-anchoring** (clears anchor but keeps stroke highlighted):
- [DEANCHOR_CURSOR] - Called when cursor moves >3mm from `cursorAnchorPos` (CURSOR_MOVED_FAR event)
  - Clears `selectedStrokePointIdx` and `cursorAnchorPos`
  - Keeps `highlightedStrokes` intact
  - Cursor shows white (no longer at a specific point on the stroke)
  - No snap-back when finger is lifted
  - Stroke continuation is disabled (can't continue a stroke when not anchored to an endpoint)

**Note on Anchor Distance:** The anchor distance is measured from `cursorAnchorPos`, which is:
- Updated continuously while drawing (tracks the last point added to the stroke)
- Set to the closest point on the stroke when manually selecting via double-tap

**Behavior:**
- 2-finger transform always affects the entire canvas (regardless of selection/highlighting)
- 3-finger transform affects all highlighted strokes (does nothing if none)
- Visual indicator: cursor shows green when exactly one stroke is highlighted, white otherwise

### Stroke Continuation

When starting to draw (F2_DOWN in MovingCursor state), the `CREATE_STROKE` action checks if the cursor is positioned at either endpoint of a selected stroke. If all conditions are met:
1. `continueExistingStroke` flag is true
2. Exactly one stroke is highlighted (`getSelectedStrokeIdx() !== null`)
3. The cursor is at an endpoint of that stroke (`selectedStrokePointIdx == 0` OR `selectedStrokePointIdx == stroke.points.length - 1`)
4. The stroke is not a group (has `points` array, no `strokes` array)

Then a new stroke is created (using the same color/size as the selected stroke) but the selection is kept intact. The actual merge happens later in `SAVE_STROKE`:
- **Append (cursor at last point)**: New stroke's points are appended to the selected stroke
- **Prepend (cursor at first point)**: New stroke's points are reversed and prepended to the selected stroke

This deferred approach ensures that if the gesture is abandoned (e.g., pinch detected, or 3-finger transform initiated), the original selected stroke remains intact in history.

If any condition is not met, a new stroke is created as normal (and the selection is cleared).

**The `continueExistingStroke` flag:**
- Set to `true` when: stroke is selected via double-tap ([SELECT_CLOSEST_STROKE]), cursor snaps back to selected stroke ([SNAP_CURSOR_TO_SELECTED_STROKE]), or transform completes with a selected stroke ([RESTORE_DRAG_START_CURSOR]) - but ONLY if all fingers are lifted (`getFingerCount() === 0`)
- Set to `false` when: [SAVE_STROKE] or [ABANDON_STROKE] is executed (stroke completed or cancelled)
- NOT set by [SAVE_STROKE] when saving - this ensures continuation only works after all fingers are lifted, not when just the drawing finger is lifted while the anchor finger remains down.

### Stroke Protection

When in Drawing state and F3_DOWN event occurs:
- If `longStrokeDrawnHappened` flag is true: stroke is saved before entering Transform
- If `longStrokeDrawnHappened` flag is false: stroke is abandoned (assumed accidental)

### Selection Rectangle Mode

**Entry Condition:**
- Tap-and-a-half gesture: Quick tap (F1_DOWN -> F1_UP where F1_UP is within 5mm of F1_DOWN and within singleTapTimeout), then another F1_DOWN before doubleTapTimeout AND within 5mm of the first F1_UP location

**Behavior:**
- Dragging creates a semi-transparent blue selection rectangle
- **Real-time highlighting**: As the rectangle is dragged, strokes that intersect the rectangle are highlighted in real-time
  - Highlighted strokes are drawn with a light grey outline at 2x thickness, then the normal stroke is drawn on top
  - The highlighting updates continuously as the rectangle changes
- On FINGER_UP_COMMON, the selection rectangle disappears but strokes **remain highlighted**
  - Highlighted strokes stay highlighted until explicitly cleared
  - Changing color or stroke width applies to **all highlighted strokes**
  - Any stroke with at least one point inside the rectangle is affected

**Clearing Highlighting:**
- Single tap (quick tap without timeout or movement) clears all highlighted strokes
  - Since double-tap and tap-and-a-half both start with a single tap, they automatically clear highlighting
- CLEAR button clears highlighting

**Exit Conditions:**
- FINGER_UP_COMMON (completes selection, keeps strokes highlighted)
- F2_DOWN or F3_DOWN (cancels selection rectangle and clears highlighting)
- DELETE or CLEAR buttons (cancels selection rectangle and clears highlighting)

## Code Structure

### Files

1. **[src/stateMachine.ts](src/stateMachine.ts)** - State machine core
   - `State` enum - All possible states
   - `Event` enum - All possible events
   - `Action` enum - All possible actions
   - `isOnlyOneStrokeHighlighted()` function - checks if a stroke is selected
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
import { showDebug } from './state';

const stateMachine = new StateMachine();

// Process an event
const result = stateMachine.processEvent(Event.F1_DOWN);
showDebug(`${result.newState}`);  // State.MovingCursor
showDebug(`${result.actions}`);   // []

// Check current state
showDebug(`${stateMachine.getState()}`);  // State.MovingCursor

// Check if a stroke is selected (returns highlightedStrokes.size === 1)
showDebug(`${isOnlyOneStrokeHighlighted()}`);  // false
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

To verify state machine behavior, use `showDebug()` from `state.ts` (see CLAUDE.md for why console.log is not used):

1. **Check current state:**
   ```typescript
   import { showDebug } from './state';
   showDebug(`State: ${stateMachine.getState()}`);
   ```

2. **Check if stroke is selected:**
   ```typescript
   showDebug(`Selected: ${isOnlyOneStrokeHighlighted()}`);  // true if highlightedStrokes.size === 1
   ```

3. **Check flags:**
   ```typescript
   showDebug(`Flags: ${JSON.stringify(stateMachine.getFlags())}`);
   ```

4. **Trace transitions:**
   ```typescript
   eventHandler.setEventCallback((event) => {
     const result = stateMachine.processEvent(event);
     showDebug(`${event} → ${result.newState} [${result.actions}]`);
   });
   ```
