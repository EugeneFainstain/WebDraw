import { Action } from './stateMachine';
import { state, Stroke } from './state';
import {
    initThreeFingerTransform,
} from './transform';
import {
    updateUI,
    processDelete,
    processClear,
    forEachLeafStroke,
} from './strokeOperations';
import {
    isCursorInMenuRegion,
    simulateTapAtCursor,
} from './cursorMovement';
import {
    snapToGrid,
    updateHighlightedStrokes,
} from './rendering';
import { pushUndoSnapshot } from './undoSystem';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionDependencies {
    getPickerColor: () => string;
    getPickerSize: () => number;
    findClosestStrokeAndPoint: (searchPos?: { x: number; y: number }) => { strokeIdx: number; pointIdx: number; point: { x: number; y: number } } | null;
    updatePickersForSelectedStroke: () => void;
    isAnyPickerOpen: () => boolean;
    closePickers: () => void;
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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clear all highlighting and anchor state.
 * Called by DEHIGHLIGHT_ALL action and SINGLE_TAP action (when cursor is on canvas).
 */
function doDehighlightAll(): void {
    state.selectedStrokeCursorPos = null;
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.highlightedStrokes.clear();
    // Clear transformation undo state
    state.transformSnapshot = null;
    state.hasUndoableTransform = false;
    updateUI();
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

export function handleActions(actions: Action[]): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (state.cursorPos) {
                    // Check if we MIGHT continue an existing selected stroke
                    // Don't actually continue yet - just mark it for potential continuation
                    // The actual merge happens in SAVE_STROKE if conditions are still met
                    // Continuation can happen at either end: first point (prepend) or last point (append)
                    let mightContinue = false;
                    if (state.continueExistingStroke &&
                        state.selectedStrokeIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        state.selectedStrokeIdx < state.strokeHistory.length) {
                        const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                        // Only continue non-group strokes
                        if (selectedStroke.points && !selectedStroke.strokes) {
                            const lastPointIdx = selectedStroke.points.length - 1;
                            // Can continue from either first point (prepend) or last point (append)
                            if (state.selectedStrokePointIdx === 0 || state.selectedStrokePointIdx === lastPointIdx) {
                                mightContinue = true;
                            }
                        }
                    }

                    if (mightContinue) {
                        // Potential continuation: create new stroke but keep selection
                        // The merge will happen in SAVE_STROKE (continueExistingStroke stays true)
                        const selectedStroke = state.strokeHistory[state.selectedStrokeIdx!];
                        const startPoint = state.isGridMode ? snapToGrid(state.cursorPos) : state.cursorPos;
                        state.currentStroke = {
                            color: selectedStroke.color,
                            size: selectedStroke.size,
                            points: [{ ...startPoint }]
                        };
                        // Keep selection intact - it will be used in SAVE_STROKE to merge
                        // In grid mode, initialize lastGridPosition
                        if (state.isGridMode) {
                            state.lastGridPosition = { ...startPoint };
                        } else {
                            state.lastGridPosition = null;
                        }
                    } else {
                        // Create a new stroke as normal
                        // DON'T deselect yet - keep selection intact so 3-finger transform can still work
                        // Selection will be cleared in SAVE_STROKE if we commit to drawing a new stroke

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
                }
                break;

            case Action.SAVE_STROKE:
                if (state.currentStroke && state.currentStroke.points!.length > 0) {
                    // Check if we should merge with a selected stroke (deferred continuation)
                    // Only merge if continueExistingStroke was true when stroke started
                    if (state.continueExistingStroke &&
                        state.selectedStrokeIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        state.selectedStrokeIdx < state.strokeHistory.length) {
                        const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                        // Only merge with non-group strokes that have points
                        if (selectedStroke.points && !selectedStroke.strokes) {
                            const newPoints = state.currentStroke.points!;
                            const lastPointIdx = selectedStroke.points.length - 1;

                            if (state.selectedStrokePointIdx === 0) {
                                // PREPEND: cursor was at first point, prepend new points (reversed)
                                // New stroke goes: [start] -> [end], we want: [end] -> [start] -> [existing...]
                                // So reverse the new points and prepend them
                                const firstSelectedPoint = selectedStroke.points[0];
                                const lastNewPoint = newPoints[newPoints.length - 1];
                                // Skip the last new point if it's the same as the first selected point
                                const endIdx = (firstSelectedPoint.x === lastNewPoint.x &&
                                              firstSelectedPoint.y === lastNewPoint.y) ? newPoints.length - 1 : newPoints.length;
                                // Prepend new points in reverse order
                                const pointsToPrepend: { x: number; y: number }[] = [];
                                for (let i = endIdx - 1; i >= 0; i--) {
                                    pointsToPrepend.push({ ...newPoints[i] });
                                }
                                selectedStroke.points.unshift(...pointsToPrepend);
                                // Update selectedStrokePointIdx to still point to first point (now at index 0)
                                state.selectedStrokePointIdx = 0;
                                // Update anchor position to the new first point
                                state.selectedStrokeCursorPos = { ...selectedStroke.points[0] };
                            } else if (state.selectedStrokePointIdx === lastPointIdx) {
                                // APPEND: cursor was at last point, append new points
                                const lastSelectedPoint = selectedStroke.points[lastPointIdx];
                                const firstNewPoint = newPoints[0];
                                // Skip the first new point if it's the same as the last selected point
                                const startIdx = (lastSelectedPoint.x === firstNewPoint.x &&
                                                lastSelectedPoint.y === firstNewPoint.y) ? 1 : 0;
                                for (let i = startIdx; i < newPoints.length; i++) {
                                    selectedStroke.points.push({ ...newPoints[i] });
                                }
                                // Update selectedStrokePointIdx to the new last point
                                state.selectedStrokePointIdx = selectedStroke.points.length - 1;
                                // Update anchor position to the new last point
                                state.selectedStrokeCursorPos = { ...selectedStroke.points[state.selectedStrokePointIdx] };
                            } else {
                                // Not at an endpoint, can't merge - save as new stroke and clear selection
                                state.strokeHistory.push(state.currentStroke);
                                state.selectedStrokeIdx = null;
                                state.selectedStrokePointIdx = null;
                                state.selectedStrokeCursorPos = null;
                                state.highlightedStrokes.clear();
                            }
                            // Clear any fitted data since the stroke changed
                            selectedStroke.fittedPoints = undefined;
                            selectedStroke.originalPoints = undefined;
                            selectedStroke.fitType = undefined;
                            selectedStroke.showingFitted = undefined;
                            selectedStroke.fittedWithSize = undefined;
                        } else {
                            // Can't merge (it's a group), just save as new stroke and clear selection
                            state.strokeHistory.push(state.currentStroke);
                            state.selectedStrokeIdx = null;
                            state.selectedStrokePointIdx = null;
                            state.selectedStrokeCursorPos = null;
                            state.highlightedStrokes.clear();
                        }
                    } else {
                        // No selection, just save as new stroke
                        state.strokeHistory.push(state.currentStroke);
                    }
                    updateUI();
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                state.continueExistingStroke = false;
                // Clear dragStartCursorPos - we completed a new stroke, so zoom restoration
                // should not snap back to the old stroke's position
                state.dragStartCursorPos = null;
                break;

            case Action.ABANDON_STROKE:
                // Move cursor back to where the stroke started
                // BUT: if there's a selected stroke, snap to its anchor instead
                // (this handles the case where a potential continuation was abandoned)
                if (state.selectedStrokeCursorPos) {
                    state.cursorPos = { ...state.selectedStrokeCursorPos };
                } else if (state.currentStroke && state.currentStroke.points && state.currentStroke.points.length > 0) {
                    state.cursorPos = { ...state.currentStroke.points[0] };
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                state.continueExistingStroke = false;
                break;

            case Action.FINISH_STROKE:
                // FINISH_STROKE: Automatically select the stroke that was just drawn
                // Triggered after: Finishing a drawing (lifting second finger)
                // Behavior: Selects the last stroke in history (the one just completed)
                //           Cursor stays at its current position
                // Note: selectedStrokeCursorPos is already set during drawing via addPointToStroke()
                // Note: continueExistingStroke is NOT set here - it will be set when
                //       all fingers are lifted (via SNAP_CURSOR_TO_SELECTED_STROKE on F1_UP)
                // Set selected stroke to the last stroke in history
                if (state.strokeHistory.length > 0) {
                    state.selectedStrokeIdx = state.strokeHistory.length - 1;
                    const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                    // Set point index to the last point of the stroke
                    if (selectedStroke.points!.length > 0) {
                        state.selectedStrokePointIdx = selectedStroke.points!.length - 1;
                    }
                    // Clear previous highlighting and highlight the new stroke
                    state.highlightedStrokes.clear();
                    state.highlightedStrokes.add(state.selectedStrokeIdx);
                }
                // Clear transformation undo state when selecting new stroke
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // Snapshot AFTER stroke is saved and selected (coherent state)
                // This is the key undo point - the stroke now exists in history
                pushUndoSnapshot();
                updateUI();
                break;

            case Action.SELECT_CLOSEST_STROKE:
                // Note: No snapshot here - selection is a UI state change, not a document change
                // Users don't expect "undo" to deselect a stroke they just tapped on
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
                    // Cursor is ready to continue this stroke (only if all fingers lifted)
                    if (state.eventHandler.getFingerCount() === 0) {
                        state.continueExistingStroke = true;
                    }
                    // Also highlight the selected stroke
                    state.highlightedStrokes.clear();
                    state.highlightedStrokes.add(closestResult.strokeIdx);
                }
                updateUI();
                break;

            case Action.DEHIGHLIGHT_ALL:
                // Used when: clearing canvas, aborting gesture, starting new selection rectangle
                doDehighlightAll();
                break;

            case Action.DEANCHOR_CURSOR:
                // De-anchor cursor - clears anchor point but keeps stroke highlighted
                // Used when: cursor moves far from anchor (>3mm)
                // Effect: No snap-back, but stroke stays highlighted/selected
                // Cursor will show white (no endpoint indicator) since we're no longer at a point
                state.selectedStrokeCursorPos = null;
                state.selectedStrokePointIdx = null;
                // Keep selectedStrokeIdx and highlightedStrokes intact!
                // Don't clear transformation undo state - stroke is still selected
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
                // Note: No snapshot here - selection is a UI state change, not a document change
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

            case Action.SINGLE_TAP:
                // Handle single tap gesture - contextual behavior based on cursor location
                // If a picker is open, handle it first and don't process further
                if (deps.isAnyPickerOpen()) {
                    if (isCursorInMenuRegion()) {
                        // Cursor is over one of the pickers - forward the tap to it
                        simulateTapAtCursor();
                    } else {
                        // Cursor is outside - close the pickers
                        deps.closePickers();
                    }
                    break;
                }

                // No picker open - normal tap processing
                if (isCursorInMenuRegion()) {
                    // Cursor is in menu region - try to tap a menu element
                    // Don't clear highlighting regardless (menu taps shouldn't affect canvas)
                    simulateTapAtCursor();
                } else {
                    // Cursor is in canvas region - dehighlight all
                    doDehighlightAll();
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
                // This fires when Transform→Idle transition happens
                // Restore cursor after canvas transform (2-finger zoom)
                // Only snap back for 2-finger canvas transforms (no strokeSnapshotsMap)
                // 3-finger stroke transforms have strokeSnapshotsMap and cursor is already correctly positioned
                if (state.dragStartCursorPos && !state.transformStart?.strokeSnapshotsMap) {
                    // If there's a selected stroke with a selected point, snap to that point
                    // (the stroke coordinates haven't changed, only the view transform)
                    if (state.selectedStrokeIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        state.selectedStrokeIdx < state.strokeHistory.length) {
                        const stroke = state.strokeHistory[state.selectedStrokeIdx];
                        const allPoints: { x: number; y: number }[] = [];
                        forEachLeafStroke(stroke, (leafStroke: Stroke) => {
                            allPoints.push(...leafStroke.points!);
                        });
                        if (state.selectedStrokePointIdx < allPoints.length) {
                            const snapPoint = allPoints[state.selectedStrokePointIdx];
                            state.cursorPos = { ...snapPoint };
                            state.selectedStrokeCursorPos = { ...snapPoint };
                        } else {
                            state.cursorPos = { ...state.dragStartCursorPos };
                        }
                    } else {
                        state.cursorPos = { ...state.dragStartCursorPos };
                    }
                }
                state.dragStartCursorPos = null;
                // After any transform, if there's a selected stroke and all fingers lifted, cursor is ready to continue
                if (state.selectedStrokeIdx !== null && state.eventHandler.getFingerCount() === 0) {
                    state.continueExistingStroke = true;
                }
                // Snapshot AFTER transform is complete (coherent state)
                pushUndoSnapshot();
                break;

            case Action.SNAP_CURSOR_TO_SELECTED_STROKE:
                // Snap cursor back to the anchor point on the selected stroke
                // This happens when lifting finger after small cursor movement (< 3mm)
                // Also happens after drawing a stroke (F1_UP after FINISH_STROKE)
                // Note: No snapshot here - the stroke was already snapshotted in FINISH_STROKE
                // Cursor snap is just a UI convenience, not a document change
                if (state.selectedStrokeCursorPos) {
                    state.cursorPos = { ...state.selectedStrokeCursorPos };
                    // Cursor snapped back - ready to continue stroke (only if all fingers lifted)
                    if (state.eventHandler.getFingerCount() === 0) {
                        state.continueExistingStroke = true;
                    }
                }
                break;

            case Action.DO_NOTHING:
                // Explicitly do nothing
                break;
        }
    }
}
