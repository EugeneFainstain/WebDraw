/**
 * Square fitting algorithm
 *
 * Uses minimum area bounding box to find the best square orientation
 */

import { Point } from '../eventHandler';
import { calculateShapeError } from './shapeError';

export interface SquareFit {
    center: Point;
    sideLength: number; // Side length of the square
    rotation: number;   // in radians
    error: number;      // Mean squared error
}

/**
 * Fit a square to a set of points using minimum area bounding box
 * Algorithm:
 * 1. Calculate centroid (geometric center)
 * 2. Try multiple rotation angles and find the one with minimum bounding box area
 * 3. Use the average of width and height as the side length
 *
 * @param points - Resampled stroke points
 * @returns Square fit parameters and error metric
 */
export function fitSquare(points: Point[]): SquareFit | null {
    if (points.length < 4) {
        return null;  // Need at least 4 points to fit a square
    }

    // Step 1: Calculate the centroid (geometric center) of all points
    let sumX = 0, sumY = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
    }
    const center: Point = { x: sumX / points.length, y: sumY / points.length };

    // Step 2: Search for the rotation angle that minimizes bounding box area
    // Try angles from 0 to 90 degrees (since squares have 4-fold symmetry)
    const numAngles = 90; // Try every degree
    let bestRotation = 0;
    let bestArea = Infinity;
    let bestWidth = 0;
    let bestHeight = 0;

    for (let i = 0; i < numAngles; i++) {
        const rotation = (i / numAngles) * (Math.PI / 2); // 0 to 90 degrees
        const cos_theta = Math.cos(-rotation);
        const sin_theta = Math.sin(-rotation);

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of points) {
            const dx = p.x - center.x;
            const dy = p.y - center.y;

            // Rotate to test coordinate system
            const x_rot = dx * cos_theta - dy * sin_theta;
            const y_rot = dx * sin_theta + dy * cos_theta;

            minX = Math.min(minX, x_rot);
            maxX = Math.max(maxX, x_rot);
            minY = Math.min(minY, y_rot);
            maxY = Math.max(maxY, y_rot);
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const area = width * height;

        if (area < bestArea) {
            bestArea = area;
            bestRotation = rotation;
            bestWidth = width;
            bestHeight = height;
        }
    }

    // Step 3: Use the average of width and height as the side length for a square
    const sideLength = (bestWidth + bestHeight) / 2;

    // Calculate error using bidirectional Hausdorff distance
    const distanceToSquareFn = (p: Point) => distanceToSquare(p, center, sideLength, bestRotation);

    // Generate sample points on the square boundary
    const squareSamplePoints = generateSquarePoints(center, sideLength, bestRotation, 64);

    const error = calculateShapeError(points, distanceToSquareFn, squareSamplePoints);

    return {
        center,
        sideLength,
        rotation: bestRotation,
        error
    };
}

/**
 * Calculate distance from a point to a square
 */
function distanceToSquare(
    p: Point,
    center: Point,
    sideLength: number,
    rotation: number
): number {
    // Rotate point to square's coordinate system
    const dx = p.x - center.x;
    const dy = p.y - center.y;

    const cos_theta = Math.cos(-rotation);
    const sin_theta = Math.sin(-rotation);

    const x_rot = dx * cos_theta - dy * sin_theta;
    const y_rot = dx * sin_theta + dy * cos_theta;

    // Half side length
    const halfSide = sideLength / 2;

    // Clamp to square boundary
    const closestX = Math.max(-halfSide, Math.min(halfSide, x_rot));
    const closestY = Math.max(-halfSide, Math.min(halfSide, y_rot));

    // If point is inside, find distance to nearest edge
    if (Math.abs(x_rot) <= halfSide && Math.abs(y_rot) <= halfSide) {
        const distToLeft = Math.abs(x_rot + halfSide);
        const distToRight = Math.abs(x_rot - halfSide);
        const distToTop = Math.abs(y_rot + halfSide);
        const distToBottom = Math.abs(y_rot - halfSide);
        return Math.min(distToLeft, distToRight, distToTop, distToBottom);
    }

    // Point is outside, calculate distance to closest point on boundary
    const distX = x_rot - closestX;
    const distY = y_rot - closestY;
    return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Generate points along a square boundary
 *
 * @param center - Square center
 * @param sideLength - Square side length
 * @param rotation - Rotation angle in radians
 * @param numPoints - Number of points to generate
 * @returns Array of points forming a square
 */
export function generateSquarePoints(
    center: Point,
    sideLength: number,
    rotation: number,
    numPoints: number = 64
): Point[] {
    const points: Point[] = [];

    const cos_theta = Math.cos(rotation);
    const sin_theta = Math.sin(rotation);

    const halfSide = sideLength / 2;

    // Distribute points evenly along all 4 edges
    const pointsPerEdge = Math.floor(numPoints / 4);

    // Top edge (left to right)
    for (let i = 0; i < pointsPerEdge; i++) {
        const t = i / pointsPerEdge;
        const x_local = -halfSide + t * sideLength;
        const y_local = -halfSide;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Right edge (top to bottom)
    for (let i = 0; i < pointsPerEdge; i++) {
        const t = i / pointsPerEdge;
        const x_local = halfSide;
        const y_local = -halfSide + t * sideLength;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Bottom edge (right to left)
    for (let i = 0; i < pointsPerEdge; i++) {
        const t = i / pointsPerEdge;
        const x_local = halfSide - t * sideLength;
        const y_local = halfSide;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Left edge (bottom to top)
    for (let i = 0; i < pointsPerEdge; i++) {
        const t = i / pointsPerEdge;
        const x_local = -halfSide;
        const y_local = halfSide - t * sideLength;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    return points;
}
