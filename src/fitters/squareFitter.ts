/**
 * Rectangle/Square fitting algorithm
 *
 * Uses minimum area bounding box to find the best rectangle orientation
 */

import { Point } from '../eventHandler';
import { calculateShapeError } from './shapeError';

export interface RectangleFit {
    center: Point;
    width: number;     // Width (along major axis)
    height: number;    // Height (along minor axis)
    rotation: number;  // in radians
    error: number;     // Rectangle error (optimized width/height)
    squareError: number; // Square error (forced equal dimensions)
    squareness: number; // 1 - (min/max side length). 0 = perfect square, approaching 1 = very rectangular
}

/**
 * Fit a square to a set of points
 * Algorithm:
 * 1. Calculate centroid (geometric center)
 * 2. Try multiple rotation angles and find the one with minimum bounding box area
 * 3. Refine size and angle iteratively (constrained to square)
 *
 * @param points - Resampled stroke points
 * @returns Square fit parameters and error metric
 */
export function fitSquareConstrained(points: Point[]): { center: Point; size: number; rotation: number; error: number } | null {
    if (points.length < 4) {
        return null;
    }

    // Step 1: Calculate centroid
    let sumX = 0, sumY = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
    }
    const center: Point = { x: sumX / points.length, y: sumY / points.length };

    // Step 2: Find initial rotation using minimum bounding box
    const numAngles = 90;
    let bestRotation = 0;
    let bestSize = 0;
    let bestArea = Infinity;

    for (let i = 0; i < numAngles; i++) {
        const rotation = (i / numAngles) * (Math.PI / 2);
        const cos_theta = Math.cos(-rotation);
        const sin_theta = Math.sin(-rotation);

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of points) {
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            const x_rot = dx * cos_theta - dy * sin_theta;
            const y_rot = dx * sin_theta + dy * cos_theta;
            minX = Math.min(minX, x_rot);
            maxX = Math.max(maxX, x_rot);
            minY = Math.min(minY, y_rot);
            maxY = Math.max(maxY, y_rot);
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const size = Math.max(width, height); // Use max to ensure all points are inside
        const area = size * size;

        if (area < bestArea) {
            bestArea = area;
            bestRotation = rotation;
            bestSize = size;
        }
    }

    let size = bestSize;
    let rotation = bestRotation;

    // Step 3: Iterative refinement - alternate between size and angle
    const numOuterIterations = 3;
    const maxSizeSteps = 5;
    const maxAngleSteps = 5;

    for (let outerIter = 0; outerIter < numOuterIterations; outerIter++) {
        // Optimize size
        for (let sizeIter = 0; sizeIter < maxSizeSteps; sizeIter++) {
            const currentError = calculateRectangleError(points, center, size, size, rotation);
            const deltaSize = size * 0.01;
            const errorPlus = calculateRectangleError(points, center, size + deltaSize, size + deltaSize, rotation);
            const errorMinus = calculateRectangleError(points, center, size - deltaSize, size - deltaSize, rotation);

            if (errorPlus < currentError && errorPlus < errorMinus) {
                size += deltaSize;
            } else if (errorMinus < currentError) {
                size -= deltaSize;
            } else {
                break;
            }
        }

        // Optimize angle
        for (let angleIter = 0; angleIter < maxAngleSteps; angleIter++) {
            const currentError = calculateRectangleError(points, center, size, size, rotation);
            const deltaAngle = 0.01;
            const errorPlus = calculateRectangleError(points, center, size, size, rotation + deltaAngle);
            const errorMinus = calculateRectangleError(points, center, size, size, rotation - deltaAngle);

            if (errorPlus < currentError && errorPlus < errorMinus) {
                rotation += deltaAngle;
            } else if (errorMinus < currentError) {
                rotation -= deltaAngle;
            } else {
                break;
            }
        }
    }

    const error = calculateRectangleError(points, center, size, size, rotation);

    return { center, size, rotation, error };
}

