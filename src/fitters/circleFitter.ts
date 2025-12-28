/**
 * Circle and Ellipse fitting algorithms
 *
 * Uses least squares fitting to find the best circle or ellipse
 * that approximates a set of points
 */

import { Point } from '../eventHandler';

export interface CircleFit {
    center: Point;
    radius: number;
    error: number;  // Mean squared error
}

export interface EllipseFit {
    center: Point;
    radiusX: number;
    radiusY: number;
    rotation: number;  // in radians
    error: number;
}

/**
 * Fit a circle to a set of points using algebraic least squares
 * Based on the Pratt method
 *
 * @param points - Resampled stroke points
 * @returns Circle fit parameters and error metric
 */
export function fitCircle(points: Point[]): CircleFit | null {
    if (points.length < 3) {
        return null;
    }

    const n = points.length;

    // Calculate means
    let sumX = 0, sumY = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    // Center the points
    const centered = points.map(p => ({
        x: p.x - meanX,
        y: p.y - meanY
    }));

    // Build the matrix for least squares
    let Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0, Mzz = 0;

    for (const p of centered) {
        const zi = p.x * p.x + p.y * p.y;
        Mxx += p.x * p.x;
        Myy += p.y * p.y;
        Mxy += p.x * p.y;
        Mxz += p.x * zi;
        Myz += p.y * zi;
        Mzz += zi * zi;
    }

    Mxx /= n;
    Myy /= n;
    Mxy /= n;
    Mxz /= n;
    Myz /= n;
    Mzz /= n;

    // Construct the coefficient matrix
    const Mz = Mxx + Myy;
    const Cov_xy = Mxx * Myy - Mxy * Mxy;
    const Var_z = Mzz - Mz * Mz;

    const A2 = 4 * Cov_xy - 3 * Mz * Mz - Mzz;
    const A1 = Var_z * Mz + 4 * Cov_xy * Mz - Mxz * Mxz - Myz * Myz;
    const A0 = Mxz * (Mxz * Myy - Myz * Mxy) + Myz * (Myz * Mxx - Mxz * Mxy) - Var_z * Cov_xy;
    const A22 = A2 + A2;

    // Solve for the positive root
    const epsilon = 1e-12;
    let Y = A0;
    let X = 0;

    // Newton's method
    for (let iter = 0; iter < 20; iter++) {
        const Dy = A1 + X * (A22 + 16 * X * X);
        const xnew = X - Y / Dy;
        if (Math.abs(xnew - X) < epsilon) {
            break;
        }
        Y = A0 + xnew * (A1 + xnew * (A2 + 4 * xnew * xnew));
        X = xnew;
    }

    // Calculate circle parameters
    const det = X * X - X * Mz + Cov_xy;
    const centerX = (Mxz * (Myy - X) - Myz * Mxy) / det / 2;
    const centerY = (Myz * (Mxx - X) - Mxz * Mxy) / det / 2;

    // Convert back to original coordinate system
    const center = {
        x: centerX + meanX,
        y: centerY + meanY
    };

    const radius = Math.sqrt(centerX * centerX + centerY * centerY + Mz + 2 * X);

    // Calculate error (mean squared distance from circle)
    let errorSum = 0;
    for (const p of points) {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const err = dist - radius;
        errorSum += err * err;
    }
    const error = errorSum / n;

    return { center, radius, error };
}

/**
 * Generate points along a circle
 *
 * @param center - Circle center
 * @param radius - Circle radius
 * @param numPoints - Number of points to generate
 * @returns Array of points forming a circle
 */
export function generateCirclePoints(center: Point, radius: number, numPoints: number = 64): Point[] {
    const points: Point[] = [];

    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        points.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
    }

    return points;
}

/**
 * Check if a stroke is mostly closed
 * A stroke is considered closed if the distance between start and end
 * is less than 15% of the bounding box's largest dimension
 */
export function isMostlyClosed(points: Point[]): { closed: boolean; distance: number; threshold: number; maxDim: number } {
    if (points.length < 3) {
        return { closed: false, distance: 0, threshold: 0, maxDim: 0 };
    }

    // Get bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const maxDimension = Math.max(width, height);

    // Distance between start and end
    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const closureDistance = Math.sqrt(dx * dx + dy * dy);

    const threshold = 0.15 * maxDimension;  // Increased to 15%
    const closed = closureDistance < threshold;

    return { closed, distance: closureDistance, threshold, maxDim: maxDimension };
}
