/**
 * Equilateral polygon and star fitting algorithm
 *
 * Takes a polyline (from RDP) and regularizes it into:
 * 1. Equilateral polygons (all vertices at same distance from center)
 * 2. Non-self-crossing stars (starfish-like, with alternating radii)
 * 3. Self-crossing stars (pentagram-like, with alternating radii)
 */

import { Point } from '../eventHandler';
import { fitPolyline } from './polylineFitter';
import { calculateShapeError } from './shapeError';

export type ShapeType = 'polygon' | 'star' | 'self-crossing-star';

export interface EquilateralPolygonFit {
    vertices: Point[];       // Regular polygon/star vertices (n+1 points, first = last)
    center: Point;           // Geometric center
    radius: number;          // Distance from center to vertices (outer radius for stars)
    innerRadius?: number;    // Inner radius for stars (undefined for polygons)
    rotation: number;        // Rotation angle in radians
    sides: number;           // Number of sides (for polygons) or points (for stars)
    shapeType: ShapeType;    // Type of shape detected
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
    const numVertices = workingVertices.length;

    // Step 2: Calculate geometric center
    let centerX = 0, centerY = 0;
    for (const v of workingVertices) {
        centerX += v.x;
        centerY += v.y;
    }
    centerX /= numVertices;
    centerY /= numVertices;
    let center: Point = { x: centerX, y: centerY };

    // Step 3: Analyze vertex distances from center
    const distances = workingVertices.map(v => {
        const dx = v.x - center.x;
        const dy = v.y - center.y;
        return Math.sqrt(dx * dx + dy * dy);
    });

    // Step 4: Classify shape type based on distance distribution
    const classification = classifyShape(distances, workingVertices, center);

    // Step 5: Generate initial shape based on classification
    let regularVertices: Point[];
    let radius: number;
    let innerRadius: number | undefined;
    let rotation: number;
    let numSides: number;

    if (classification.type === 'polygon') {
        // All vertices at same distance
        radius = classification.outerRadius;
        innerRadius = undefined;
        numSides = numVertices;

        // Use the first vertex as reference for rotation
        const firstDx = workingVertices[0].x - center.x;
        const firstDy = workingVertices[0].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        regularVertices = generateRegularPolygon(center, radius, rotation, numSides);
    } else {
        // Star shape (self-crossing or non-self-crossing)
        radius = classification.outerRadius;
        innerRadius = classification.innerRadius!; // Must be defined for stars
        numSides = numVertices / 2; // Number of points on the star

        // Use the first outer vertex as reference for rotation
        const firstOuterIdx = classification.outerIndices[0];
        const firstDx = workingVertices[firstOuterIdx].x - center.x;
        const firstDy = workingVertices[firstOuterIdx].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        const isSelfCrossing = classification.type === 'self-crossing-star';
        regularVertices = generateRegularStar(center, radius, innerRadius, rotation, numSides, isSelfCrossing);
    }

    // Step 6: Iterative refinement
    // We're fitting the regular shape to the RDP vertices (not original stroke)
    const rdpVertices = workingVertices;