/**
 * Fit a rectangle to a set of points using minimum area bounding box
 * Algorithm:
 * 1. Calculate centroid (geometric center)
 * 2. Try multiple rotation angles and find the one with minimum bounding box area
 * 3. Refine width, height, and angle iteratively
 *
 * @param points - Resampled stroke points
 * @returns Rectangle fit parameters and error metric
 */
export function fitSquare(points: Point[]): RectangleFit | null {
    if (points.length < 4) {
        return null;  // Need at least 4 points to fit a rectangle
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

    // Step 3: Initialize with bounding box dimensions
    let width = bestWidth;
    let height = bestHeight;
    let rotation = bestRotation;

    // Step 4: Iterative refinement - alternate between optimizing width, height, and angle
    const numOuterIterations = 3;
    const maxWidthSteps = 5;
    const maxHeightSteps = 5;
    const maxAngleSteps = 5;
    const epsilon = 0.001;

    for (let outerIter = 0; outerIter < numOuterIterations; outerIter++) {
        // Step 4a: Optimize width
        for (let widthIter = 0; widthIter < maxWidthSteps; widthIter++) {
            const currentError = calculateRectangleError(points, center, width, height, rotation);

            // Calculate numerical gradient with respect to width
            const deltaWidth = width * 0.01;
            const errorPlus = calculateRectangleError(points, center, width + deltaWidth, height, rotation);
            const errorMinus = calculateRectangleError(points, center, width - deltaWidth, height, rotation);
            const gradient = (errorPlus - errorMinus) / (2 * deltaWidth);

            // Gradient descent step
            const learningRate = 0.1;
            const newWidth = width - learningRate * gradient;

            // Only accept if it improves error
            const newError = calculateRectangleError(points, center, newWidth, height, rotation);
            if (newError < currentError) {
                width = newWidth;
                if (Math.abs(newError - currentError) < epsilon) {
                    break;
                }
            } else {
                break; // No improvement, stop width optimization
            }
        }

        // Step 4b: Optimize height
        for (let heightIter = 0; heightIter < maxHeightSteps; heightIter++) {
            const currentError = calculateRectangleError(points, center, width, height, rotation);

            // Calculate numerical gradient with respect to height
            const deltaHeight = height * 0.01;
            const errorPlus = calculateRectangleError(points, center, width, height + deltaHeight, rotation);
            const errorMinus = calculateRectangleError(points, center, width, height - deltaHeight, rotation);
            const gradient = (errorPlus - errorMinus) / (2 * deltaHeight);

            // Gradient descent step
            const learningRate = 0.1;
            const newHeight = height - learningRate * gradient;

            // Only accept if it improves error
            const newError = calculateRectangleError(points, center, width, newHeight, rotation);
            if (newError < currentError) {
                height = newHeight;
                if (Math.abs(newError - currentError) < epsilon) {
                    break;
                }
            } else {
                break; // No improvement, stop height optimization
            }
        }

        // Step 4c: Optimize rotation angle
        for (let angleIter = 0; angleIter < maxAngleSteps; angleIter++) {
            const currentError = calculateRectangleError(points, center, width, height, rotation);

            // Calculate numerical gradient with respect to rotation
            const deltaAngle = 0.01; // ~0.57 degrees
            const errorPlus = calculateRectangleError(points, center, width, height, rotation + deltaAngle);
            const errorMinus = calculateRectangleError(points, center, width, height, rotation - deltaAngle);
            const gradient = (errorPlus - errorMinus) / (2 * deltaAngle);

            // Gradient descent step
            const learningRate = 0.1;
            const newRotation = rotation - learningRate * gradient;

            // Only accept if it improves error
            const newError = calculateRectangleError(points, center, width, height, newRotation);
            if (newError < currentError) {
                rotation = newRotation;
                if (Math.abs(newError - currentError) < epsilon) {
                    break;
                }
            } else {
                break; // No improvement, stop angle optimization
            }
        }
    }

    // Calculate final error and squareness
    const error = calculateRectangleError(points, center, width, height, rotation);
    const minSide = Math.min(width, height);
    const maxSide = Math.max(width, height);
    const squareness = 1 - (minSide / maxSide);

    // Calculate square error using independent square fit
    const squareFit = fitSquareConstrained(points);
    const squareError = squareFit ? squareFit.error : error;

    return {
        center,
        width,
        height,
        rotation,
        error,
        squareError,
        squareness
    };
}

/**
 * Calculate error for a rectangle fit using bidirectional Hausdorff distance
 */
function calculateRectangleError(
    points: Point[],
    center: Point,
    width: number,
    height: number,
    rotation: number
): number {
    const distanceToRectangleFn = (p: Point) => distanceToRectangle(p, center, width, height, rotation);
    const rectangleSamplePoints = generateRectanglePoints(center, width, height, rotation, 64);
    return calculateShapeError(points, distanceToRectangleFn, rectangleSamplePoints);
}

/**
 * Calculate distance from a point to a rectangle
 */
function distanceToRectangle(
    p: Point,
    center: Point,
    width: number,
    height: number,
    rotation: number
): number {
    // Rotate point to rectangle's coordinate system
    const dx = p.x - center.x;
    const dy = p.y - center.y;

    const cos_theta = Math.cos(-rotation);
    const sin_theta = Math.sin(-rotation);

    const x_rot = dx * cos_theta - dy * sin_theta;
    const y_rot = dx * sin_theta + dy * cos_theta;

    // Half dimensions
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Clamp to rectangle boundary
    const closestX = Math.max(-halfWidth, Math.min(halfWidth, x_rot));
    const closestY = Math.max(-halfHeight, Math.min(halfHeight, y_rot));

    // If point is inside, find distance to nearest edge
    if (Math.abs(x_rot) <= halfWidth && Math.abs(y_rot) <= halfHeight) {
        const distToLeft = Math.abs(x_rot + halfWidth);
        const distToRight = Math.abs(x_rot - halfWidth);
        const distToTop = Math.abs(y_rot + halfHeight);
        const distToBottom = Math.abs(y_rot - halfHeight);
        return Math.min(distToLeft, distToRight, distToTop, distToBottom);
    }

    // Point is outside, calculate distance to closest point on boundary
    const distX = x_rot - closestX;
    const distY = y_rot - closestY;
    return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Generate points along a rectangle boundary
 *
 * @param center - Rectangle center
 * @param width - Rectangle width
 * @param height - Rectangle height
 * @param rotation - Rotation angle in radians
 * @param numPoints - Number of points to generate
 * @returns Array of points forming a rectangle
 */
export function generateRectanglePoints(
    center: Point,
    width: number,
    height: number,
    rotation: number,
    numPoints: number = 64
): Point[] {
    const points: Point[] = [];

    const cos_theta = Math.cos(rotation);
    const sin_theta = Math.sin(rotation);

    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Distribute points along the perimeter proportionally to side lengths
    const perimeter = 2 * (width + height);
    const pointsPerUnit = numPoints / perimeter;

    const pointsOnWidth = Math.max(1, Math.round(width * pointsPerUnit));
    const pointsOnHeight = Math.max(1, Math.round(height * pointsPerUnit));

    // Top edge (left to right)
    for (let i = 0; i < pointsOnWidth; i++) {
        const t = i / pointsOnWidth;
        const x_local = -halfWidth + t * width;
        const y_local = -halfHeight;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Right edge (top to bottom)
    for (let i = 0; i < pointsOnHeight; i++) {
        const t = i / pointsOnHeight;
        const x_local = halfWidth;
        const y_local = -halfHeight + t * height;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Bottom edge (right to left)
    for (let i = 0; i < pointsOnWidth; i++) {
        const t = i / pointsOnWidth;
        const x_local = halfWidth - t * width;
        const y_local = halfHeight;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    // Left edge (bottom to top)
    for (let i = 0; i < pointsOnHeight; i++) {
        const t = i / pointsOnHeight;
        const x_local = -halfWidth;
        const y_local = halfHeight - t * height;
        points.push({
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        });
    }

    return points;
}
