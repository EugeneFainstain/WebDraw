/**
 * Shape fitting error metrics
 *
 * Provides bidirectional Hausdorff distance calculation for shape fitting
 */

import { Point } from '../eventHandler';

/**
 * Calculate bidirectional Hausdorff distance squared between stroke points and a shape
 *
 * This metric prevents degenerate fits by measuring error in both directions:
 * 1. Maximum distance from stroke points to shape
 * 2. Maximum distance from shape sample points to stroke
 *
 * Returns the maximum of these two directional distances squared.
 *
 * @param points - Stroke points to fit
 * @param distanceToShapeFn - Function that calculates distance from a point to the shape
 * @param shapeSamplePoints - Array of points sampled uniformly on the shape boundary
 * @returns Hausdorff distance squared
 */
export function calculateShapeError(
    points: Point[],
    distanceToShapeFn: (p: Point) => number,
    shapeSamplePoints: Point[]
): number {
    // Direction 1: Stroke points to shape - take max
    let maxStrokeToShape = 0;
    for (const p of points) {
        const dist = distanceToShapeFn(p);
        maxStrokeToShape = Math.max(maxStrokeToShape, dist * dist);
    }

    // Direction 2: Shape to stroke points - take max
    let maxShapeToStroke = 0;
    for (const shapePoint of shapeSamplePoints) {
        // Find closest stroke point
        let minDist = Infinity;
        for (const p of points) {
            const dx = p.x - shapePoint.x;
            const dy = p.y - shapePoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
        }
        maxShapeToStroke = Math.max(maxShapeToStroke, minDist * minDist);
    }

    // Return max of both directions (Hausdorff distance squared)
    return Math.max(maxStrokeToShape, maxShapeToStroke);
}
