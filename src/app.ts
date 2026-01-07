import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { createMenuPicker } from './menuPicker';
import { Event, Action, State } from './stateMachine';
import { Point } from './eventHandler';
import {
    state,
    initState,
    Stroke,
} from './state';
import {
    initPointerHandlers,
    setupPointerEventListeners,
} from './pointerHandlers';
import {
    initStrokeOperations,
    isGroup,
    forEachLeafStroke,
    transformStroke,
    updateUI,
    processUndo,
    processDelete,
    processClear,
    duplicateSelectedStroke,
    groupHighlightedStrokes,
    ungroupSelectedStroke,
    toggleFit,
} from './strokeOperations';
import {
    initCursorMovement,
    updateCursorPosition,
    addPointToStroke,
    clampCursorToView,
    panToKeepCursorInView,
    isCursorInMenuRegion,
    simulateTapAtCursor,
    updateCursorDiv,
} from './cursorMovement';
import {
    initTransform,
    initThreeFingerTransform,
    applyThreeFingerTransform,
} from './transform';
import {
    initRendering,
    redraw,
    screenToCanvas,
    canvasToScreen,
    screenDeltaToCanvasDelta,
    getDistance,
    getGridCellSize,
    snapToGrid,
    updateHighlightedStrokes,
    isIOS,
    isStandalone,
    hideIosTooltip,
    resizeCanvas,
} from './rendering';

// ============================================================================
// INITIALIZATION
// ============================================================================

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
initState(canvas);

// Aliases for frequently accessed state (for cleaner code)
const dom = state.dom;


// ============================================================================
// CUSTOM UI COMPONENTS
// ============================================================================

// Holder for pickers - allows cross-referencing between them
const pickers: { combined?: ReturnType<typeof createCombinedPicker>; menu?: ReturnType<typeof createMenuPicker> } = {};

const menuPicker = createMenuPicker(
    dom.menuPickerEl!,
    () => {
        // Fullscreen toggle
        if (isIOS() && !isStandalone()) {
            // On iOS (not in PWA mode), show the tooltip instead
            dom.iosFullscreenTooltip!.classList.toggle('visible');
        } else if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    },
    () => {
        // Reset (clear) - use the event handler
        state.eventHandler.handleClear();
    },
    () => {
        // Close other picker before opening
        pickers.combined?.close();
    }
);
pickers.menu = menuPicker;

const combinedPicker = createCombinedPicker(
    dom.combinedPickerEl!,
    (color: string) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.color = color;
                    });
                }
            }
        } else if (state.selectedStrokeIdx !== null) {
            transformStroke(state.strokeHistory[state.selectedStrokeIdx], (stroke: Stroke) => {
                stroke.color = color;
            });
        }
        redraw();
    },
    (size: number) => {
        // Apply to all highlighted strokes (including groups), or to selected stroke if no highlights
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.size = size;
                    });
                }
            }
        } else if (state.selectedStrokeIdx !== null) {
            transformStroke(state.strokeHistory[state.selectedStrokeIdx], (stroke: Stroke) => {
                stroke.size = size;
            });
        }
        redraw();
    },
    () => {
        // Grid toggle
        state.isGridMode = !state.isGridMode;

        if (state.isGridMode && state.cursorAnchor) {
            state.cursorAnchor = snapToGrid(state.cursorAnchor);
        }
        redraw();
    },
    () => {
        // Close other picker before opening
        pickers.menu?.close();
    }
);
pickers.combined = combinedPicker;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Helper function to update color and size pickers when a stroke is selected
function updatePickersForSelectedStroke() {
    if (state.selectedStrokeIdx !== null) {
        const stroke = state.strokeHistory[state.selectedStrokeIdx];
        // For groups, get the first leaf stroke's color and size
        if (isGroup(stroke)) {
            let firstColor: string | undefined;
            let firstSize: number | undefined;
            forEachLeafStroke(stroke, (s: Stroke) => {
                if (firstColor === undefined) {
                    firstColor = s.color;
                    firstSize = s.size;
                }
            });
            if (firstColor !== undefined && firstSize !== undefined) {
                combinedPicker.setColor(firstColor);
                combinedPicker.setSize(firstSize);
            }
        } else {
            combinedPicker.setColor(stroke.color!);
            combinedPicker.setSize(stroke.size!);
        }
    }
}

