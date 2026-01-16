import { Action, TouchEventData } from './stateMachine';
import { state, Stroke, getSelectedStrokeIdx, clearSelectionState, clearAnchorState, resetTransformUndoState, clearSelectionRectangle, clearCurrentStroke } from './state';
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
import {
    hideRadialMenu,
    isRadialMenuVisible,
    wasMenuVisibleOnFingerDown,
} from './radialMenu';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionDependencies {
    getPickerColor: () => string;
    getPickerSize: () => number;
    findClosestStrokeAndPoint: (searchPos?: { x: number; y: number }) => { strokeIdx: number; pointIdx: number; point: { x: number; y: number } } | null;
    updatePickersBasedOnSelectedStroke: () => void;
    isAnyPickerOpen: () => boolean;
    closePickers: () => void;
    screenToCanvas: (screenPos: { x: number; y: number }) => { x: number; y: number };
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
 * Called by DEHIGHLIGHT_ALL action and HANDLE_SINGLE_TAP_ACTION action (when cursor is on canvas).
 */
function doDehighlightAll(): void {
    clearSelectionState();
    updateUI();
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

export function handleActions(actions: Action[], touchEventData?: TouchEventData): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (state.cursorPos) {
                    // Check if we MIGHT continue an existing selected stroke
                    // Don't actually continue yet - just mark it for potential continuation
                    // The actual merge happens in SAVE_STROKE if conditions are still met
                    // Continuation can happen at either end: first point (prepend) or last point (append)
                    let mightContinue = false;
                    const selectedIdx = getSelectedStrokeIdx();
                    if (state.continueExistingStroke &&
                        selectedIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        selectedIdx < state.strokeHistory.length) {
                        const selectedStroke = state.strokeHistory[selectedIdx];
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
                        const selectedStroke = state.strokeHistory[selectedIdx!];
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

            case Action.SAVE_STROKE: {
                // SAVE_STROKE: Save current stroke to history and select/highlight it
                // Handles both new strokes and stroke continuation (merging)
                // Note: cursorAnchorPos is already set during drawing via addPointToStroke()

                // In grid mode, add the deferred point (and interpolation) before saving
                if (state.isGridMode && state.gridDeferredPoint && state.currentStroke && state.lastGridPosition) {
                    const gridPoint = state.gridDeferredPoint;
                    // Add 9 interpolated points between last grid position and new grid point
                    const numInterpolated = 9;
                    for (let i = 1; i <= numInterpolated; i++) {
                        const t = i / (numInterpolated + 1);
                        const interpPoint = {
                            x: state.lastGridPosition.x + t * (gridPoint.x - state.lastGridPosition.x),
                            y: state.lastGridPosition.y + t * (gridPoint.y - state.lastGridPosition.y)
                        };
                        state.currentStroke.points!.push(interpPoint);
                    }
                    // Add the actual grid point
                    state.currentStroke.points!.push(gridPoint);
                    state.lastGridPosition = gridPoint;
                    // Update anchor for deselection distance check
                    state.cursorAnchorPos = { ...gridPoint };
                    // Clear the deferred point
                    state.gridDeferredPoint = null;
                }

                if (state.currentStroke && state.currentStroke.points!.length > 0) {
                    let mergedSuccessfully = false;
                    const selectedIdx = getSelectedStrokeIdx();

                    // Check if we should merge with a selected stroke (deferred continuation)
                    // Only merge if continueExistingStroke was true when stroke started
                    if (state.continueExistingStroke &&
                        selectedIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        selectedIdx < state.strokeHistory.length) {
                        const selectedStroke = state.strokeHistory[selectedIdx];
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
                                state.cursorAnchorPos = { ...selectedStroke.points[0] };
                                mergedSuccessfully = true;
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
                                state.cursorAnchorPos = { ...selectedStroke.points[state.selectedStrokePointIdx] };
                                mergedSuccessfully = true;
                            }
                            // else: Not at an endpoint, can't merge - fall through to save as new stroke

                            if (mergedSuccessfully) {
                                // Clear any fitted data since the stroke changed
                                selectedStroke.fittedPoints = undefined;
                                selectedStroke.originalPoints = undefined;
                                selectedStroke.fitType = undefined;
                                selectedStroke.showingFitted = undefined;
                                selectedStroke.fittedWithSize = undefined;
                                // Re-highlight the merged stroke (highlighting may have been cleared
                                // when the gesture was locked as drawing)
                                state.highlightedStrokes.clear();
                                state.highlightedStrokes.add(selectedIdx);
                            }
                        }
                        // else: Can't merge (it's a group) - fall through to save as new stroke
                    }

                    if (!mergedSuccessfully) {
                        // Save as new stroke and select/highlight it
                        state.strokeHistory.push(state.currentStroke);
                        const newStrokeIdx = state.strokeHistory.length - 1;
                        const savedStroke = state.strokeHistory[newStrokeIdx];
                        // Set point index to the last point of the stroke
                        if (savedStroke.points!.length > 0) {
                            state.selectedStrokePointIdx = savedStroke.points!.length - 1;
                        }
                        // Clear previous highlighting and highlight the new stroke
                        state.highlightedStrokes.clear();
                        state.highlightedStrokes.add(newStrokeIdx);
                    }

                    // Clear transformation undo state when saving stroke
                    resetTransformUndoState();
                    // Snapshot AFTER stroke is saved and selected (coherent state)
                    // This is the key undo point - the stroke now exists in history
                    pushUndoSnapshot();
                    updateUI();
                }
                clearCurrentStroke();
                state.continueExistingStroke = false;
                // Clear dragStartCursorPos - we completed a new stroke, so zoom restoration
                // should not snap back to the old stroke's position
                state.dragStartCursorPos = null;
                break;
            }

            case Action.ABANDON_STROKE:
                // Move cursor back to where the stroke started
                // BUT: if there's a selected stroke, snap to its anchor instead
                // (this handles the case where a potential continuation was abandoned)
                if (state.cursorAnchorPos) {
                    state.cursorPos = { ...state.cursorAnchorPos };
                } else if (state.currentStroke && state.currentStroke.points && state.currentStroke.points.length > 0) {
                    state.cursorPos = { ...state.currentStroke.points[0] };
                }
                clearCurrentStroke();
                state.continueExistingStroke = false;
                break;

            case Action.SELECT_CLOSEST_STROKE: {
                // Note: No snapshot here - selection is a UI state change, not a document change
                // Users don't expect "undo" to deselect a stroke they just tapped on
                // SELECT_CLOSEST_STROKE: Select stroke closest to double-tap location
                // Triggered by: Double tap
                // Behavior: Finds closest stroke to the double-tap location (not cursor position)
                //           Cursor jumps to the closest point on that stroke
                //           Marks as manual selection (Del button will delete it)
                //           Updates color/size pickers to match the selected stroke
                // Use the double-tap position (F1_UP_POS) converted to canvas coordinates
                let searchPos: { x: number; y: number } | undefined;
                if (touchEventData?.F1_UP_POS) {
                    searchPos = deps.screenToCanvas(touchEventData.F1_UP_POS);
                }
                const closestResult = deps.findClosestStrokeAndPoint(searchPos);
                if (closestResult) {
                    // Move cursor to the closest point
                    state.cursorPos = closestResult.point;
                    // Store the point index for cursor anchoring
                    state.selectedStrokePointIdx = closestResult.pointIdx;
                    // Set anchor for deselection distance check
                    state.cursorAnchorPos = { ...closestResult.point };
                    // Clear transformation undo state when manually selecting a stroke
                    resetTransformUndoState();
                    // Highlight the selected stroke (this makes it the "selected" stroke)
                    state.highlightedStrokes.clear();
                    state.highlightedStrokes.add(closestResult.strokeIdx);
                    // Update color and size pickers to match selected stroke
                    deps.updatePickersBasedOnSelectedStroke();
                    // Cursor is ready to continue this stroke (only if all fingers lifted)
                    if (state.eventHandler.getFingerCount() === 0) {
                        state.continueExistingStroke = true;
                    }
                }
                updateUI();
                break;
            }

            case Action.DEHIGHLIGHT_ALL:
                // Used when: clearing canvas, aborting gesture, starting new selection rectangle
                doDehighlightAll();
                break;

            case Action.DEANCHOR_CURSOR:
                // De-anchor cursor - clears anchor point but keeps stroke highlighted
                // Used when: cursor moves far from anchor (>3mm)
                // Effect: No snap-back, but stroke stays highlighted/selected
                // Cursor will show white (no endpoint indicator) since we're no longer at a point
                clearAnchorState();
                // Keep highlightedStrokes intact!
                // Don't clear transformation undo state - stroke is still selected
                updateUI();
                break;

            case Action.START_SELECTION_RECTANGLE: {
                // Start selection rectangle at tap-and-a-half location (not cursor position)
                // Use F1_DOWN_POS which is where the second tap of tap-and-a-half started
                if (touchEventData?.F1_DOWN_POS) {
                    const startPos = deps.screenToCanvas(touchEventData.F1_DOWN_POS);
                    // Move cursor to the tap-and-a-half location
                    state.cursorPos = { ...startPos };
                    state.selectionRectStart = { ...startPos };
                    state.selectionRectEnd = { ...startPos };
                    // Initialize position tracking for cursor movement
                    const positions = state.eventHandler.getFingerPositions();
                    state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
                    state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
                    // Update highlighted strokes (initially empty since single tap cleared them)
                    updateHighlightedStrokes();
                }
                break;
            }

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
                clearSelectionRectangle();
                // Keep highlighted strokes (don't clear them)
                updateUI();
                break;

            case Action.CANCEL_SELECTION_RECTANGLE:
                // Cancel selection rectangle and clear highlighted strokes
                clearSelectionRectangle();
                // Clear highlighted strokes
                state.highlightedStrokes.clear();
                updateUI();
                break;

            case Action.HANDLE_SINGLE_TAP_ACTION: {
                // Handle single tap gesture - contextual behavior based on cursor location

                // If radial menu is visible and was already visible when finger went down, close it
                // (Don't close if the menu was just opened by this gesture)
                if (isRadialMenuVisible() && wasMenuVisibleOnFingerDown()) {
                    hideRadialMenu();
                    break;
                }

                // If menu is visible but was just opened, don't process further
                if (isRadialMenuVisible()) {
                    break;
                }

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
            }

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
                clearCurrentStroke();
                break;

            case Action.SAVE_DRAG_START_CURSOR:
                // Save cursor position when starting drag (for snap-back after transform)
                if (state.cursorPos) {
                    state.dragStartCursorPos = { ...state.cursorPos };
                }
                break;

            case Action.RESTORE_DRAG_START_CURSOR: {
                // This fires when Transform→Idle transition happens
                // Restore cursor after canvas transform (2-finger zoom)
                // Only snap back for 2-finger canvas transforms (no strokeSnapshotsMap)
                // 3-finger stroke transforms have strokeSnapshotsMap and cursor is already correctly positioned
                const selectedIdx = getSelectedStrokeIdx();
                if (state.dragStartCursorPos && !state.transformStart?.strokeSnapshotsMap) {
                    // If there's a selected stroke with a selected point, snap to that point
                    // (the stroke coordinates haven't changed, only the view transform)
                    if (selectedIdx !== null &&
                        state.selectedStrokePointIdx !== null &&
                        selectedIdx < state.strokeHistory.length) {
                        const stroke = state.strokeHistory[selectedIdx];
                        const allPoints: { x: number; y: number }[] = [];
                        forEachLeafStroke(stroke, (leafStroke: Stroke) => {
                            allPoints.push(...leafStroke.points!);
                        });
                        if (state.selectedStrokePointIdx < allPoints.length) {
                            const snapPoint = allPoints[state.selectedStrokePointIdx];
                            state.cursorPos = { ...snapPoint };
                            state.cursorAnchorPos = { ...snapPoint };
                        } else {
                            state.cursorPos = { ...state.dragStartCursorPos };
                        }
                    } else {
                        state.cursorPos = { ...state.dragStartCursorPos };
                    }
                }
                state.dragStartCursorPos = null;
                // After any transform, if there's a selected stroke and all fingers lifted, cursor is ready to continue
                if (selectedIdx !== null && state.eventHandler.getFingerCount() === 0) {
                    state.continueExistingStroke = true;
                }
                // Snapshot AFTER transform is complete (coherent state)
                pushUndoSnapshot();
                break;
            }

            case Action.SNAP_CURSOR_TO_SELECTED_STROKE:
                // Snap cursor back to the anchor point on the selected stroke
                // This happens when lifting finger after small cursor movement (< 3mm)
                // Also happens after drawing a stroke (F1_UP after FINISH_STROKE)
                // Note: No snapshot here - the stroke was already snapshotted in FINISH_STROKE
                // Cursor snap is just a UI convenience, not a document change
                if (state.cursorAnchorPos) {
                    state.cursorPos = { ...state.cursorAnchorPos };
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
