/**
 * Polyline fitting algorithm using Ramer-Douglas-Peucker (RDP)
 *
 * Simplifies a stroke into a polyline while staying within a specified
 * tolerance (epsilon) from the original stroke.
 */

import { Point } from '../eventHandler';

export interface PolylineFit {
    points: Point[];      // Simplified polyline vertices
    segments: number;     // Number of line segments (points.length - 1)
    error: number;        // Maximum perpendicular distance from original points
}

/**
 * Fit a polyline to a stroke using the Ramer-Douglas-Peucker algorithm
 *
 * @param points - Original stroke points
 * @param strokeWidth - Width of the stroke (epsilon will be 2 * strokeWidth)
 * @returns Polyline fit parameters
 */
export function fitPolyline(
    points: Point[],
    strokeWidth: number
): PolylineFit | null {
    if (points.length < 2) {
        return null;
    }

    // If we only have 2 points, return them as-is
    if (points.length === 2) {
        return {
            points: [points[0], points[points.length - 1]],
            segments: 1,
            error: 0
        };
    }

    // Set epsilon to twice the stroke width
    const epsilon = 2 * strokeWidth;

    // Run RDP algorithm
    const simplified = ramerDouglasPeucker(points, epsilon);

    // Calculate the maximum error (perpendicular distance)
    const error = calculateMaxError(points, simplified);

    return {
        points: simplified,
        segments: simplified.length - 1,
        error
    };
}

/**
 * Ramer-Douglas-Peucker algorithm implementation
 * Recursively simplifies a polyline by removing points that are within epsilon
 * of the line segment connecting their neighbors
 *
 * @param points - Points to simplify
 * @param epsilon - Maximum allowed perpendicular distance
 * @returns Simplified point array
 */
function ramerDouglasPeucker(points: Point[], epsilon: number): Point[] {
    if (points.length <= 2) {
        return points;
    }

    // Find the point with maximum distance from the line segment
    // connecting the first and last points
    let maxDistance = 0;
    let maxIndex = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistance(points[i], start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            maxIndex = i;
        }
    }

    // If the maximum distance is greater than epsilon, recursively simplify
    if (maxDistance > epsilon) {
        // Recursively simplify the two segments
        const left = ramerDouglasPeucker(points.slice(0, maxIndex + 1), epsilon);
        const right = ramerDouglasPeucker(points.slice(maxIndex), epsilon);

        // Combine results (remove duplicate point at maxIndex)
        return [...left.slice(0, -1), ...right];
    } else {
        // All points are within epsilon, return just the endpoints
        return [start, end];
    }
}

/**
 * Calculate the perpendicular distance from a point to a line segment
 *
 * @param point - The point to measure from
 * @param lineStart - Start of the line segment
 * @param lineEnd - End of the line segment
 * @returns Perpendicular distance to the line segment
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    // If the line segment is actually a point, return distance to that point
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        const px = point.x - lineStart.x;
        const py = point.y - lineStart.y;
        return Math.sqrt(px * px + py * py);
    }

    // Calculate the perpendicular distance using the cross product formula
    // Distance = |cross product| / |line segment length|
    const numerator = Math.abs(
        (lineEnd.y - lineStart.y) * point.x -
        (lineEnd.x - lineStart.x) * point.y +
        lineEnd.x * lineStart.y -
        lineEnd.y * lineStart.x
    );

    return numerator / Math.sqrt(lengthSquared);
}

/**
 * Calculate the maximum perpendicular distance from original points
 * to the simplified polyline
 *
 * @param originalPoints - Original stroke points
 * @param simplified - Simplified polyline vertices
 * @returns Maximum perpendicular distance
 */
function calculateMaxError(originalPoints: Point[], simplified: Point[]): number {
    let maxError = 0;

    for (const point of originalPoints) {
        // Find the minimum distance to any segment in the simplified polyline
        let minDistance = Infinity;

        for (let i = 0; i < simplified.length - 1; i++) {
            const distance = perpendicularDistance(point, simplified[i], simplified[i + 1]);
            minDistance = Math.min(minDistance, distance);
        }

        maxError = Math.max(maxError, minDistance);
    }

    return maxError;
}

/**
 * Generate points along a polyline for rendering
 * This simply returns the vertices of the polyline
 *
 * @param vertices - Polyline vertices
 * @returns The same vertices (for consistency with other fitters)
 */
export function generatePolylinePoints(vertices: Point[]): Point[] {
    return vertices;
}
