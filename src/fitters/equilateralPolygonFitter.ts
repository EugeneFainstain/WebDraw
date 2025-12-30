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
    stepPattern?: number;    // Step pattern for self-crossing stars (undefined for polygons/regular stars)
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

    // Extract vertices (keep duplicate last point for error calculation)
    let vertices = [...polylineFit.points];
    const n = vertices.length;

    // Step 1: Close the shape by averaging first and last points
    const avgX = (vertices[0].x + vertices[n - 1].x) / 2;
    const avgY = (vertices[0].y + vertices[n - 1].y) / 2;
    vertices[0] = { x: avgX, y: avgY };
    vertices[n - 1] = { x: avgX, y: avgY };

    // Number of unique vertices (excluding duplicate last point)
    const numVertices = n - 1;

    // Step 2: Calculate geometric center (excluding duplicate last point)
    let centerX = 0, centerY = 0;
    for (let i = 0; i < numVertices; i++) {
        centerX += vertices[i].x;
        centerY += vertices[i].y;
    }
    centerX /= numVertices;
    centerY /= numVertices;
    let center: Point = { x: centerX, y: centerY };

    // Step 3: Analyze vertex distances from center (excluding duplicate last point)
    const distances: number[] = [];
    for (let i = 0; i < numVertices; i++) {
        const dx = vertices[i].x - center.x;
        const dy = vertices[i].y - center.y;
        distances.push(Math.sqrt(dx * dx + dy * dy));
    }

    // Step 4: Classify shape type based on distance distribution
    const classification = classifyShape(distances, vertices, center, numVertices);

    // Step 5: Generate initial shape based on classification
    let regularVertices: Point[];
    let radius: number;
    let innerRadius: number | undefined;
    let rotation: number;
    let numSides: number;

    let stepPattern = 2; // Default step pattern for self-crossing stars

    if (classification.type === 'polygon') {
        // All vertices at same distance
        radius = classification.outerRadius;
        innerRadius = undefined;
        numSides = numVertices;

        // Use the first vertex as reference for rotation
        const firstDx = vertices[0].x - center.x;
        const firstDy = vertices[0].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        regularVertices = generateRegularPolygon(center, radius, rotation, numSides);
    } else {
        // Star shape (self-crossing or non-self-crossing)
        radius = classification.outerRadius;
        innerRadius = classification.innerRadius!; // Must be defined for stars
        numSides = numVertices / 2; // Number of points on the star

        // Use the first outer vertex as reference for rotation
        const firstOuterIdx = classification.outerIndices[0];
        const firstDx = vertices[firstOuterIdx].x - center.x;
        const firstDy = vertices[firstOuterIdx].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        const isSelfCrossing = classification.type === 'self-crossing-star';
        if (isSelfCrossing && classification.stepPattern) {
            stepPattern = classification.stepPattern;
        }
        regularVertices = generateRegularStar(center, radius, innerRadius, rotation, numSides, isSelfCrossing, stepPattern);
    }

    // Step 6: Iterative refinement
    // We're fitting the regular shape to the RDP vertices (first numVertices only, excluding duplicate last)
    const rdpVertices = vertices.slice(0, numVertices);

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
                largerVertices = generateRegularStar(center, radius + delta, innerRadius!, rotation, numSides, isSelfCrossing, stepPattern);
                smallerVertices = generateRegularStar(center, radius - delta, innerRadius!, rotation, numSides, isSelfCrossing, stepPattern);
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
                const largerVertices = generateRegularStar(center, radius, innerRadius + delta, rotation, numSides, isSelfCrossing, stepPattern);
                const smallerVertices = generateRegularStar(center, radius, innerRadius - delta, rotation, numSides, isSelfCrossing, stepPattern);

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
                cwVertices = generateRegularStar(center, radius, innerRadius!, rotation + angleDelta, numSides, isSelfCrossing, stepPattern);
                ccwVertices = generateRegularStar(center, radius, innerRadius!, rotation - angleDelta, numSides, isSelfCrossing, stepPattern);
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
        stepPattern: classification.type === 'self-crossing-star' ? stepPattern : undefined,
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
    stepPattern?: number;  // For self-crossing stars
}

