/**
 * Ellipse fitting algorithm
 *
 * Uses direct least squares fitting of ellipses
 * Based on the Fitzgibbon method (1999)
 */

import { Point } from '../eventHandler';

export interface EllipseFit {
    center: Point;
    radiusX: number;
    radiusY: number;
    rotation: number;  // in radians
    error: number;     // Mean squared error
    debugInfo?: {
        radiusXBefore: number;
        radiusXAfter: number;
        errorBefore: number;
        errorAfter: number;
    };
}

/**
 * Fit an ellipse to a set of points using PCA + variance
 * Algorithm:
 * 1. Calculate centroid (geometric center)
 * 2. Calculate principal axis via PCA
 * 3. Calculate radii from eigenvalues of covariance matrix
 *
 * @param points - Resampled stroke points
 * @returns Ellipse fit parameters and error metric
 */
export function fitEllipse(points: Point[]): EllipseFit | null {
    if (points.length < 5) {
        return null;  // Need at least 5 points to fit an ellipse
    }

    // Step 1: Calculate the centroid (geometric center) of all points
    // This is the true center of the ellipse
    let sumX = 0, sumY = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
    }
    const center: Point = { x: sumX / points.length, y: sumY / points.length };

    // Step 2: Calculate principal axis using PCA
    let sumXX = 0, sumYY = 0, sumXY = 0;
    for (const p of points) {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        sumXX += dx * dx;
        sumYY += dy * dy;
        sumXY += dx * dy;
    }

    sumXX /= points.length;
    sumYY /= points.length;
    sumXY /= points.length;

    // Calculate rotation angle from covariance matrix
    let rotation = 0;
    if (Math.abs(sumXY) > 1e-10) {
        rotation = 0.5 * Math.atan2(2 * sumXY, sumXX - sumYY);
    }

    // Step 3: Calculate radii from variance along principal axes
    // The eigenvalues of the covariance matrix give us the variance along principal axes
    // For a 2x2 covariance matrix, eigenvalues are:
    // λ = (sumXX + sumYY)/2 ± sqrt(((sumXX - sumYY)/2)^2 + sumXY^2)

    const trace = sumXX + sumYY;
    const det = sumXX * sumYY - sumXY * sumXY;
    const discriminant = Math.sqrt((trace * trace) / 4 - det);

    const lambda1 = trace / 2 + discriminant;  // Larger eigenvalue (major axis variance)
    const lambda2 = trace / 2 - discriminant;  // Smaller eigenvalue (minor axis variance)

    // Radius = sqrt(variance) * scale factor
    // For an ellipse with uniform point distribution, sqrt(variance) ≈ radius/sqrt(2)
    // So radius ≈ sqrt(variance) * sqrt(2)
    const scaleFactor = Math.sqrt(2);

    let radiusX = Math.sqrt(Math.abs(lambda1)) * scaleFactor;
    let radiusY = Math.sqrt(Math.abs(lambda2)) * scaleFactor;

    // Ensure radiusX >= radiusY by convention
    if (radiusX < radiusY) {
        const temp = radiusX;
        radiusX = radiusY;
        radiusY = temp;
        rotation += Math.PI / 2;
    }

    // Step 4: Refine radiusX using 1D gradient descent with max error
    // This helps with highly eccentric ellipses where the initial guess underestimates
    const errorBeforeOptimization = calculateEllipseError(points, center, radiusX, radiusY, rotation);
    const radiusXBefore = radiusX;

    const maxIterations = 20;
    const learningRate = 0.5;
    const epsilon = 0.01;

    for (let iter = 0; iter < maxIterations; iter++) {
        const currentError = calculateEllipseMaxError(points, center, radiusX, radiusY, rotation);

        // Calculate numerical gradient with respect to radiusX
        const deltaRx = radiusX * 0.01;
        const errorPlus = calculateEllipseMaxError(points, center, radiusX + deltaRx, radiusY, rotation);
        const errorMinus = calculateEllipseMaxError(points, center, radiusX - deltaRx, radiusY, rotation);
        const gradient = (errorPlus - errorMinus) / (2 * deltaRx);

        // Update radiusX (with constraint: must stay >= radiusY)
        const newRadiusX = radiusX - learningRate * gradient;
        radiusX = Math.max(newRadiusX, radiusY);

        // Check for convergence
        const newError = calculateEllipseMaxError(points, center, radiusX, radiusY, rotation);
        if (Math.abs(newError - currentError) < epsilon) {
            break;
        }
    }

    const finalError = calculateEllipseError(points, center, radiusX, radiusY, rotation);

    return {
        center,
        radiusX,
        radiusY,
        rotation,
        error: finalError,
        debugInfo: {
            radiusXBefore,
            radiusXAfter: radiusX,
            errorBefore: errorBeforeOptimization,
            errorAfter: finalError
        }
    };
}

