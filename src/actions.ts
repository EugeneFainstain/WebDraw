import { Action } from './stateMachine';
import { state, Stroke } from './state';
import {
    initThreeFingerTransform,
} from './transform';
import {
    updateUI,
    processDelete,
    processClear,
} from './strokeOperations';
import {
    isCursorInMenuRegion,
    simulateTapAtCursor,
} from './cursorMovement';
import {
    snapToGrid,
    updateHighlightedStrokes,
} from './rendering';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionDependencies {
    getPickerColor: () => string;
    getPickerSize: () => number;
    findClosestStrokeAndPoint: (searchPos?: { x: number; y: number }) => { strokeIdx: number; pointIdx: number; point: { x: number; y: number } } | null;
    updatePickersForSelectedStroke: () => void;
}

// ============================================================================
// MODULE STATE
// ============================================================================

let deps: ActionDependencies;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initActions(dependencies: ActionDependencies): void {
    deps = dependencies;
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

export function handleActions(actions: Action[]): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (state.cursorPos) {
                    const startPoint = state.isGridMode ? snapToGrid(state.cursorPos) : state.cursorPos;
                    state.currentStroke = {
                        color: deps.getPickerColor(),
                        size: deps.getPickerSize(),
                        points: [{ ...startPoint }]
                    };
                    // In grid mode, initialize lastGridPosition to the start point
                    // but don't snap cursorPos - let it move freely
                    if (state.isGridMode) {
                        state.lastGridPosition = { ...startPoint };
                    } else {
                        state.lastGridPosition = null;
                    }
                }
                break;

            case Action.SAVE_STROKE:
                if (state.currentStroke && state.currentStroke.points!.length > 0) {
                    state.strokeHistory.push(state.currentStroke);
                    updateUI();
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                // Clear dragStartCursorPos - we completed a new stroke, so zoom restoration
                // should not snap back to the old stroke's position
                state.dragStartCursorPos = null;
                break;

            case Action.ABANDON_STROKE:
                // Move cursor back to where the stroke started
                if (state.currentStroke && state.currentStroke.points && state.currentStroke.points.length > 0) {
                    state.cursorPos = { ...state.currentStroke.points[0] };
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.SELECT_STROKE:
                // SELECT_STROKE: Automatically select the stroke that was just drawn
                // Triggered after: Finishing a drawing (lifting second finger)
                // Behavior: Selects the last stroke in history (the one just completed)
                //           Cursor stays at its current position
                // Note: selectedStrokeCursorPos is already set during drawing via addPointToStroke()
                // Set selected stroke to the last stroke in history
                if (state.strokeHistory.length > 0) {
                    state.selectedStrokeIdx = state.strokeHistory.length - 1;
                    const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                    // Set point index to the last point of the stroke
                    if (selectedStroke.points!.length > 0) {
                        state.selectedStrokePointIdx = selectedStroke.points!.length - 1;
                    }
                }
                // Clear transformation undo state when selecting new stroke
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                updateUI();
                break;

            case Action.SELECT_CLOSEST_STROKE:
                // SELECT_CLOSEST_STROKE: Manually select stroke closest to cursor
                // Triggered by: Single tap (quick tap with no timeout or movement)
                // Behavior: Finds closest stroke to current cursor position
                //           Cursor jumps to the closest point on that stroke
                //           Marks as manual selection (Del button will delete it)
                //           Updates color/size pickers to match the selected stroke
                // Note: This is different from double-tap, which searches from tap location
                const closestResult = deps.findClosestStrokeAndPoint();
                if (closestResult) {
                    // Move cursor to the closest point
                    state.cursorPos = closestResult.point;
                    // Select the stroke and store the point index
                    state.selectedStrokeIdx = closestResult.strokeIdx;
                    state.selectedStrokePointIdx = closestResult.pointIdx;
                    // Set anchor for deselection distance check
                    state.selectedStrokeCursorPos = { ...closestResult.point };
                    // Clear transformation undo state when manually selecting a stroke
                    state.transformSnapshot = null;
                    state.hasUndoableTransform = false;
                    // Update color and size pickers to match selected stroke
                    deps.updatePickersForSelectedStroke();
                }
                updateUI();
                break;

            case Action.DESELECT_STROKE:
                state.selectedStrokeCursorPos = null;
                state.selectedStrokeIdx = null;
                state.selectedStrokePointIdx = null;
                // If we're currently drawing, also clear highlighting
                // (this happens when FINGER_MOVED_FAR during drawing)
                if (state.currentStroke !== null) {
                    state.highlightedStrokes.clear();
                }
                // Clear transformation undo state on deselection
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // NOTE: Don't clearDebug() here - debug messages should persist
                updateUI();
                break;

            case Action.START_SELECTION_RECTANGLE:
                // Start selection rectangle at current cursor position
                if (state.cursorPos) {
                    state.selectionRectStart = { ...state.cursorPos };
                    state.selectionRectEnd = { ...state.cursorPos };
                    // Initialize position tracking for cursor movement
                    const positions = state.eventHandler.getFingerPositions();
                    state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
                    state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
                    // Update highlighted strokes (initially empty since single tap cleared them)
                    updateHighlightedStrokes();
                }
                break;

            case Action.UPDATE_SELECTION_RECTANGLE:
                // Update selection rectangle end point to current cursor position
                if (state.cursorPos && state.selectionRectStart) {
                    state.selectionRectEnd = { ...state.cursorPos };
                    // Update highlighted strokes in real-time
                    updateHighlightedStrokes();
                }
                break;

            case Action.APPLY_SELECTION_RECTANGLE:
                // Complete selection rectangle - keep strokes highlighted, don't apply colors yet
                state.selectionRectStart = null;
                state.selectionRectEnd = null;
                // Keep highlighted strokes (don't clear them)
                updateUI();
                break;

            case Action.CANCEL_SELECTION_RECTANGLE:
                // Cancel selection rectangle
                state.selectionRectStart = null;
                state.selectionRectEnd = null;
                // Clear highlighted strokes
                state.highlightedStrokes.clear();
                updateUI();
                break;

            case Action.CLEAR_HIGHLIGHTING:
                // Check if cursor is in the menu region
                if (isCursorInMenuRegion()) {
                    // Cursor is in menu region - try to tap a menu element
                    // Don't clear highlighting regardless (menu taps shouldn't affect canvas)
                    simulateTapAtCursor();
                } else {
                    // Cursor is in canvas region - clear highlighting as normal
                    state.highlightedStrokes.clear();
                    updateUI();
                }
                break;

            case Action.INIT_TRANSFORM:
                initThreeFingerTransform();
                break;

            case Action.PROCESS_DELETE:
                processDelete();
                break;

            case Action.PROCESS_CLEAR:
                processClear();
                break;

            case Action.ABORT_TOO_MANY_FINGERS:
                // Reset to idle
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.SAVE_DRAG_START_CURSOR:
                // Save cursor position when starting drag (for snap-back after transform)
                if (state.cursorPos) {
                    state.dragStartCursorPos = { ...state.cursorPos };
                }
                break;

            case Action.RESTORE_DRAG_START_CURSOR:
                // Restore cursor after canvas transform (2-finger zoom)
                // Only snap back for 2-finger canvas transforms (no strokeSnapshotsMap)
                // 3-finger stroke transforms have strokeSnapshotsMap and cursor is already correctly positioned
                if (state.dragStartCursorPos && !state.transformStart?.strokeSnapshotsMap) {
                    state.cursorPos = { ...state.dragStartCursorPos };
                }
                state.dragStartCursorPos = null;
                break;

            case Action.DO_NOTHING:
                // Explicitly do nothing
                break;
        }
    }
}
