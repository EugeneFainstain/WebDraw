/**
 * Equilateral polygon fitting algorithm
 *
 * Takes a polyline (from RDP) and regularizes it into an equilateral polygon
 * (triangle, square, pentagon, hexagon, etc.) where all sides are equal length
 * and all vertices are evenly distributed around a center point.
 */

import { Point } from '../eventHandler';
import { fitPolyline } from './polylineFitter';
import { calculateShapeError } from './shapeError';

export interface EquilateralPolygonFit {
    vertices: Point[];       // Regular polygon vertices (n+1 points, first = last)
    center: Point;           // Geometric center
    radius: number;          // Distance from center to vertices
    rotation: number;        // Rotation angle in radians
    sides: number;           // Number of sides
    error: number;           // Fitting error
}

/**
 * Fit an equilateral polygon to a closed stroke
 *
 * @param points - Original stroke points
 * @param strokeWidth - Width of the stroke (for RDP epsilon)
 * @returns Equilateral polygon fit parameters
 */
export function fitEquilateralPolygon(
    points: Point[],
    strokeWidth: number
): EquilateralPolygonFit | null {
    if (points.length < 3) {
        return null;
    }

    // Step 0: Run RDP algorithm to get initial polyline
    const polylineFit = fitPolyline(points, strokeWidth);
    if (!polylineFit || polylineFit.segments < 3) {
        return null;
    }

    // Extract vertices (remove duplicate last point if closed)
    let vertices = [...polylineFit.points];
    const n = vertices.length;

    // Step 1: Close the shape by averaging first and last points
    const avgX = (vertices[0].x + vertices[n - 1].x) / 2;
    const avgY = (vertices[0].y + vertices[n - 1].y) / 2;
    vertices[0] = { x: avgX, y: avgY };
    vertices[n - 1] = { x: avgX, y: avgY };

    // Remove the duplicate last point for processing
    const workingVertices = vertices.slice(0, -1);
    const numSides = workingVertices.length;

    // Step 2: Calculate geometric center
    let centerX = 0, centerY = 0;
    for (const v of workingVertices) {
        centerX += v.x;
        centerY += v.y;
    }
    centerX /= numSides;
    centerY /= numSides;
    let center: Point = { x: centerX, y: centerY };

    // Step 3: Make all vertices equidistant from center (average radius)
    let totalRadius = 0;
    for (const v of workingVertices) {
        const dx = v.x - center.x;
        const dy = v.y - center.y;
        totalRadius += Math.sqrt(dx * dx + dy * dy);
    }
    let radius = totalRadius / numSides;

    // Step 4: Distribute vertices at equal angles
    // Use the first vertex as reference for rotation
    const firstDx = workingVertices[0].x - center.x;
    const firstDy = workingVertices[0].y - center.y;
    let rotation = Math.atan2(firstDy, firstDx);

    // Create regular polygon with current parameters
    let regularVertices = generateRegularPolygon(center, radius, rotation, numSides);

    // Step 5: Iterative refinement
    // We're fitting the regular polygon to the RDP vertices (not original stroke)
    const rdpVertices = workingVertices;

    // 3 loops of alternating size and angle optimization
    for (let loop = 0; loop < 3; loop++) {
        // 5 steps of size optimization (1D)
        for (let step = 0; step < 5; step++) {
            const currentError = calculatePolygonError(rdpVertices, regularVertices);

            // Try slightly larger and smaller radii
            const delta = radius * 0.02;
            const largerVertices = generateRegularPolygon(center, radius + delta, rotation, numSides);
            const smallerVertices = generateRegularPolygon(center, radius - delta, rotation, numSides);

            const largerError = calculatePolygonError(rdpVertices, largerVertices);
            const smallerError = calculatePolygonError(rdpVertices, smallerVertices);

            // Move in the direction that reduces error
            if (largerError < currentError && largerError < smallerError) {
                radius += delta;
                regularVertices = largerVertices;
            } else if (smallerError < currentError) {
                radius -= delta;
                regularVertices = smallerVertices;
            } else {
                break; // No improvement
            }
        }

        // 5 steps of angle optimization (1D)
        for (let step = 0; step < 5; step++) {
            const currentError = calculatePolygonError(rdpVertices, regularVertices);

            // Try slightly rotated angles
            const angleDelta = (2 * Math.PI / numSides) * 0.02; // 2% of one segment angle
            const cwVertices = generateRegularPolygon(center, radius, rotation + angleDelta, numSides);
            const ccwVertices = generateRegularPolygon(center, radius, rotation - angleDelta, numSides);

            const cwError = calculatePolygonError(rdpVertices, cwVertices);
            const ccwError = calculatePolygonError(rdpVertices, ccwVertices);

            // Move in the direction that reduces error
            if (cwError < currentError && cwError < ccwError) {
                rotation += angleDelta;
                regularVertices = cwVertices;
            } else if (ccwError < currentError) {
                rotation -= angleDelta;
                regularVertices = ccwVertices;
            } else {
                break; // No improvement
            }
        }
    }

    // Add the duplicate last point to close the polygon
    const finalVertices = [...regularVertices, regularVertices[0]];

    // Calculate final error against original stroke points
    const finalError = calculateFinalError(points, finalVertices);

    return {
        vertices: finalVertices,
        center,
        radius,
        rotation,
        sides: numSides,
        error: finalError
    };
}