/**
 * Calculate maximum error for an ellipse fit (for optimization)
 * Uses bidirectional distance to prevent degenerate fits
 */
function calculateEllipseMaxError(
    points: Point[],
    center: Point,
    radiusX: number,
    radiusY: number,
    rotation: number
): number {
    const ellipse = { center, radiusX, radiusY, rotation };

    // Direction 1: Stroke points to ellipse - take max
    let maxStrokeToEllipse = 0;
    for (const p of points) {
        const dist = distanceToEllipse(p, ellipse);
        maxStrokeToEllipse = Math.max(maxStrokeToEllipse, dist * dist);
    }

    // Direction 2: Ellipse to stroke points - take max
    const numSamples = 64;
    let maxEllipseToStroke = 0;

    for (let i = 0; i < numSamples; i++) {
        const angle = (i / numSamples) * 2 * Math.PI;

        // Point on ellipse in local coordinates
        const x_local = radiusX * Math.cos(angle);
        const y_local = radiusY * Math.sin(angle);

        // Rotate to world coordinates
        const cos_theta = Math.cos(rotation);
        const sin_theta = Math.sin(rotation);
        const ellipsePoint: Point = {
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        };

        // Find closest stroke point
        let minDist = Infinity;
        for (const p of points) {
            const dx = p.x - ellipsePoint.x;
            const dy = p.y - ellipsePoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
        }

        maxEllipseToStroke = Math.max(maxEllipseToStroke, minDist * minDist);
    }

    // Return max of both directions
    return Math.max(maxStrokeToEllipse, maxEllipseToStroke);
}

/**
 * Calculate mean squared error for an ellipse fit using bidirectional distance
 * This prevents degenerate fits (e.g., huge ellipse fitting a small curve)
 */
function calculateEllipseError(
    points: Point[],
    center: Point,
    radiusX: number,
    radiusY: number,
    rotation: number
): number {
    const ellipse = { center, radiusX, radiusY, rotation };

    // Direction 1: Stroke points to ellipse
    let strokeToEllipseError = 0;
    for (const p of points) {
        const dist = distanceToEllipse(p, ellipse);
        strokeToEllipseError += dist * dist;
    }
    strokeToEllipseError /= points.length;

    // Direction 2: Ellipse to stroke points
    // Sample points uniformly along the ellipse
    const numSamples = 64;
    let ellipseToStrokeError = 0;

    for (let i = 0; i < numSamples; i++) {
        const angle = (i / numSamples) * 2 * Math.PI;

        // Point on ellipse in local coordinates
        const x_local = radiusX * Math.cos(angle);
        const y_local = radiusY * Math.sin(angle);

        // Rotate to world coordinates
        const cos_theta = Math.cos(rotation);
        const sin_theta = Math.sin(rotation);
        const ellipsePoint: Point = {
            x: center.x + x_local * cos_theta - y_local * sin_theta,
            y: center.y + x_local * sin_theta + y_local * cos_theta
        };

        // Find closest stroke point
        let minDist = Infinity;
        for (const p of points) {
            const dx = p.x - ellipsePoint.x;
            const dy = p.y - ellipsePoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
        }

        ellipseToStrokeError += minDist * minDist;
    }
    ellipseToStrokeError /= numSamples;

    // Return average of both directions
    return (strokeToEllipseError + ellipseToStrokeError) / 2;
}

/**
 * Solve the generalized eigensystem for ellipse fitting
 * Using direct least squares with constraint
 */