function findClosestStrokeAndPoint(searchPos?: Point): { strokeIdx: number; pointIdx: number; point: Point } | null {
    if (state.strokeHistory.length === 0) {
        return null;
    }

    // Use provided search position, or fall back to cursor anchor
    const referencePos = searchPos || state.cursorAnchor;
    if (!referencePos) {
        return null;
    }

    let closestStrokeIdx = -1;
    let closestPointIdx = -1;
    let closestPointX = 0;
    let closestPointY = 0;
    let minDistanceSquared = Infinity;

    // Iterate through all strokes in history
    for (let i = 0; i < state.strokeHistory.length; i++) {
        const stroke = state.strokeHistory[i];

        // Find closest point in this stroke (or recursively in its children if it's a group)
        forEachLeafStroke(stroke, (leafStroke: Stroke) => {
            for (let j = 0; j < leafStroke.points!.length; j++) {
                const point = leafStroke.points![j];
                const dx = point.x - referencePos.x;
                const dy = point.y - referencePos.y;
                const distanceSquared = dx * dx + dy * dy;

                if (distanceSquared < minDistanceSquared) {
                    minDistanceSquared = distanceSquared;
                    closestStrokeIdx = i;
                    closestPointIdx = j;
                    closestPointX = point.x;
                    closestPointY = point.y;
                }
            }
        });
    }

    if (closestStrokeIdx === -1) {
        return null;
    }

    return {
        strokeIdx: closestStrokeIdx,
        pointIdx: closestPointIdx,
        point: { x: closestPointX, y: closestPointY }
    };
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

function handleActions(actions: Action[]): void {
    for (const action of actions) {
        switch (action) {
            case Action.CREATE_STROKE:
                if (state.cursorAnchor) {
                    const startPoint = state.isGridMode ? snapToGrid(state.cursorAnchor) : state.cursorAnchor;
                    state.currentStroke = {
                        color: combinedPicker.getColor(),
                        size: combinedPicker.getSize(),
                        points: [{ ...startPoint }]
                    };
                    // In grid mode, initialize lastGridPosition to the start point
                    // but don't snap cursorAnchor - let it move freely
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
                break;

            case Action.ABANDON_STROKE:
                // Move cursor back to where the stroke started
                if (state.currentStroke && state.currentStroke.points && state.currentStroke.points.length > 0) {
                    state.cursorAnchor = { ...state.currentStroke.points[0] };
                }
                state.currentStroke = null;
                state.lastGridPosition = null;
                break;

            case Action.SELECT_STROKE:
                // SELECT_STROKE: Automatically select the stroke that was just drawn
                // Triggered after: Finishing a drawing (lifting second finger)
                // Behavior: Selects the last stroke in history (the one just completed)
                //           Cursor stays at its current position
                //           Marks as "fresh stroke" (Undo button will delete it)
                state.selectedStrokeCursorPos = state.cursorAnchor ? { ...state.cursorAnchor } : null;
                // Set selected stroke to the last stroke in history
                if (state.strokeHistory.length > 0) {
                    state.selectedStrokeIdx = state.strokeHistory.length - 1;
                    const selectedStroke = state.strokeHistory[state.selectedStrokeIdx];
                    // Set cursor to the last point of the stroke
                    if (selectedStroke.points!.length > 0) {
                        state.selectedStrokePointIdx = selectedStroke.points!.length - 1;
                    }
                }
                // Clear transformation undo state when selecting new stroke
                state.transformSnapshot = null;
                state.hasUndoableTransform = false;
                // Mark as fresh stroke (just drew)
                state.isFreshStroke = true;
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
                const closestResult = findClosestStrokeAndPoint();
                if (closestResult) {
                    // Move cursor to the closest point
                    state.cursorAnchor = closestResult.point;
                    // Select the stroke and store the point index
                    state.selectedStrokeIdx = closestResult.strokeIdx;
                    state.selectedStrokePointIdx = closestResult.pointIdx;
                    state.selectedStrokeCursorPos = { ...closestResult.point };
                    // Manual selection exits fresh stroke mode
                    state.isFreshStroke = false;
                    // Clear transformation undo state when manually selecting a stroke
                    state.transformSnapshot = null;
                    state.hasUndoableTransform = false;
                    // Update color and size pickers to match selected stroke
                    updatePickersForSelectedStroke();
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
                // Don't change isFreshStroke - it persists through deselection
                // NOTE: Don't clearDebug() here - debug messages should persist
                updateUI();
                break;

            case Action.START_SELECTION_RECTANGLE:
                // Start selection rectangle at current cursor position
                if (state.cursorAnchor) {
                    state.selectionRectStart = { ...state.cursorAnchor };
                    state.selectionRectEnd = { ...state.cursorAnchor };
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
                if (state.cursorAnchor && state.selectionRectStart) {
                    state.selectionRectEnd = { ...state.cursorAnchor };
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

            case Action.DO_NOTHING:
                // Explicitly do nothing
                break;
        }
    }
}

// ============================================================================
// STATE MACHINE EVENT CALLBACK
// ============================================================================

state.eventHandler.setEventCallback((event: Event) => {
    const prevState = state.stateMachine.getState();
    const wasStrokeSelected = state.stateMachine.isStrokeSelected();

    // Save cursor position when starting to drag with a stroke selected
    if (event === Event.F1_DOWN && prevState === State.Idle && wasStrokeSelected && state.cursorAnchor) {
        state.dragStartCursorPos = { ...state.cursorAnchor };
    }

    const result = state.stateMachine.processEvent(event);
    handleActions(result.actions);

    // Restore cursor position if drag was cancelled (finger up without moving far)
    if (event === Event.FINGER_UP && prevState === State.MovingCursor && wasStrokeSelected) {
        const flags = state.stateMachine.getFlags();
        // If we didn't move far, restore cursor to drag start position
        if (!flags.FINGER_MOVED_FAR_HAPPENED && state.dragStartCursorPos) {
            state.cursorAnchor = { ...state.dragStartCursorPos };
        }
        state.dragStartCursorPos = null;
    }

    // Handle finger promotion discontinuity
    if (event === Event.FINGER_UP) {
        const promotionDelta = state.eventHandler.getAndClearPromotionDelta();
        if (promotionDelta) {
            // When fingers are promoted, we need to update the tracking positions
            // to match the new finger assignments, otherwise the next delta calculation
            // will use the old positions and create a jump
            const positions = state.eventHandler.getFingerPositions();
            state.lastPrimaryPos = positions.primary ? { ...positions.primary } : null;
            state.lastSecondaryPos = positions.secondary ? { ...positions.secondary } : null;
        }
    }

    redraw();
});

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

// Initialize rendering
initRendering({
    getPickerColor: () => combinedPicker.getColor(),
    getPickerSize: () => combinedPicker.getSize(),
    setPickerGridActive: (active: boolean) => combinedPicker.setGridActive(active),
    updateCursorDiv,
});

// Initialize stroke operations
initStrokeOperations({
    panToKeepCursorInView,
    findClosestStrokeAndPoint,
    screenToCanvas,
    updatePickersForSelectedStroke,
    redraw,
});

// Initialize cursor movement
initCursorMovement({
    screenDeltaToCanvasDelta,
    getGridCellSize,
    snapToGrid,
    screenToCanvas,
    canvasToScreen,
    getPickerColor: () => combinedPicker.getColor(),
    getPickerSize: () => combinedPicker.getSize(),
});

// Initialize transform
initTransform({
    screenToCanvas,
    getDistance,
});

// Initialize and setup pointer handlers
initPointerHandlers({
    getDistance,
    isCursorInMenuRegion,
    updateCursorPosition,
    addPointToStroke,
    applyThreeFingerTransform,
    updateHighlightedStrokes,
    redraw,
    handleActions,
    clampCursorToView,
    snapToGrid,
    findClosestStrokeAndPoint,
    updateUI,
    updatePickersForSelectedStroke,
    isPickerOpen: () => combinedPicker.isOpen() || menuPicker.isOpen(),
    closePicker: () => { combinedPicker.close(); menuPicker.close(); },
});
setupPointerEventListeners();

// ============================================================================
// EVENT LISTENERS
// ============================================================================

dom.undoBtn!.addEventListener('click', () => processUndo());
dom.delBtn!.addEventListener('click', () => processDelete());

dom.btnDup!.addEventListener('click', () => {
    duplicateSelectedStroke();
});

dom.btnGroup!.addEventListener('click', () => {
    groupHighlightedStrokes();
});

dom.btnUngroup!.addEventListener('click', () => {
    ungroupSelectedStroke();
});

dom.btnFit!.addEventListener('click', () => {
    toggleFit();
});

dom.iosTooltipClose!.addEventListener('click', () => {
    hideIosTooltip();
});

document.addEventListener('fullscreenchange', () => {
    // Resize canvas after fullscreen change
    setTimeout(() => resizeCanvas(clampCursorToView), 100);
});

window.addEventListener('resize', () => resizeCanvas(clampCursorToView));

// ============================================================================
// STARTUP
// ============================================================================

resizeCanvas(clampCursorToView);
updateUI();
state.cursorAnchor = screenToCanvas({ x: state.canvas!.width / 2, y: state.canvas!.height / 2 });
redraw();