/**
 * Classify shape based on vertex distance distribution
 *
 * @param distances - Distances from center to each vertex (excluding duplicate last)
 * @param vertices - Vertex positions (including duplicate last point)
 * @param center - Shape center
 * @param numVertices - Number of unique vertices (excluding duplicate last)
 * @returns Classification result
 */
function classifyShape(distances: number[], vertices: Point[], center: Point, numVertices: number): ShapeClassification {
    const n = numVertices;

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
        // Try different step patterns to find the best fit
        const numPoints = upperGroup.length; // Number of outer points
        const bestPattern = findBestStepPattern(vertices, center, outerRadius, innerRadius, numPoints, numVertices);

        return {
            type: 'self-crossing-star',
            outerRadius,
            innerRadius,
            outerIndices: upperIndices,
            innerIndices: lowerIndices,
            stepPattern: bestPattern
        };
    }
}

/**
 * Find the best step pattern for a self-crossing star by trying all valid patterns
 *
 * @param vertices - The RDP vertices (including duplicate last point)
 * @param center - Center of the shape
 * @param outerRadius - Outer radius
 * @param innerRadius - Inner radius
 * @param numPoints - Number of outer points
 * @param numVertices - Number of unique vertices (excluding duplicate last)
 * @returns The step pattern that gives the best fit
 */
function findBestStepPattern(
    vertices: Point[],
    center: Point,
    outerRadius: number,
    innerRadius: number,
    numPoints: number,
    numVertices: number
): number {
    let bestStep = 2; // Default to 2 (most common for pentagrams)
    let bestError = Infinity;

    // Use the first vertex to determine rotation
    const firstDx = vertices[0].x - center.x;
    const firstDy = vertices[0].y - center.y;
    const rotation = Math.atan2(firstDy, firstDx);

    // Extract only unique vertices for error calculation
    const rdpVertices = vertices.slice(0, numVertices);

    // Try different step patterns from 2 to numPoints-1
    // Step pattern of 1 would be a regular polygon (non-crossing)
    for (let step = 2; step < numPoints; step++) {
        // Skip patterns that don't visit all points (non-coprime with numPoints)
        if (gcd(step, numPoints) !== 1) {
            continue;
        }

        // Generate a test star with this step pattern
        const testVertices = generateRegularStar(
            center,
            outerRadius,
            innerRadius,
            rotation,
            numPoints,
            true, // self-crossing
            step
        );

        // Calculate error between RDP vertices and test vertices
        const error = calculatePolygonError(rdpVertices, testVertices);

        if (error < bestError) {
            bestError = error;
            bestStep = step;
        }
    }

    return bestStep;
}

/**
 * Calculate greatest common divisor (for step pattern validation)
 */
function gcd(a: number, b: number): number {
    while (b !== 0) {
        const temp = b;
        b = a % b;
        a = temp;
    }
    return a;
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
 * @param stepPattern - For self-crossing stars, the vertex step pattern (default: 2)
 * @returns Array of vertices alternating between outer and inner points
 */
function generateRegularStar(
    center: Point,
    outerRadius: number,
    innerRadius: number,
    rotation: number,
    numPoints: number,
    selfCrossing: boolean,
    stepPattern: number = 2
): Point[] {
    const vertices: Point[] = [];
    const numVertices = numPoints * 2; // Total vertices (outer + inner)

    if (selfCrossing) {
        // Self-crossing star (pentagram style)
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

        // Visit outer points in step pattern order to create the star
        const visitOrder: number[] = [];
        let current = 0;
        for (let i = 0; i < numPoints; i++) {
            visitOrder.push(current);
            current = (current + stepPattern) % numPoints;
        }

        // Generate vertices by visiting outer points in order and placing inner points between them
        for (let i = 0; i < numPoints; i++) {
            const idx = visitOrder[i];
            const nextIdx = visitOrder[(i + 1) % numPoints];

            // Add outer point
            vertices.push(outerPoints[idx]);

            // Calculate inner point between current and next outer point
            const currentAngle = rotation + idx * angleStep;
            const nextAngle = rotation + nextIdx * angleStep;

            // Inner point angle is between current and next visited outer points
            let innerAngle = (currentAngle + nextAngle) / 2;

            // Handle wraparound case
            const angleDiff = nextAngle - currentAngle;
            if (Math.abs(angleDiff) > Math.PI) {
                innerAngle += Math.PI;
            }

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