/**
 * Generate vertices of a regular polygon
 */
function generateRegularPolygon(
    center: Point,
    radius: number,
    rotation: number,
    numSides: number
): Point[] {
    const vertices: Point[] = [];
    const angleStep = (2 * Math.PI) / numSides;

    for (let i = 0; i < numSides; i++) {
        const angle = rotation + i * angleStep;
        vertices.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
    }

    return vertices;
}

/**
 * Calculate error between RDP vertices and regular polygon vertices
 * Uses simple sum of squared distances
 */
function calculatePolygonError(rdpVertices: Point[], regularVertices: Point[]): number {
    let totalError = 0;

    for (let i = 0; i < rdpVertices.length; i++) {
        const dx = rdpVertices[i].x - regularVertices[i].x;
        const dy = rdpVertices[i].y - regularVertices[i].y;
        totalError += dx * dx + dy * dy;
    }

    return totalError;
}

/**
 * Calculate final error against original stroke points
 * Uses bidirectional distance metric (similar to other fitters)
 */
function calculateFinalError(originalPoints: Point[], polygonVertices: Point[]): number {
    // Distance from point to polygon edge
    const distanceToPolygonFn = (p: Point) => {
        let minDist = Infinity;

        // Check distance to each edge
        for (let i = 0; i < polygonVertices.length - 1; i++) {
            const dist = perpendicularDistance(p, polygonVertices[i], polygonVertices[i + 1]);
            minDist = Math.min(minDist, dist);
        }

        return minDist;
    };

    return calculateShapeError(originalPoints, distanceToPolygonFn, polygonVertices);
}

/**
 * Calculate perpendicular distance from a point to a line segment
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        const px = point.x - lineStart.x;
        const py = point.y - lineStart.y;
        return Math.sqrt(px * px + py * py);
    }

    const numerator = Math.abs(
        (lineEnd.y - lineStart.y) * point.x -
        (lineEnd.x - lineStart.x) * point.y +
        lineEnd.x * lineStart.y -
        lineEnd.y * lineStart.x
    );

    return numerator / Math.sqrt(lengthSquared);
}

/**
 * Generate points along an equilateral polygon for rendering
 */
export function generateEquilateralPolygonPoints(
    center: Point,
    radius: number,
    rotation: number,
    numSides: number
): Point[] {
    const vertices = generateRegularPolygon(center, radius, rotation, numSides);
    // Add duplicate last point to close the polygon
    return [...vertices, vertices[0]];
}
