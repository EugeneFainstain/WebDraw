import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { createMenuPicker } from './menuPicker';
import { Event, setStateMachineDebugCallback } from './stateMachine';
import { Point } from './eventHandler';
import {
    state,
    initState,
    Stroke,
    showDebug,
} from './state';
import { initActions, handleActions } from './actions';
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
    updateCursorDiv,
} from './cursorMovement';
import {
    initTransform,
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

// Wire up state machine debug callback
setStateMachineDebugCallback(showDebug);

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

        if (state.isGridMode && state.cursorPos) {
            state.cursorPos = snapToGrid(state.cursorPos);
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
    const referencePos = searchPos || state.cursorPos;
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

                if (distanceSquared <= minDistanceSquared) {
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
// STATE MACHINE EVENT CALLBACK
// ============================================================================

state.eventHandler.setEventCallback((event: Event) => {
    const result = state.stateMachine.processEvent(event);

    handleActions(result.actions);

    // Handle finger promotion discontinuity (on any finger-up event)
    if (event === Event.F1_UP || event === Event.F2_UP || event === Event.F3_UP) {
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

// Initialize actions
initActions({
    getPickerColor: () => combinedPicker.getColor(),
    getPickerSize: () => combinedPicker.getSize(),
    findClosestStrokeAndPoint,
    updatePickersForSelectedStroke,
});

// Initialize and setup pointer handlers
initPointerHandlers({
    getDistance,
    updateCursorPosition,
    addPointToStroke,
    applyThreeFingerTransform,
    updateHighlightedStrokes,
    redraw,
    handleActions,
    clampCursorToView,
    snapToGrid,
    updateUI,
    canvasToScreen,
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
state.cursorPos = screenToCanvas({ x: state.canvas!.width / 2, y: state.canvas!.height / 2 });
redraw();
