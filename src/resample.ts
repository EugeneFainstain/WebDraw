/**
 * Resampling utility for stroke points
 *
 * Redistributes points along a stroke path with equidistant spacing
 */

import { Point } from './eventHandler';

/**
 * Calculate the total path length of a stroke
 */
function getPathLength(points: Point[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
}

/**
 * Get distance between two points
 */
function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resample a stroke with equidistant points
 *
 * @param points - Original stroke points
 * @param numPoints - Number of points in the resampled stroke (default: 64)
 * @returns Array of resampled points with equal spacing
 */
export function resampleStroke(points: Point[], numPoints: number = 64): Point[] {
    if (points.length < 2) {
        return [...points];
    }

    const pathLength = getPathLength(points);
    const intervalLength = pathLength / (numPoints - 1);

    const resampled: Point[] = [{ ...points[0] }];
    let accumulatedDistance = 0;

    for (let i = 1; i < points.length; i++) {
        let prev = points[i - 1];
        let curr = points[i];
        let segmentLength = getDistance(prev, curr);

        while (accumulatedDistance + segmentLength >= intervalLength) {
            // We need to place a resampled point on this segment
            const distanceNeeded = intervalLength - accumulatedDistance;
            const t = distanceNeeded / segmentLength;

            // Interpolate the new point
            const newPoint: Point = {
                x: prev.x + t * (curr.x - prev.x),
                y: prev.y + t * (curr.y - prev.y)
            };

            resampled.push(newPoint);

            if (resampled.length >= numPoints) {
                return resampled;
            }

            // Update for next potential point on this same segment
            accumulatedDistance = 0;
            prev = newPoint;  // The new point becomes the new "prev"
            segmentLength = getDistance(newPoint, curr);  // Remaining distance to curr
        }

        // Carry forward the remaining distance
        accumulatedDistance += segmentLength;
    }

    // Ensure we have exactly numPoints by adding the last point if needed
    if (resampled.length < numPoints) {
        resampled.push({ ...points[points.length - 1] });
    }

    return resampled;
}