function solveEllipseSystem(S: number[][], C: number[][]): number[] | null {
    // Partition the scatter matrix
    // S = [S1  S2]
    //     [S2T S3]
    // where S1 is 3x3, S2 is 3x3, S3 is 3x3

    const S1: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    const S2: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    const S3: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));

    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            S1[i][j] = S[i][j];
            S2[i][j] = S[i][j + 3];
            S3[i][j] = S[i + 3][j + 3];
        }
    }

    // Constraint matrix C1 (3x3 upper-left block)
    const C1: number[][] = [
        [0, 0, 2],
        [0, -1, 0],
        [2, 0, 0]
    ];

    // Invert S3 (using simple 3x3 inversion)
    const S3inv = invert3x3(S3);
    if (!S3inv) {
        return null;
    }

    // Compute T = S1 - S2 * S3^-1 * S2^T
    const S2S3inv = matMul3x3(S2, S3inv);
    const S2S3invS2T = matMul3x3(S2S3inv, transpose3x3(S2));
    const T: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            T[i][j] = S1[i][j] - S2S3invS2T[i][j];
        }
    }

    // Solve C1^-1 * T * a1 = lambda * a1
    const C1inv = invert3x3(C1);
    if (!C1inv) {
        return null;
    }

    const M = matMul3x3(C1inv, T);

    // Find eigenvector of M with smallest positive eigenvalue
    // Simplified: use characteristic equation for 3x3
    const a1 = findSmallestEigenvector3x3(M);
    if (!a1) {
        return null;
    }

    // Compute a2 = -S3^-1 * S2^T * a1
    const S2T = transpose3x3(S2);
    const S2Ta1 = vecMul3x3(S2T, a1);
    const a2 = vecMul3x3(S3inv, S2Ta1);
    for (let i = 0; i < 3; i++) {
        a2[i] = -a2[i];
    }

    // Combine a1 and a2
    const a = [...a1, ...a2];

    // Ensure the constraint 4AC - B^2 > 0 (ellipse condition)
    const A_coeff = a[0], B_coeff = a[1], C_coeff = a[2];
    if (4 * A_coeff * C_coeff - B_coeff * B_coeff <= 0) {
        return null;
    }

    return a;
}

