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
    debugStepPatterns?: Array<{ step: number; error: number }>; // Debug info for step pattern selection
    debugRadiusInfo?: string; // Debug info about radius variation
    debugStarfishTest?: string; // Debug info about starfish test results
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
        // Regular polygon - all vertices at same distance, step pattern = 1
        radius = classification.outerRadius;
        innerRadius = undefined;
        numSides = numVertices;

        // Use the first vertex as reference for rotation
        const firstDx = vertices[0].x - center.x;
        const firstDy = vertices[0].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        regularVertices = generateRegularPolygon(center, radius, rotation, numSides);
    } else if (classification.type === 'self-crossing-star' && classification.innerRadius === classification.outerRadius) {
        // Self-crossing star with all vertices at same radius (pentagram)
        radius = classification.outerRadius;
        innerRadius = undefined;
        numSides = numVertices;

        // Use the first vertex as reference for rotation
        const firstDx = vertices[0].x - center.x;
        const firstDy = vertices[0].y - center.y;
        rotation = Math.atan2(firstDy, firstDx);

        stepPattern = classification.stepPattern!;
        regularVertices = generateRegularPolygonWithStep(center, radius, rotation, numSides, stepPattern);
    } else {
        // Star shape with two distinct radii (self-crossing or non-self-crossing)
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
            } else if (innerRadius === undefined) {
                // Self-crossing star with single radius (pentagram)
                largerVertices = generateRegularPolygonWithStep(center, radius + delta, rotation, numSides, stepPattern);
                smallerVertices = generateRegularPolygonWithStep(center, radius - delta, rotation, numSides, stepPattern);
            } else {
                // Star with two radii
                const isSelfCrossing = classification.type === 'self-crossing-star';
                largerVertices = generateRegularStar(center, radius + delta, innerRadius, rotation, numSides, isSelfCrossing, stepPattern);
                smallerVertices = generateRegularStar(center, radius - delta, innerRadius, rotation, numSides, isSelfCrossing, stepPattern);
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
            } else if (innerRadius === undefined) {
                // Self-crossing star with single radius (pentagram)
                cwVertices = generateRegularPolygonWithStep(center, radius, rotation + angleDelta, numSides, stepPattern);
                ccwVertices = generateRegularPolygonWithStep(center, radius, rotation - angleDelta, numSides, stepPattern);
            } else {
                // Star with two radii
                const isSelfCrossing = classification.type === 'self-crossing-star';
                cwVertices = generateRegularStar(center, radius, innerRadius, rotation + angleDelta, numSides, isSelfCrossing, stepPattern);
                ccwVertices = generateRegularStar(center, radius, innerRadius, rotation - angleDelta, numSides, isSelfCrossing, stepPattern);
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
        error: finalError,
        debugStepPatterns: classification.debugStepPatterns,
        debugRadiusInfo: classification.debugRadiusInfo,
        debugStarfishTest: classification.debugStarfishTest
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
    debugStepPatterns?: Array<{ step: number; error: number }>; // Debug info
    debugRadiusInfo?: string; // Debug info about radius variation
    debugStarfishTest?: string; // Debug info about starfish test results
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
    const avgDist = sortedDistances.reduce((a, b) => a + b, 0) / n;
    const range = maxDist - minDist;
    const radiusVariation = range / avgDist;

    const radiusDebugInfo = `R:${minDist.toFixed(0)}-${maxDist.toFixed(0)} var=${(radiusVariation*100).toFixed(0)}%`;
    console.log(`Radius analysis: min=${minDist.toFixed(1)}, max=${maxDist.toFixed(1)}, avg=${avgDist.toFixed(1)}, variation=${(radiusVariation*100).toFixed(1)}%`);

    // ========================================================================
    // Test for STARFISH pattern (alternating inner/outer radii)
    // ========================================================================

    let starfishDebugInfo = '';

    // Condition 1: Must have even number of vertices (can't be starfish with odd number)
    const isStarfishCandidate = (n % 2 === 0);
    starfishDebugInfo = `SF1:n=${n}`;

    if (isStarfishCandidate) {
        // Condition 2: Group vertices by even/odd indices
        const evenRadii: number[] = [];
        const oddRadii: number[] = [];

        for (let i = 0; i < n; i++) {
            if (i % 2 === 0) {
                evenRadii.push(distances[i]);
            } else {
                oddRadii.push(distances[i]);
            }
        }

        const avgEvenRadius = evenRadii.reduce((a, b) => a + b, 0) / evenRadii.length;
        const avgOddRadius = oddRadii.reduce((a, b) => a + b, 0) / oddRadii.length;

        // Determine which is inner and which is outer
        const innerRadius = Math.min(avgEvenRadius, avgOddRadius);
        const outerRadius = Math.max(avgEvenRadius, avgOddRadius);
        const avgRadius = (innerRadius + outerRadius) / 2;

        // Condition 3: Difference between inner and outer should be > 25% of their average
        const radiusDifference = outerRadius - innerRadius;
        const radiusDiffPercent = radiusDifference / avgRadius;

        starfishDebugInfo += ` SF3:${(radiusDiffPercent*100).toFixed(0)}%`;

        if (radiusDiffPercent > 0.25) {
            // Condition 2b: Verify segmentation by midpoint gives equal groups
            const midpoint = (innerRadius + outerRadius) / 2;
            let lowerCount = 0;
            let upperCount = 0;
            const lowerIndices: number[] = [];
            const upperIndices: number[] = [];

            for (let i = 0; i < n; i++) {
                if (distances[i] < midpoint) {
                    lowerCount++;
                    lowerIndices.push(i);
                } else {
                    upperCount++;
                    upperIndices.push(i);
                }
            }

            starfishDebugInfo += ` SF2:${lowerCount}=${upperCount}`;

            if (lowerCount === upperCount) {
                // Condition 4: Calculate winding number - should be ~2π for simple shapes, ~4π for self-crossing
                // Sum the signed angles between consecutive edge vectors
                let totalWinding = 0;

                for (let i = 0; i < n; i++) {
                    const v1 = vertices[i];
                    const v2 = vertices[(i + 1) % n];
                    const angle1 = Math.atan2(v1.y - center.y, v1.x - center.x);
                    const angle2 = Math.atan2(v2.y - center.y, v2.x - center.x);
                    let angleDiff = angle2 - angle1;

                    // Normalize to [-π, π]
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                    totalWinding += angleDiff;
                }

                // For a simple (non-self-intersecting) shape, winding should be ~2π
                // For self-crossing (like pentagram), it would be ~4π
                const windingNumber = Math.abs(totalWinding) / (2 * Math.PI);
                const windingError = Math.abs(windingNumber - 1.0); // Should be close to 1.0 for simple shapes

                starfishDebugInfo += ` SF4:wind=${windingNumber.toFixed(1)}`;

                // If winding number is close to 1 (simple shape), it's a starfish
                if (windingError < 0.5) {  // Allow winding between 0.5 and 1.5
                    starfishDebugInfo += ' ✓PASS';
                    console.log('→ ALL TESTS PASSED: Classified as starfish');
                    return {
                        type: 'star',
                        outerRadius,
                        innerRadius,
                        outerIndices: upperIndices,
                        innerIndices: lowerIndices,
                        debugRadiusInfo: radiusDebugInfo + ' starfish',
                        debugStarfishTest: starfishDebugInfo
                    };
                } else {
                    starfishDebugInfo += ' ✗fail4';
                    console.log(`→ FAILED test 4 (winding number ${windingNumber.toFixed(2)}, expected ~1.0)`);
                }
            } else {
                starfishDebugInfo += ' ✗fail2';
                console.log('→ FAILED test 2 (groups not equal)');
            }
        } else {
            starfishDebugInfo += ' ✗fail3';
            console.log('→ FAILED test 3 (radius difference too small)');
        }
    } else {
        starfishDebugInfo += ' ✗fail1';
        console.log('→ FAILED test 1 (odd number of vertices)');
    }

    // ========================================================================
    // Default path: POLYGON or SELF-CROSSING STAR (single radius, test step patterns)
    // ========================================================================

    console.log('→ Going to polygon/X-star path (testing step patterns)');
    const { bestStep, debugPatterns } = findBestPolygonStepPattern(vertices, center, avgDist, numVertices);
    console.log('Best pattern selected:', bestStep);

    if (bestStep === 1) {
        // Step pattern of 1 = regular polygon
        console.log('→ Classified as regular polygon');
        return {
            type: 'polygon',
            outerRadius: avgDist,
            outerIndices: Array.from({ length: n }, (_, i) => i),
            debugStepPatterns: debugPatterns,
            debugRadiusInfo: radiusDebugInfo + ' step=1',
            debugStarfishTest: starfishDebugInfo
        };
    } else {
        // Step pattern > 1 = self-crossing star with single radius (pentagram-like)
        console.log('→ Classified as self-crossing star with pattern', bestStep);
        return {
            type: 'self-crossing-star',
            outerRadius: avgDist,
            innerRadius: avgDist, // Same radius for all vertices
            outerIndices: Array.from({ length: n }, (_, i) => i),
            innerIndices: [], // No separate inner vertices
            stepPattern: bestStep,
            debugStepPatterns: debugPatterns,
            debugRadiusInfo: radiusDebugInfo + ` step=${bestStep}`,
            debugStarfishTest: starfishDebugInfo
        };
    }
}

