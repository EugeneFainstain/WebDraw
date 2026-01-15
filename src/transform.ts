/**
 * TRANSFORM.TS - Three-Finger Gesture Transform Operations
 *
 * This module handles pinch-zoom-rotate gesture transformations for both
 * the canvas view (2-finger) and selected strokes (3-finger).
 *
 * Responsibilities:
 * - Initialize transform state when gesture begins (initThreeFingerTransform)
 * - Apply continuous transform updates during gesture (applyThreeFingerTransform)
 * - 2-finger gesture: Transform the entire canvas view (pan, zoom, rotate)
 * - 3-finger gesture: Transform selected stroke and highlighted strokes
 * - Create and apply stroke snapshots for smooth transformations
 * - Calculate scale factors and rotation deltas from finger positions
 * - Handle angle normalization for smooth rotation tracking
 *
 * Design: Uses a callback pattern for coordinate transforms and stroke utilities.
 * Reads/writes state.transformStart, state.viewTransform, and stroke data.
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { state, Stroke, StrokeSnapshot, getSelectedStrokeIdx } from './state';
import { forEachLeafStroke, transformStroke } from './strokeOperations';

// ============================================================================
// TYPES
// ============================================================================

export interface TransformCallbacks {
    screenToCanvas: (screenPos: Point) => Point;
    getDistance: (p1: Point, p2: Point) => number;
}

// Store callbacks - will be set during initialization
let callbacks: TransformCallbacks;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initTransform(cb: TransformCallbacks): void {
    callbacks = cb;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getAngle(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function normalizeAngleDelta(delta: number): number {
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return delta;
}

// Helper to get all points from a stroke (including groups) for transformation
export function getAllPointsForTransform(stroke: Stroke): Point[] {
    const allPoints: Point[] = [];
    forEachLeafStroke(stroke, (leafStroke: Stroke) => {
        allPoints.push(...leafStroke.points!);
    });
    return allPoints;
}

export function createStrokeSnapshot(stroke: Stroke): StrokeSnapshot[] {
    const snapshots: StrokeSnapshot[] = [];
    transformStroke(stroke, (leafStroke: Stroke) => {
        const snapshot: StrokeSnapshot = {
            points: leafStroke.points!.map(p => ({ ...p }))
        };
        if (leafStroke.fittedPoints) {
            snapshot.fittedPoints = leafStroke.fittedPoints.map(p => ({ ...p }));
        }
        if (leafStroke.originalPoints) {
            snapshot.originalPoints = leafStroke.originalPoints.map(p => ({ ...p }));
        }
        snapshots.push(snapshot);
    });
    return snapshots;
}

function applyTransformToStroke(
    stroke: Stroke,
    initialSnapshots: StrokeSnapshot[],
    center: Point,
    scaleFactor: number,
    rotationDelta: number,
    newCenter: Point
): void {
    let snapshotIndex = 0;
    transformStroke(stroke, (leafStroke: Stroke) => {
        const snapshot = initialSnapshots[snapshotIndex++];

        // Transform points
        const transformedPoints: Point[] = [];
        for (let i = 0; i < snapshot.points.length; i++) {
            const originalPoint = snapshot.points[i];
            const dx = originalPoint.x - center.x;
            const dy = originalPoint.y - center.y;

            const cos = Math.cos(rotationDelta);
            const sin = Math.sin(rotationDelta);
            const rotatedX = dx * cos - dy * sin;
            const rotatedY = dx * sin + dy * cos;

            const scaledX = rotatedX * scaleFactor;
            const scaledY = rotatedY * scaleFactor;

            transformedPoints.push({
                x: scaledX + newCenter.x,
                y: scaledY + newCenter.y
            });
        }
        leafStroke.points = transformedPoints;

        // Transform fittedPoints if they exist in snapshot
        if (snapshot.fittedPoints) {
            const transformedFittedPoints: Point[] = [];
            for (let i = 0; i < snapshot.fittedPoints.length; i++) {
                const fittedPoint = snapshot.fittedPoints[i];
                const dx = fittedPoint.x - center.x;
                const dy = fittedPoint.y - center.y;

                const cos = Math.cos(rotationDelta);
                const sin = Math.sin(rotationDelta);
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;

                const scaledX = rotatedX * scaleFactor;
                const scaledY = rotatedY * scaleFactor;

                transformedFittedPoints.push({
                    x: scaledX + newCenter.x,
                    y: scaledY + newCenter.y
                });
            }
            leafStroke.fittedPoints = transformedFittedPoints;
        }

        // Transform originalPoints if they exist in snapshot
        if (snapshot.originalPoints) {
            const transformedOriginalPoints: Point[] = [];
            for (let i = 0; i < snapshot.originalPoints.length; i++) {
                const origPoint = snapshot.originalPoints[i];
                const dx = origPoint.x - center.x;
                const dy = origPoint.y - center.y;

                const cos = Math.cos(rotationDelta);
                const sin = Math.sin(rotationDelta);
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;

                const scaledX = rotatedX * scaleFactor;
                const scaledY = rotatedY * scaleFactor;

                transformedOriginalPoints.push({
                    x: scaledX + newCenter.x,
                    y: scaledY + newCenter.y
                });
            }
            leafStroke.originalPoints = transformedOriginalPoints;
        }
    });
}

// ============================================================================
// MAIN TRANSFORM FUNCTIONS
// ============================================================================

export function initThreeFingerTransform(): void {
    const positions = state.eventHandler.getFingerPositions();
    const fingerCount = state.eventHandler.getFingerCount();

    // 1-finger gesture: canvas pan only
    // 2-finger gesture: canvas zoom/pan/rotate (never transforms selected stroke)
    // 3-finger gesture: selected stroke zoom (does nothing if no stroke selected)
    if (fingerCount === 1) {
        if (!positions.primary) return;

        // One-finger transform - pan only
        state.transformStart = {
            pivot: { ...positions.primary },
            initialScale: 1,
            fingerAngles: [],
            unwrappedRotation: 0,
            initialTransform: { ...state.viewTransform }
            // No strokeSnapshotsMap - 1-finger always pans canvas
        };
    } else if (fingerCount === 2) {
        if (!positions.primary || !positions.secondary) return;

        // Two-finger transform - ALWAYS transforms canvas, never selected stroke
        const pivot = {
            x: (positions.primary.x + positions.secondary.x) / 2,
            y: (positions.primary.y + positions.secondary.y) / 2
        };

        const dist1 = callbacks.getDistance(pivot, positions.primary);
        const dist2 = callbacks.getDistance(pivot, positions.secondary);
        const initialScale = (dist1 + dist2) / 2;

        const angle1 = getAngle(pivot, positions.primary);
        const angle2 = getAngle(pivot, positions.secondary);

        state.transformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2],
            unwrappedRotation: 0,
            initialTransform: { ...state.viewTransform }
            // No strokeSnapshotsMap - 2-finger always transforms canvas
        };

        // Update cursor position to selected stroke point at start of transform
        // This ensures the reticle cursor shows at the correct location during canvas transform
        const selectedIdx = getSelectedStrokeIdx();
        if (selectedIdx !== null && state.selectedStrokePointIdx !== null && selectedIdx < state.strokeHistory.length) {
            const points = getAllPointsForTransform(state.strokeHistory[selectedIdx]);
            if (state.selectedStrokePointIdx < points.length) {
                const pos = points[state.selectedStrokePointIdx];
                state.cursorPos = { ...pos };
                state.cursorAnchorPos = { ...pos };
            }
        }
    } else if (fingerCount >= 3) {
        // Three-finger transform - transforms all highlighted strokes
        // Collect all stroke indices to transform
        const strokesToTransform = new Set<number>();

        // Add all highlighted strokes
        for (const idx of state.highlightedStrokes) {
            if (idx < state.strokeHistory.length) {
                strokesToTransform.add(idx);
            }
        }

        if (!positions.primary || !positions.secondary || !positions.tertiary) return;

        // If no strokes to transform, continue canvas transform with 3 fingers
        if (strokesToTransform.size === 0) {
            const pivot = {
                x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
                y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
            };

            const dist1 = callbacks.getDistance(pivot, positions.primary);
            const dist2 = callbacks.getDistance(pivot, positions.secondary);
            const dist3 = callbacks.getDistance(pivot, positions.tertiary);
            const initialScale = (dist1 + dist2 + dist3) / 3;

            const angle1 = getAngle(pivot, positions.primary);
            const angle2 = getAngle(pivot, positions.secondary);
            const angle3 = getAngle(pivot, positions.tertiary);

            state.transformStart = {
                pivot,
                initialScale,
                fingerAngles: [angle1, angle2, angle3],
                unwrappedRotation: 0,
                initialTransform: { ...state.viewTransform }
                // No strokeSnapshotsMap - canvas transform
            };
            return;
        }

        const pivot = {
            x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
            y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
        };

        const dist1 = callbacks.getDistance(pivot, positions.primary);
        const dist2 = callbacks.getDistance(pivot, positions.secondary);
        const dist3 = callbacks.getDistance(pivot, positions.tertiary);
        const initialScale = (dist1 + dist2 + dist3) / 3;

        const angle1 = getAngle(pivot, positions.primary);
        const angle2 = getAngle(pivot, positions.secondary);
        const angle3 = getAngle(pivot, positions.tertiary);

        // Create snapshots for all strokes and calculate combined bounding box
        const strokeSnapshotsMap = new Map<number, StrokeSnapshot[]>();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const idx of strokesToTransform) {
            const stroke = state.strokeHistory[idx];
            const snapshots = createStrokeSnapshot(stroke);
            strokeSnapshotsMap.set(idx, snapshots);

            // Update combined bounding box
            for (const snapshot of snapshots) {
                for (const point of snapshot.points) {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }
            }
        }

        const initialCombinedCenter = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };

        state.transformStart = {
            pivot,
            initialScale,
            fingerAngles: [angle1, angle2, angle3],
            unwrappedRotation: 0,
            initialTransform: { ...state.viewTransform },
            strokeSnapshotsMap,
            initialCombinedCenter
        };

        // Store transform snapshot for undo (only for selected stroke)
        const selectedIdx = getSelectedStrokeIdx();
        if (!state.hasUndoableTransform && selectedIdx !== null && selectedIdx < state.strokeHistory.length) {
            const allPoints = getAllPointsForTransform(state.strokeHistory[selectedIdx]);
            state.transformSnapshot = allPoints.map(p => ({ ...p }));
        }

        // Update cursor position to selected stroke point at start of transform
        // This ensures the reticle cursor shows at the correct location during transform
        if (selectedIdx !== null && state.selectedStrokePointIdx !== null && selectedIdx < state.strokeHistory.length) {
            const points = getAllPointsForTransform(state.strokeHistory[selectedIdx]);
            if (state.selectedStrokePointIdx < points.length) {
                const pos = points[state.selectedStrokePointIdx];
                state.cursorPos = { ...pos };
                state.cursorAnchorPos = { ...pos };
            }
        }
    }
}

export function applyThreeFingerTransform(): void {
    if (!state.transformStart) return;

    const positions = state.eventHandler.getFingerPositions();
    const fingerCount = state.eventHandler.getFingerCount();

    let currentPivot: Point;
    let currentScale: number;
    let averageDelta: number;

    // Support 1-finger, 2-finger, and 3-finger gestures
    if (fingerCount === 1 && positions.primary) {
        // One-finger pan only
        currentPivot = { ...positions.primary };

        // Calculate pan delta from initial pivot to current position
        const panDeltaX = currentPivot.x - state.transformStart.pivot.x;
        const panDeltaY = currentPivot.y - state.transformStart.pivot.y;

        // Apply pan to canvas
        state.viewTransform.panX = state.transformStart.initialTransform.panX + panDeltaX;
        state.viewTransform.panY = state.transformStart.initialTransform.panY + panDeltaY;
        return;
    } else if (fingerCount === 2 && positions.primary && positions.secondary) {
        // Two-finger transform
        currentPivot = {
            x: (positions.primary.x + positions.secondary.x) / 2,
            y: (positions.primary.y + positions.secondary.y) / 2
        };

        const dist1 = callbacks.getDistance(currentPivot, positions.primary);
        const dist2 = callbacks.getDistance(currentPivot, positions.secondary);
        currentScale = (dist1 + dist2) / 2;

        const angle1 = getAngle(currentPivot, positions.primary);
        const angle2 = getAngle(currentPivot, positions.secondary);

        const delta1 = normalizeAngleDelta(angle1 - state.transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - state.transformStart.fingerAngles[1]);

        averageDelta = (delta1 + delta2) / 2;
        state.transformStart.unwrappedRotation += averageDelta;

        state.transformStart.fingerAngles = [angle1, angle2];
    } else if (fingerCount >= 3 && positions.primary && positions.secondary && positions.tertiary) {
        // Three-finger transform
        currentPivot = {
            x: (positions.primary.x + positions.secondary.x + positions.tertiary.x) / 3,
            y: (positions.primary.y + positions.secondary.y + positions.tertiary.y) / 3
        };

        const dist1 = callbacks.getDistance(currentPivot, positions.primary);
        const dist2 = callbacks.getDistance(currentPivot, positions.secondary);
        const dist3 = callbacks.getDistance(currentPivot, positions.tertiary);
        currentScale = (dist1 + dist2 + dist3) / 3;

        const angle1 = getAngle(currentPivot, positions.primary);
        const angle2 = getAngle(currentPivot, positions.secondary);
        const angle3 = getAngle(currentPivot, positions.tertiary);

        const delta1 = normalizeAngleDelta(angle1 - state.transformStart.fingerAngles[0]);
        const delta2 = normalizeAngleDelta(angle2 - state.transformStart.fingerAngles[1]);
        const delta3 = normalizeAngleDelta(angle3 - state.transformStart.fingerAngles[2]);

        averageDelta = (delta1 + delta2 + delta3) / 3;
        state.transformStart.unwrappedRotation += averageDelta;

        state.transformStart.fingerAngles = [angle1, angle2, angle3];
    } else {
        return; // Invalid finger count
    }

    const scaleFactor = currentScale / state.transformStart.initialScale;
    const rotationDelta = state.transformStart.unwrappedRotation;

    // Gesture separation:
    // - 2-finger: ALWAYS transforms canvas (strokeSnapshotsMap is never set)
    // - 3-finger: ALWAYS transforms selected stroke + highlighted strokes (strokeSnapshotsMap is set)
    if (state.transformStart.strokeSnapshotsMap && state.transformStart.initialCombinedCenter) {
        // 3-finger transform: Transform all strokes in the map around the combined center
        const initialCenter = state.transformStart.initialCombinedCenter;

        const initialCanvasPivot = callbacks.screenToCanvas(state.transformStart.pivot);
        const currentCanvasPivot = callbacks.screenToCanvas(currentPivot);

        const panDeltaX = currentCanvasPivot.x - initialCanvasPivot.x;
        const panDeltaY = currentCanvasPivot.y - initialCanvasPivot.y;

        const newCenter = {
            x: initialCenter.x + panDeltaX,
            y: initialCenter.y + panDeltaY
        };

        // Apply transformation to each stroke in the map
        for (const [idx, snapshots] of state.transformStart.strokeSnapshotsMap) {
            if (idx < state.strokeHistory.length) {
                const stroke = state.strokeHistory[idx];
                applyTransformToStroke(
                    stroke,
                    snapshots,
                    initialCenter,
                    scaleFactor,
                    rotationDelta,
                    newCenter
                );
            }
        }

        // Update cursor and cursorAnchorPos to the transformed position of the same point
        const selectedIdx = getSelectedStrokeIdx();
        if (selectedIdx !== null && state.selectedStrokePointIdx !== null && selectedIdx < state.strokeHistory.length) {
            const transformedPoints = getAllPointsForTransform(state.strokeHistory[selectedIdx]);
            if (state.selectedStrokePointIdx < transformedPoints.length) {
                const newPos = { ...transformedPoints[state.selectedStrokePointIdx] };
                state.cursorPos = newPos;
                state.cursorAnchorPos = { ...newPos };
            }
        }
    } else {
        // 2-finger transform: Transform the entire canvas view
        const newScale = state.transformStart.initialTransform.scale * scaleFactor;
        const newRotation = state.transformStart.initialTransform.rotation + rotationDelta;

        const startPivot = state.transformStart.pivot;
        const initT = state.transformStart.initialTransform;
        const cx = state.canvas!.width / 2;
        const cy = state.canvas!.height / 2;

        const cos0 = Math.cos(-initT.rotation);
        const sin0 = Math.sin(-initT.rotation);
        const sx1 = startPivot.x - initT.panX;
        const sy1 = startPivot.y - initT.panY;
        const sx2 = cos0 * (sx1 - cx) - sin0 * (sy1 - cy) + cx;
        const sy2 = sin0 * (sx1 - cx) + cos0 * (sy1 - cy) + cy;
        const canvasX = (sx2 - cx) / initT.scale + cx;
        const canvasY = (sy2 - cy) / initT.scale + cy;

        const cos1 = Math.cos(newRotation);
        const sin1 = Math.sin(newRotation);
        const tx1 = (canvasX - cx) * newScale + cx;
        const ty1 = (canvasY - cy) * newScale + cy;
        const tx2 = cos1 * (tx1 - cx) - sin1 * (ty1 - cy) + cx;
        const ty2 = sin1 * (tx1 - cx) + cos1 * (ty1 - cy) + cy;

        state.viewTransform.scale = newScale;
        state.viewTransform.rotation = newRotation;
        state.viewTransform.panX = currentPivot.x - tx2;
        state.viewTransform.panY = currentPivot.y - ty2;
    }
}