// Helper: 3x3 matrix inversion
function invert3x3(m: number[][]): number[][] | null {
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    if (Math.abs(det) < 1e-10) {
        return null;
    }

    const inv: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    inv[0][0] = (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det;
    inv[0][1] = (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det;
    inv[0][2] = (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det;
    inv[1][0] = (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det;
    inv[1][1] = (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det;
    inv[1][2] = (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det;
    inv[2][0] = (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det;
    inv[2][1] = (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det;
    inv[2][2] = (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det;

    return inv;
}

// Helper: 3x3 matrix multiplication
function matMul3x3(a: number[][], b: number[][]): number[][] {
    const result: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            for (let k = 0; k < 3; k++) {
                result[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    return result;
}

// Helper: 3x3 matrix transpose
function transpose3x3(m: number[][]): number[][] {
    const result: number[][] = Array(3).fill(0).map(() => Array(3).fill(0));
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            result[i][j] = m[j][i];
        }
    }
    return result;
}

// Helper: 3x3 matrix * vector
function vecMul3x3(m: number[][], v: number[]): number[] {
    const result: number[] = Array(3).fill(0);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            result[i] += m[i][j] * v[j];
        }
    }
    return result;
}

// Helper: Find eigenvector with smallest positive eigenvalue
function findSmallestEigenvector3x3(m: number[][]): number[] | null {
    // Use power iteration on the smallest eigenvalue
    // For simplicity, use the fact that for ellipse fitting,
    // we want the eigenvector corresponding to smallest eigenvalue

    // Start with a guess
    let v = [1, 1, 1];

    // Normalize
    let norm = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    v = [v[0]/norm, v[1]/norm, v[2]/norm];

    // Inverse power iteration for smallest eigenvalue
    for (let iter = 0; iter < 50; iter++) {
        const minv = invert3x3(m);
        if (!minv) {
            return null;
        }

        const vnew = vecMul3x3(minv, v);
        norm = Math.sqrt(vnew[0]*vnew[0] + vnew[1]*vnew[1] + vnew[2]*vnew[2]);

        if (norm < 1e-10) {
            return null;
        }

        for (let i = 0; i < 3; i++) {
            vnew[i] /= norm;
        }

        // Check convergence
        const diff = Math.sqrt(
            (vnew[0]-v[0])*(vnew[0]-v[0]) +
            (vnew[1]-v[1])*(vnew[1]-v[1]) +
            (vnew[2]-v[2])*(vnew[2]-v[2])
        );

        v = vnew;

        if (diff < 1e-8) {
            break;
        }
    }

    return v;
}

/**
 * Extract ellipse parameters from conic coefficients
 * Conic equation: Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0
 */
function extractEllipseParameters(A: number, B: number, C: number, D: number, E: number, F: number): { center: Point; radiusX: number; radiusY: number; rotation: number } | null {
    // Check ellipse constraint
    const delta = B * B - 4 * A * C;
    if (delta >= 0) {
        return null;  // Not an ellipse (parabola or hyperbola)
    }

    // Calculate center
    const cx = (2 * C * D - B * E) / delta;
    const cy = (2 * A * E - B * D) / delta;

    // Calculate rotation angle
    let theta = 0;
    if (Math.abs(B) > 1e-10) {
        theta = Math.atan2(B, A - C) / 2;
    }

    // Calculate the discriminant for axis computation
    const num = 2 * (A * E * E + C * D * D - B * D * E + delta * F);
    const fac = Math.sqrt((A - C) * (A - C) + B * B);

    const ap = A + C + fac;
    const am = A + C - fac;

    // Check for validity
    if (num * ap >= 0 || num * am >= 0) {
        return null;  // Invalid configuration
    }

    const radiusX = Math.sqrt(Math.abs(num / ap));
    const radiusY = Math.sqrt(Math.abs(num / am));

    if (!isFinite(radiusX) || !isFinite(radiusY) || radiusX <= 0 || radiusY <= 0) {
        return null;
    }

    // Ensure radiusX >= radiusY by convention
    if (radiusX < radiusY) {
        return {
            center: { x: cx, y: cy },
            radiusX: radiusY,
            radiusY: radiusX,
            rotation: theta + Math.PI / 2
        };
    }

    return {
        center: { x: cx, y: cy },
        radiusX,
        radiusY,
        rotation: theta
    };
}

/**
 * Calculate distance from a point to an ellipse using gradient descent
 * to find the closest point on the ellipse boundary
 */
function distanceToEllipse(p: Point, ellipse: { center: Point; radiusX: number; radiusY: number; rotation: number }): number {
    // Rotate point to ellipse's coordinate system
    const dx = p.x - ellipse.center.x;
    const dy = p.y - ellipse.center.y;

    const cos_theta = Math.cos(-ellipse.rotation);
    const sin_theta = Math.sin(-ellipse.rotation);

    const x_rot = dx * cos_theta - dy * sin_theta;
    const y_rot = dx * sin_theta + dy * cos_theta;

    // Find the closest point on the ellipse using parametric angle
    // Ellipse parametric form: (a*cos(t), b*sin(t))
    const a = ellipse.radiusX;
    const b = ellipse.radiusY;

    // Initial guess: angle from center to point
    let t = Math.atan2(y_rot / b, x_rot / a);

    // Gradient descent to find closest point
    const maxIter = 10;
    const learningRate = 0.5;

    for (let iter = 0; iter < maxIter; iter++) {
        // Point on ellipse at parameter t
        const ex = a * Math.cos(t);
        const ey = b * Math.sin(t);

        // Vector from ellipse point to target point
        const vx = x_rot - ex;
        const vy = y_rot - ey;

        // Tangent vector to ellipse at t
        const tx = -a * Math.sin(t);
        const ty = b * Math.cos(t);

        // Gradient: dot product of (p - ellipse_point) and tangent
        const gradient = vx * tx + vy * ty;

        // Update parameter
        t += learningRate * gradient / (tx * tx + ty * ty + 1e-10);

        // Convergence check
        if (Math.abs(gradient) < 1e-6) {
            break;
        }
    }

    // Calculate final distance
    const ex = a * Math.cos(t);
    const ey = b * Math.sin(t);
    const dist = Math.sqrt((x_rot - ex) * (x_rot - ex) + (y_rot - ey) * (y_rot - ey));

    return dist;
}

/**
 * Generate points along an ellipse
 *
 * @param center - Ellipse center
 * @param radiusX - Semi-major axis
 * @param radiusY - Semi-minor axis
 * @param rotation - Rotation angle in radians
 * @param numPoints - Number of points to generate
 * @returns Array of points forming an ellipse
 */
export function generateEllipsePoints(center: Point, radiusX: number, radiusY: number, rotation: number, numPoints: number = 64): Point[] {
    const points: Point[] = [];

    const cos_theta = Math.cos(rotation);
    const sin_theta = Math.sin(rotation);

    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;

        // Point on standard ellipse
        const x_ellipse = radiusX * Math.cos(angle);
        const y_ellipse = radiusY * Math.sin(angle);

        // Rotate and translate
        points.push({
            x: center.x + x_ellipse * cos_theta - y_ellipse * sin_theta,
            y: center.y + x_ellipse * sin_theta + y_ellipse * cos_theta
        });
    }

    return points;
}
