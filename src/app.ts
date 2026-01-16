import '../styles.css';
import { createCombinedPicker } from './combinedPicker';
import { createMenuPicker } from './menuPicker';
import { Event, initStateMachineDebugCallback } from './stateMachine';
import { Point } from './eventHandler';
import {
    state,
    initState,
    Stroke,
    showDebug,
    mmToPixels,
    getSelectedStrokeIdx,
} from './state';
import { pushUndoSnapshot } from './undoSystem';
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
import {
    initRadialMenu,
    RadialMenuAction,
    hideRadialMenu,
} from './radialMenu';

// ============================================================================
// INITIALIZATION
// ============================================================================

const canvas = document.getElementById('drawingCanvas') as HTMLCanvasElement;
initState(canvas);

// Wire up state machine debug callback
initStateMachineDebugCallback(showDebug);

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
        // Close other picker and radial menu before opening
        pickers.combined?.close();
        hideRadialMenu();
    }
);
pickers.menu = menuPicker;

const combinedPicker = createCombinedPicker(
    dom.combinedPickerEl!,
    (color: string) => {
        // Apply to all highlighted strokes (including groups)
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.color = color;
                    });
                }
            }
            // Snapshot AFTER color change is complete (coherent state)
            pushUndoSnapshot();
        }
        redraw();
    },
    (size: number) => {
        // Apply to all highlighted strokes (including groups)
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.size = size;
                    });
                }
            }
            // Snapshot AFTER size change is complete (coherent state)
            pushUndoSnapshot();
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
        // Close other picker and radial menu before opening
        pickers.menu?.close();
        hideRadialMenu();
    }
);
pickers.combined = combinedPicker;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Helper function to update color and size pickers when a stroke is selected
function updatePickersBasedOnSelectedStroke() {
    const selectedIdx = getSelectedStrokeIdx();
    if (selectedIdx !== null) {
        const stroke = state.strokeHistory[selectedIdx];
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
    let strokePointCount = 0;

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
                    strokePointCount = leafStroke.points!.length;
                }
            }
        });
    }

    if (closestStrokeIdx === -1) {
        return null;
    }

    // Endpoint snapping: if an endpoint is within 1mm (screen space) of the closest point, snap to it
    const ENDPOINT_DISTANCE_THRESHOLD_MM = 1;
    // Convert screen-space mm to canvas-space by dividing by zoom scale
    const endpointDistanceThreshold = mmToPixels(ENDPOINT_DISTANCE_THRESHOLD_MM) / state.viewTransform.scale;
    const endpointDistanceThresholdSquared = endpointDistanceThreshold * endpointDistanceThreshold;

    if (strokePointCount > 1) {
        const stroke = state.strokeHistory[closestStrokeIdx];

        // Get all points from the stroke (handles both regular strokes and groups)
        const allPoints: Point[] = [];
        forEachLeafStroke(stroke, (leafStroke: Stroke) => {
            if (leafStroke.points) {
                allPoints.push(...leafStroke.points);
            }
        });

        if (allPoints.length > 1) {
            const firstPoint = allPoints[0];
            const lastPoint = allPoints[allPoints.length - 1];

            // Check distance to first point
            const dxFirst = firstPoint.x - closestPointX;
            const dyFirst = firstPoint.y - closestPointY;
            const distToFirstSquared = dxFirst * dxFirst + dyFirst * dyFirst;

            // Check distance to last point
            const dxLast = lastPoint.x - closestPointX;
            const dyLast = lastPoint.y - closestPointY;
            const distToLastSquared = dxLast * dxLast + dyLast * dyLast;

            // Snap to whichever endpoint is closer, if within threshold
            if (distToFirstSquared <= endpointDistanceThresholdSquared && distToFirstSquared <= distToLastSquared) {
                // Snap to first point
                closestPointIdx = 0;
                closestPointX = firstPoint.x;
                closestPointY = firstPoint.y;
            } else if (distToLastSquared <= endpointDistanceThresholdSquared) {
                // Snap to last point
                closestPointIdx = allPoints.length - 1;
                closestPointX = lastPoint.x;
                closestPointY = lastPoint.y;
            }
        }
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

state.eventHandler.initEventCallback((event: Event, pos?: Point) => {
    // Pass the position for F1_DOWN/F1_UP events (used for tap-and-a-half spatial proximity check)
    const posForStateMachine = pos ? { x: pos.x, y: pos.y } : null;
    const result = state.stateMachine.processEvent(event, Date.now(), posForStateMachine);

    // Pass touch event data so actions can access positions (e.g., double-tap location)
    handleActions(result.actions, state.stateMachine.getTouchEventData());

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
    updatePickersBasedOnSelectedStroke,
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
    updatePickersBasedOnSelectedStroke,
    isAnyPickerOpen: () => combinedPicker.isOpen() || menuPicker.isOpen(),
    closePickers: () => { combinedPicker.close(); menuPicker.close(); },
    screenToCanvas,
});

// Initialize radial menu
initRadialMenu({
    getPickerSize: () => combinedPicker.getSize(),
    onRadialMenuAction: (action: RadialMenuAction) => {
        // Handle radial menu button clicks
        switch (action) {
            case 'colors':
                // TODO: Open colors submenu
                showDebug('Colors button clicked');
                break;
            case 'shapes':
                // TODO: Open shapes submenu
                showDebug('Shapes button clicked');
                break;
            case 'stroke':
                // TODO: Open stroke submenu
                showDebug('Stroke button clicked');
                break;
            case 'operations':
                // TODO: Open operations submenu
                showDebug('Operations button clicked');
                break;
        }
    },
    onOpen: () => {
        // Close pickers when radial menu opens
        combinedPicker.close();
        menuPicker.close();
    },
    onColorSelect: (color: string) => {
        // Update the color picker with the selected color
        combinedPicker.setColor(color);
        // Apply to all highlighted strokes (including groups)
        if (state.highlightedStrokes.size > 0) {
            for (const index of state.highlightedStrokes) {
                if (index < state.strokeHistory.length) {
                    transformStroke(state.strokeHistory[index], (stroke: Stroke) => {
                        stroke.color = color;
                    });
                }
            }
            pushUndoSnapshot();
            redraw();
        }
    },
    getCurrentColor: () => combinedPicker.getColor(),
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

// Take initial snapshot so undo can always return to the empty state
pushUndoSnapshot();
