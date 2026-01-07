/**
 * STROKEOPERATIONS.TS - Stroke Manipulation and History Operations
 *
 * This module handles high-level operations on strokes: deletion, duplication,
 * grouping, and undo/redo functionality.
 *
 * Responsibilities:
 * - Stroke helper functions: isGroup, forEachLeafStroke, transformStroke, cloneStroke
 * - Delete/undo operations (processDelete) with transform undo support
 * - Clear canvas (processClear)
 * - Duplicate selected stroke with mirror transform
 * - Group multiple strokes into a hierarchy
 * - Ungroup a stroke group into individual strokes
 * - Update UI button states (del/undo, duplicate, group/ungroup)
 *
 * Design: Uses a callback pattern for dependencies on app.ts functions.
 * Directly mutates state.strokeHistory and related selection state.
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { state, resetState, showDebug, Stroke } from './state';
import { fitStroke } from './shapeFitting';

// ============================================================================
// TYPES
// ============================================================================

export interface StrokeOperationCallbacks {
    panToKeepCursorInView: () => void;
    findClosestStrokeAndPoint: (searchPos?: Point) => { strokeIdx: number; pointIdx: number; point: Point } | null;
    screenToCanvas: (screenPos: Point) => Point;
    updatePickersForSelectedStroke: () => void;
    redraw: () => void;
}

// Store callbacks - will be set during initialization
let callbacks: StrokeOperationCallbacks;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initStrokeOperations(cb: StrokeOperationCallbacks): void {
    callbacks = cb;
}

// ============================================================================
// STROKE HELPER FUNCTIONS
// ============================================================================

// Helper to check if a stroke is a group
export function isGroup(stroke: Stroke): boolean {
    return stroke.strokes !== undefined && stroke.strokes.length > 0;
}

// Iterate over all leaf strokes (non-group strokes) in a stroke hierarchy
export function forEachLeafStroke(stroke: Stroke, callback: (s: Stroke) => void): void {
    if (isGroup(stroke)) {
        for (const child of stroke.strokes!) {
            forEachLeafStroke(child, callback);
        }
    } else {
        callback(stroke);
    }
}

// Transform all leaf strokes in a stroke hierarchy
export function transformStroke(stroke: Stroke, transformFunc: (s: Stroke) => void): void {
    if (isGroup(stroke)) {
        for (const child of stroke.strokes!) {
            transformStroke(child, transformFunc);
        }
    } else {
        transformFunc(stroke);
    }
}

// Deep clone a stroke (including groups)
export function cloneStroke(stroke: Stroke): Stroke {
    if (isGroup(stroke)) {
        return {
            strokes: stroke.strokes!.map(child => cloneStroke(child))
        };
    } else {
        const cloned: Stroke = {
            color: stroke.color!,
            size: stroke.size!,
            points: stroke.points!.map(p => ({ ...p }))
        };
        if (stroke.originalPoints) {
            cloned.originalPoints = stroke.originalPoints.map(p => ({ ...p }));
        }
        if (stroke.fittedPoints) {
            cloned.fittedPoints = stroke.fittedPoints.map(p => ({ ...p }));
        }
        if (stroke.fitType) {
            cloned.fitType = stroke.fitType;
        }
        if (stroke.showingFitted !== undefined) {
            cloned.showingFitted = stroke.showingFitted;
        }
        if (stroke.fittedWithSize !== undefined) {
            cloned.fittedWithSize = stroke.fittedWithSize;
        }
        return cloned;
    }
}

// ============================================================================
// BUTTON STATE UPDATES
// ============================================================================

export function updateUI(): void {
    const dom = state.dom;
    const hasStrokes = state.strokeHistory.length > 0;
    const hasHighlightedStrokes = state.highlightedStrokes.size > 0;

    // Undo button: enabled when there are strokes in the drawing
    dom.undoBtn!.disabled = !hasStrokes;

    // Del button: enabled when there are highlighted strokes
    dom.delBtn!.disabled = !hasHighlightedStrokes;

    // Update duplicate button state - enabled when exactly one stroke is highlighted
    dom.btnDup!.disabled = state.highlightedStrokes.size !== 1;

    // Update group/ungroup buttons
    updateGroupButtons();

    // Update fit button state
    updateFitButton();
}

export function updateGroupButtons(): void {
    const dom = state.dom;

    // Determine enabled states
    const canGroup = state.highlightedStrokes.size >= 2;
    let canUngroup = false;
    // Ungroup enabled when exactly one stroke is highlighted and it's a group
    if (state.highlightedStrokes.size === 1) {
        const highlightedIdx = Array.from(state.highlightedStrokes)[0];
        if (highlightedIdx < state.strokeHistory.length) {
            const stroke = state.strokeHistory[highlightedIdx];
            canUngroup = isGroup(stroke);
        }
    }

    // Show only one button at a time:
    // - If ungroup is enabled, show ungroup button
    // - Otherwise show group button (enabled or disabled)
    if (canUngroup) {
        dom.btnGroup!.style.display = 'none';
        dom.btnUngroup!.style.display = 'flex';
        dom.btnUngroup!.disabled = false;
    } else {
        dom.btnGroup!.style.display = 'flex';
        dom.btnUngroup!.style.display = 'none';
        dom.btnGroup!.disabled = !canGroup;
    }
}

// Helper to get the single stroke index for fit operation
// Returns the stroke index if exactly one stroke is selected or highlighted (or both pointing to same stroke)
function getFitTargetStrokeIdx(): number | null {
    const hasSelection = state.selectedStrokeIdx !== null && state.selectedStrokeIdx < state.strokeHistory.length;
    const hasOneHighlight = state.highlightedStrokes.size === 1;

    if (hasSelection && hasOneHighlight) {
        // Both exist - they must point to the same stroke
        const highlightedIdx = Array.from(state.highlightedStrokes)[0];
        if (highlightedIdx === state.selectedStrokeIdx) {
            return state.selectedStrokeIdx;
        }
        // Different strokes - ambiguous, don't allow
        return null;
    } else if (hasSelection) {
        return state.selectedStrokeIdx;
    } else if (hasOneHighlight) {
        return Array.from(state.highlightedStrokes)[0];
    }
    return null;
}

export function updateFitButton(): void {
    const dom = state.dom;

    // Fit is enabled when exactly one non-group stroke is selected or highlighted
    let canFit = false;

    const strokeIdx = getFitTargetStrokeIdx();
    if (strokeIdx !== null) {
        const stroke = state.strokeHistory[strokeIdx];
        // Can only fit non-group strokes
        canFit = !isGroup(stroke);
    }

    dom.btnFit!.disabled = !canFit;
}

// ============================================================================
// DELETE / UNDO
// ============================================================================

// Undo: removes the last stroke from history (simple undo)
export function processUndo(): void {
    if (state.strokeHistory.length === 0) return;

    // Remove the last stroke from history
    const deletedStroke = state.strokeHistory.pop()!;

    // Move cursor to the beginning of the deleted stroke
    let firstPointX = 0;
    let firstPointY = 0;
    let foundPoint = false;
    forEachLeafStroke(deletedStroke, (leafStroke: Stroke) => {
        if (!foundPoint && leafStroke.points!.length > 0) {
            firstPointX = leafStroke.points![0].x;
            firstPointY = leafStroke.points![0].y;
            foundPoint = true;
        }
    });
    if (foundPoint) {
        state.cursorAnchor = { x: firstPointX, y: firstPointY };
        callbacks.panToKeepCursorInView();
    }

    // Clear selection state
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.selectedStrokeCursorPos = null;
    state.isFreshStroke = false;
    state.transformSnapshot = null;
    state.hasUndoableTransform = false;

    // Update highlighted strokes - remove any that are now invalid
    const newHighlighted = new Set<number>();
    for (const idx of state.highlightedStrokes) {
        if (idx < state.strokeHistory.length) {
            newHighlighted.add(idx);
        }
    }
    state.highlightedStrokes = newHighlighted;

    updateUI();
    callbacks.redraw();
}

// Delete: removes all highlighted strokes
export function processDelete(): void {
    if (state.highlightedStrokes.size === 0) return;

    // Get sorted indices in descending order (to remove from end first)
    const indicesToDelete = Array.from(state.highlightedStrokes).sort((a, b) => b - a);

    // Remove strokes from history (in reverse order to maintain valid indices)
    for (const idx of indicesToDelete) {
        if (idx < state.strokeHistory.length) {
            state.strokeHistory.splice(idx, 1);
        }
    }

    // Clear highlighted strokes
    state.highlightedStrokes.clear();

    // Clear selection state
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.selectedStrokeCursorPos = null;
    state.isFreshStroke = false;
    state.transformSnapshot = null;
    state.hasUndoableTransform = false;

    updateUI();
    callbacks.redraw();
}

// ============================================================================
// CLEAR
// ============================================================================

export function processClear(): void {
    resetState();
    state.cursorAnchor = callbacks.screenToCanvas({ x: state.canvas!.width / 2, y: state.canvas!.height / 2 });
    updateUI();
}

// ============================================================================
// DUPLICATE
// ============================================================================

export function duplicateSelectedStroke(): void {
    // Duplicate the single highlighted stroke
    if (state.highlightedStrokes.size !== 1) {
        showDebug('Need exactly 1 highlighted stroke to duplicate!');
        return;
    }

    const highlightedIdx = Array.from(state.highlightedStrokes)[0];
    if (highlightedIdx >= state.strokeHistory.length) {
        showDebug('Invalid highlighted stroke index!');
        return;
    }

    const sourceStroke = state.strokeHistory[highlightedIdx];

    // Calculate bounding box of the source stroke (works for groups too)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    forEachLeafStroke(sourceStroke, (leafStroke: Stroke) => {
        for (const point of leafStroke.points!) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    });

    const centerX = (minX + maxX) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    // Mirror points around vertical line through center, then offset
    const offsetX = width * 0.25;  // Right by 1/4 of bounding box width
    const offsetY = -height * 0.5;  // Up by 1/2 of bounding box height

    // Clone the stroke (handles groups recursively)
    const duplicatedStroke = cloneStroke(sourceStroke);

    // Transform all points in the duplicated stroke
    transformStroke(duplicatedStroke, (leafStroke: Stroke) => {
        // Transform main points
        leafStroke.points = leafStroke.points!.map(point => {
            const mirroredX = centerX - (point.x - centerX);
            return {
                x: mirroredX + offsetX,
                y: point.y + offsetY
            };
        });

        // Transform original points if they exist
        if (leafStroke.originalPoints) {
            leafStroke.originalPoints = leafStroke.originalPoints.map(point => {
                const mirroredX = centerX - (point.x - centerX);
                return {
                    x: mirroredX + offsetX,
                    y: point.y + offsetY
                };
            });
        }

        // Transform fitted points if they exist
        if (leafStroke.fittedPoints) {
            leafStroke.fittedPoints = leafStroke.fittedPoints.map(point => {
                const mirroredX = centerX - (point.x - centerX);
                return {
                    x: mirroredX + offsetX,
                    y: point.y + offsetY
                };
            });
        }
    });

    // Add the duplicated stroke to history
    state.strokeHistory.push(duplicatedStroke);

    // Highlight the new stroke (clear previous highlights)
    const newIdx = state.strokeHistory.length - 1;
    state.highlightedStrokes.clear();
    state.highlightedStrokes.add(newIdx);

    // Deselect any selected stroke
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.selectedStrokeCursorPos = null;
    state.isFreshStroke = false;

    // Clear transformation undo state
    state.transformSnapshot = null;
    state.hasUndoableTransform = false;

    updateUI();
    callbacks.redraw();
}

// ============================================================================
// GROUP / UNGROUP
// ============================================================================

export function groupHighlightedStrokes(): void {
    if (state.highlightedStrokes.size < 2) {
        showDebug('Need at least 2 strokes to group!');
        return;
    }

    // Collect the strokes to group (in order of their indices)
    const indices = Array.from(state.highlightedStrokes).sort((a, b) => a - b);
    const strokesToGroup: Stroke[] = [];

    for (const index of indices) {
        strokesToGroup.push(cloneStroke(state.strokeHistory[index]));
    }

    // Remove the original strokes from history (in reverse order to maintain indices)
    for (let i = indices.length - 1; i >= 0; i--) {
        state.strokeHistory.splice(indices[i], 1);
    }

    // Create a new group stroke
    const groupStroke: Stroke = {
        strokes: strokesToGroup
    };

    // Add the group at the position of the first stroke
    state.strokeHistory.splice(indices[0], 0, groupStroke);

    // Clear highlighted strokes, select the new group, and highlight it
    state.highlightedStrokes.clear();
    state.highlightedStrokes.add(indices[0]);
    state.selectedStrokeIdx = indices[0];
    state.isFreshStroke = false;

    updateUI();
    callbacks.updatePickersForSelectedStroke();
    callbacks.redraw();
}

export function ungroupSelectedStroke(): void {
    // Ungroup the single highlighted stroke
    if (state.highlightedStrokes.size !== 1) {
        showDebug('Need exactly 1 highlighted stroke to ungroup!');
        return;
    }

    const highlightedIdx = Array.from(state.highlightedStrokes)[0];
    if (highlightedIdx >= state.strokeHistory.length) {
        showDebug('Invalid highlighted stroke index!');
        return;
    }

    const stroke = state.strokeHistory[highlightedIdx];

    if (!isGroup(stroke)) {
        showDebug('Highlighted stroke is not a group!');
        return;
    }

    // Get the immediate children (one level only)
    const children = stroke.strokes!.map(child => cloneStroke(child));

    // Remove the group from history
    state.strokeHistory.splice(highlightedIdx, 1);

    // Insert all children at the same position
    const insertionIndex = highlightedIdx;
    state.strokeHistory.splice(insertionIndex, 0, ...children);

    // Highlight all the ungrouped strokes
    state.highlightedStrokes.clear();
    for (let i = 0; i < children.length; i++) {
        state.highlightedStrokes.add(insertionIndex + i);
    }

    // Deselect
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.selectedStrokeCursorPos = null;
    state.isFreshStroke = false;

    updateUI();
    updateGroupButtons();
    callbacks.redraw();
}

// ============================================================================
// FIT STROKE
// ============================================================================

export function toggleFit(): void {
    // Get target stroke (selected or highlighted)
    const strokeIdx = getFitTargetStrokeIdx();
    if (strokeIdx === null) {
        return;
    }

    const stroke = state.strokeHistory[strokeIdx];

    // Can't fit groups
    if (isGroup(stroke)) {
        return;
    }

    // Determine if we're toggling ON or OFF
    const turningOn = !stroke.showingFitted;

    // If turning ON and stroke hasn't been fitted yet, or if it's a polyline/polygon
    // that was fitted with a different stroke size, fit it now
    const isSizeDependentFit = stroke.fitType === 'polyline' || stroke.fitType?.startsWith('polygon-');
    const needsRefit = !stroke.fittedPoints ||
                      (isSizeDependentFit && stroke.fittedWithSize !== stroke.size!);

    if (turningOn && needsRefit) {
        fitStroke(stroke);
    }

    // Toggle display between fitted and original
    if (stroke.fittedPoints && stroke.originalPoints) {
        stroke.showingFitted = turningOn;
    }

    updateFitButton();
    callbacks.redraw();
}