/**
 * Find the best step pattern for a polygon with all vertices at same radius
 * This distinguishes between regular polygons (step=1) and self-crossing stars like pentagrams (step>1)
 *
 * @param vertices - The RDP vertices (including duplicate last point)
 * @param center - Center of the shape
 * @param radius - Radius to all vertices
 * @param numVertices - Number of unique vertices (excluding duplicate last)
 * @returns The step pattern that gives the best fit (1 for regular polygon, >1 for self-crossing)
 */
function findBestPolygonStepPattern(
    vertices: Point[],
    center: Point,
    radius: number,
    numVertices: number
): { bestStep: number; debugPatterns: Array<{ step: number; error: number }> } {
    let bestStep = 1; // Default to regular polygon
    let bestError = Infinity;

    // Use the first vertex to determine rotation
    const firstDx = vertices[0].x - center.x;
    const firstDy = vertices[0].y - center.y;
    const rotation = Math.atan2(firstDy, firstDx);

    // Extract only unique vertices for error calculation
    const rdpVertices = vertices.slice(0, numVertices);

    // Try different step patterns from 1 to numVertices-1
    const results: { step: number; error: number }[] = [];

    for (let step = 1; step < numVertices; step++) {
        // Skip patterns that don't visit all points (non-coprime with numVertices)
        if (gcd(step, numVertices) !== 1) {
            console.log(`  Step ${step}: skipped (gcd(${step}, ${numVertices}) != 1)`);
            continue;
        }

        // Generate test polygon with this step pattern
        const testVertices = generateRegularPolygonWithStep(center, radius, rotation, numVertices, step);

        // Calculate 1:1 vertex-to-vertex error (not nearest-neighbor)
        const error = calculate1to1VertexError(rdpVertices, testVertices);

        results.push({ step, error });

        if (error < bestError) {
            bestError = error;
            bestStep = step;
        }
    }

    // Print all results
    console.log('  All step pattern errors:');
    for (const { step, error } of results) {
        const marker = step === bestStep ? ' ← BEST' : '';
        console.log(`    Step ${step}: ${error.toFixed(2)}${marker}`);
    }

    return { bestStep, debugPatterns: results };
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
 * Generate a regular polygon with a specific step pattern
 * Step pattern determines the angular increment between consecutive vertices
 *
 * @param center - Center point
 * @param radius - Radius to vertices
 * @param rotation - Starting rotation angle
 * @param numVertices - Number of vertices
 * @param step - Step pattern (1 = consecutive, 2 = every other, etc.)
 * @returns Array of vertices in visit order
 */
function generateRegularPolygonWithStep(
    center: Point,
    radius: number,
    rotation: number,
    numVertices: number,
    step: number
): Point[] {
    const vertices: Point[] = [];
    const angleStep = (2 * Math.PI) / numVertices;

    // Generate vertices in step pattern order
    let currentIndex = 0;
    for (let i = 0; i < numVertices; i++) {
        const angle = rotation + currentIndex * angleStep;
        vertices.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
        currentIndex = (currentIndex + step) % numVertices;
    }

    return vertices;
}

/**
 * Calculate 1:1 vertex-to-vertex error (not nearest-neighbor)
 * Assumes vertices are in corresponding order
 *
 * @param vertices1 - First set of vertices
 * @param vertices2 - Second set of vertices
 * @returns Sum of squared distances between corresponding vertices
 */
function calculate1to1VertexError(vertices1: Point[], vertices2: Point[]): number {
    if (vertices1.length !== vertices2.length) {
        return Infinity;
    }

    let sumSquaredDist = 0;
    for (let i = 0; i < vertices1.length; i++) {
        const dx = vertices1[i].x - vertices2[i].x;
        const dy = vertices1[i].y - vertices2[i].y;
        sumSquaredDist += dx * dx + dy * dy;
    }

    return sumSquaredDist;
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
 * Uses bidirectional Hausdorff distance with brute-force alignment search
 */
function calculatePolygonError(rdpVertices: Point[], regularVertices: Point[]): number {
    const n = rdpVertices.length;
    if (n !== regularVertices.length) {
        return Infinity;
    }

    // Forward direction: shape (regularVertices) -> rdp
    // For each point in shape, find the closest point in rdp
    let maxShapeToRdp = 0;
    for (const shapePoint of regularVertices) {
        let minDistSquared = Infinity;
        for (const rdpPoint of rdpVertices) {
            const dx = shapePoint.x - rdpPoint.x;
            const dy = shapePoint.y - rdpPoint.y;
            const distSquared = dx * dx + dy * dy;
            minDistSquared = Math.min(minDistSquared, distSquared);
        }
        maxShapeToRdp = Math.max(maxShapeToRdp, minDistSquared);
    }

    // Reverse direction: rdp -> shape (regularVertices)
    // For each point in rdp, find the closest point in shape
    let maxRdpToShape = 0;
    for (const rdpPoint of rdpVertices) {
        let minDistSquared = Infinity;
        for (const shapePoint of regularVertices) {
            const dx = rdpPoint.x - shapePoint.x;
            const dy = rdpPoint.y - shapePoint.y;
            const distSquared = dx * dx + dy * dy;
            minDistSquared = Math.min(minDistSquared, distSquared);
        }
        maxRdpToShape = Math.max(maxRdpToShape, minDistSquared);
    }

    // Return the maximum of both directions (bidirectional Hausdorff distance squared)
    return Math.max(maxShapeToRdp, maxRdpToShape);
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

    // Generate densely sampled points along polygon edges (like rectangle fitter uses 64)
    const samplePoints = generateDenseSampledPolygon(polygonVertices, 64);

    return calculateShapeError(originalPoints, distanceToPolygonFn, samplePoints);
}

/**
 * Generate densely sampled points along polygon perimeter
 */
function generateDenseSampledPolygon(vertices: Point[], numSamples: number): Point[] {
    const samples: Point[] = [];

    // Calculate total perimeter
    let perimeter = 0;
    for (let i = 0; i < vertices.length - 1; i++) {
        const dx = vertices[i + 1].x - vertices[i].x;
        const dy = vertices[i + 1].y - vertices[i].y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    // Distribute samples proportionally along edges
    const samplesPerUnit = numSamples / perimeter;

    for (let i = 0; i < vertices.length - 1; i++) {
        const dx = vertices[i + 1].x - vertices[i].x;
        const dy = vertices[i + 1].y - vertices[i].y;
        const edgeLength = Math.sqrt(dx * dx + dy * dy);
        const edgeSamples = Math.max(1, Math.round(edgeLength * samplesPerUnit));

        for (let j = 0; j < edgeSamples; j++) {
            const t = j / edgeSamples;
            samples.push({
                x: vertices[i].x + t * dx,
                y: vertices[i].y + t * dy
            });
        }
    }

    return samples;
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