    // 3 loops of alternating optimizations
    for (let loop = 0; loop < 3; loop++) {
        // 5 steps of outer radius optimization (1D)
        for (let step = 0; step < 5; step++) {
            const currentError = calculatePolygonError(rdpVertices, regularVertices);

            // Try slightly larger and smaller radii
            const delta = radius * 0.02;
            let largerVertices: Point[];
            let smallerVertices: Point[];

            if (classification.type === 'polygon') {
                largerVertices = generateRegularPolygon(center, radius + delta, rotation, numSides);
                smallerVertices = generateRegularPolygon(center, radius - delta, rotation, numSides);
            } else {
                const isSelfCrossing = classification.type === 'self-crossing-star';
                largerVertices = generateRegularStar(center, radius + delta, innerRadius!, rotation, numSides, isSelfCrossing);
                smallerVertices = generateRegularStar(center, radius - delta, innerRadius!, rotation, numSides, isSelfCrossing);
            }

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

        // 5 steps of inner radius optimization (for stars only)
        if (classification.type !== 'polygon' && innerRadius !== undefined) {
            for (let step = 0; step < 5; step++) {
                const currentError = calculatePolygonError(rdpVertices, regularVertices);

                // Try slightly larger and smaller inner radii
                const delta = innerRadius * 0.02;
                const isSelfCrossing = classification.type === 'self-crossing-star';
                const largerVertices = generateRegularStar(center, radius, innerRadius + delta, rotation, numSides, isSelfCrossing);
                const smallerVertices = generateRegularStar(center, radius, innerRadius - delta, rotation, numSides, isSelfCrossing);

                const largerError = calculatePolygonError(rdpVertices, largerVertices);
                const smallerError = calculatePolygonError(rdpVertices, smallerVertices);

                // Move in the direction that reduces error
                if (largerError < currentError && largerError < smallerError) {
                    innerRadius += delta;
                    regularVertices = largerVertices;
                } else if (smallerError < currentError) {
                    innerRadius -= delta;
                    regularVertices = smallerVertices;
                } else {
                    break; // No improvement
                }
            }
        }

        // 5 steps of angle optimization (1D)
        for (let step = 0; step < 5; step++) {
            const currentError = calculatePolygonError(rdpVertices, regularVertices);

            // Try slightly rotated angles
            const angleDelta = (2 * Math.PI / numVertices) * 0.02; // 2% of one segment angle
            let cwVertices: Point[];
            let ccwVertices: Point[];

            if (classification.type === 'polygon') {
                cwVertices = generateRegularPolygon(center, radius, rotation + angleDelta, numSides);
                ccwVertices = generateRegularPolygon(center, radius, rotation - angleDelta, numSides);
            } else {
                const isSelfCrossing = classification.type === 'self-crossing-star';
                cwVertices = generateRegularStar(center, radius, innerRadius!, rotation + angleDelta, numSides, isSelfCrossing);
                ccwVertices = generateRegularStar(center, radius, innerRadius!, rotation - angleDelta, numSides, isSelfCrossing);
            }

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
        innerRadius,
        rotation,
        sides: numSides,
        shapeType: classification.type,
        error: finalError
    };
}

/**
 * Shape classification result
 */
interface ShapeClassification {
    type: ShapeType;
    outerRadius: number;
    innerRadius?: number;
    outerIndices: number[];
    innerIndices?: number[];
}

/**
 * Classify shape based on vertex distance distribution
 *
 * @param distances - Distances from center to each vertex
 * @param vertices - Vertex positions
 * @param center - Shape center
 * @returns Classification result
 */
function classifyShape(distances: number[], vertices: Point[], center: Point): ShapeClassification {
    const n = distances.length;

    // Sort distances to find clusters
    const sortedDistances = [...distances].sort((a, b) => a - b);
    const minDist = sortedDistances[0];
    const maxDist = sortedDistances[n - 1];

    // Check if all vertices are at roughly the same distance (polygon)
    const range = maxDist - minDist;
    const avgDist = sortedDistances.reduce((a, b) => a + b, 0) / n;
    const tolerance = 0.25; // 25% tolerance

    if (range / avgDist < tolerance) {
        // All vertices at same distance - it's a polygon
        return {
            type: 'polygon',
            outerRadius: avgDist,
            outerIndices: Array.from({ length: n }, (_, i) => i)
        };
    }

    // Check for two distinct radii (star pattern)
    // Use k-means like approach to find two clusters
    const midpoint = (minDist + maxDist) / 2;
    const lowerGroup: number[] = [];
    const upperGroup: number[] = [];
    const lowerIndices: number[] = [];
    const upperIndices: number[] = [];

    for (let i = 0; i < n; i++) {
        if (distances[i] < midpoint) {
            lowerGroup.push(distances[i]);
            lowerIndices.push(i);
        } else {
            upperGroup.push(distances[i]);
            upperIndices.push(i);
        }
    }

    // Check if we have equal numbers in both groups (star requirement)
    if (lowerGroup.length !== upperGroup.length || lowerGroup.length < 2) {
        // Not a valid star, default to polygon
        return {
            type: 'polygon',
            outerRadius: avgDist,
            outerIndices: Array.from({ length: n }, (_, i) => i)
        };
    }

    // Calculate average radii for the two groups
    const innerRadius = lowerGroup.reduce((a, b) => a + b, 0) / lowerGroup.length;
    const outerRadius = upperGroup.reduce((a, b) => a + b, 0) / upperGroup.length;

    // Check if vertices alternate between inner and outer (determines star type)
    const isAlternating = checkAlternatingPattern(distances, innerRadius, outerRadius);

    if (isAlternating) {
        // Non-self-crossing star (like a starfish)
        return {
            type: 'star',
            outerRadius,
            innerRadius,
            outerIndices: upperIndices,
            innerIndices: lowerIndices
        };
    } else {
        // Self-crossing star (like a pentagram)
        return {
            type: 'self-crossing-star',
            outerRadius,
            innerRadius,
            outerIndices: upperIndices,
            innerIndices: lowerIndices
        };
    }
}

/**
 * Check if vertices alternate between two radii
 */
function checkAlternatingPattern(distances: number[], innerRadius: number, outerRadius: number): boolean {
    const n = distances.length;
    const midpoint = (innerRadius + outerRadius) / 2;

    let alternatingCount = 0;
    for (let i = 0; i < n; i++) {
        const isOuter = distances[i] > midpoint;
        const nextIsOuter = distances[(i + 1) % n] > midpoint;

        if (isOuter !== nextIsOuter) {
            alternatingCount++;
        }
    }

    // Should alternate for all pairs (2n alternations total)
    return alternatingCount >= n * 1.5; // Allow some tolerance
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
 * Generate vertices of a regular star
 *
 * @param center - Center point of the star
 * @param outerRadius - Radius to outer points
 * @param innerRadius - Radius to inner points
 * @param rotation - Rotation angle in radians
 * @param numPoints - Number of points (outer vertices) on the star
 * @param selfCrossing - If true, create self-crossing star (pentagram style)
 * @returns Array of vertices alternating between outer and inner points
 */
function generateRegularStar(
    center: Point,
    outerRadius: number,
    innerRadius: number,
    rotation: number,
    numPoints: number,
    selfCrossing: boolean
): Point[] {
    const vertices: Point[] = [];
    const numVertices = numPoints * 2; // Total vertices (outer + inner)

    if (selfCrossing) {
        // Self-crossing star (pentagram style)
        // Connect every other outer point, creating intersections
        // Generate outer points first
        const outerPoints: Point[] = [];
        const angleStep = (2 * Math.PI) / numPoints;

        for (let i = 0; i < numPoints; i++) {
            const angle = rotation + i * angleStep;
            outerPoints.push({
                x: center.x + outerRadius * Math.cos(angle),
                y: center.y + outerRadius * Math.sin(angle)
            });
        }

        // For a self-crossing star, we connect points in a specific order
        // For a 5-point star: connect point 0 -> 2 -> 4 -> 1 -> 3 -> 0
        // The inner vertices are where the lines cross
        const connectionStep = Math.floor(numPoints / 2); // Usually 2 for pentagon -> pentagram

        for (let i = 0; i < numPoints; i++) {
            // Add outer point
            vertices.push(outerPoints[i]);

            // Calculate inner point (intersection point)
            // For simplicity, place inner points at innerRadius at offset angle
            const innerAngle = rotation + (i + 0.5) * angleStep;
            vertices.push({
                x: center.x + innerRadius * Math.cos(innerAngle),
                y: center.y + innerRadius * Math.sin(innerAngle)
            });
        }
    } else {
        // Non-self-crossing star (starfish style)
        // Simply alternate between outer and inner radii
        const angleStep = (2 * Math.PI) / numVertices;

        for (let i = 0; i < numVertices; i++) {
            const angle = rotation + i * angleStep;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            vertices.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle)
            });
        }
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
 * Generate points along an equilateral polygon or star for rendering
 */
export function generateEquilateralPolygonPoints(
    center: Point,
    radius: number,
    rotation: number,
    numSides: number,
    innerRadius?: number,
    shapeType: ShapeType = 'polygon'
): Point[] {
    let vertices: Point[];

    if (shapeType === 'polygon' || innerRadius === undefined) {
        vertices = generateRegularPolygon(center, radius, rotation, numSides);
    } else {
        const isSelfCrossing = shapeType === 'self-crossing-star';
        vertices = generateRegularStar(center, radius, innerRadius, rotation, numSides, isSelfCrossing);
    }

    // Add duplicate last point to close the shape
    return [...vertices, vertices[0]];
}
