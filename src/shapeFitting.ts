import { Point } from './eventHandler';
import { Stroke, showDebug } from './state';
import { fitCircle, generateCirclePoints, isMostlyClosed } from './fitters/circleFitter';
import { fitEllipse, generateEllipsePoints } from './fitters/ellipseFitter';
import { fitSquare, fitSquareConstrained, generateRectanglePoints } from './fitters/squareFitter';
import { fitPolyline, generatePolylinePoints } from './fitters/polylineFitter';
import { fitEquilateralPolygon } from './fitters/equilateralPolygonFitter';

// ============================================================================
// DEBUG FLAGS
// ============================================================================

// Master debug flag - set to false to disable all shape fitting debug overlay
const DEBUG_SHAPE_FITTING = false;

// Debug flags for each fitter (only used if DEBUG_SHAPE_FITTING is true)
const DEBUG_CIRCLE_ELLIPSE = false;
const DEBUG_SQUARE_RECTANGLE = false;
const DEBUG_POLYGON_STAR = true;
const DEBUG_POLYLINE = false;

// ============================================================================
// SHAPE FITTING
// ============================================================================

export function fitStroke(stroke: Stroke): void {
    if (stroke.points!.length < 3) {
        showDebug('Too few points!');
        return; // Not enough points to fit
    }

    // Store original points if not already stored
    if (!stroke.originalPoints) {
        stroke.originalPoints = stroke.points!.map(p => ({ ...p }));
    }

    // TEMPORARY: Skip resampling to avoid cutting corners on grid-drawn shapes
    const points = stroke.originalPoints;

    // Check if stroke is mostly closed
    const closureInfo = isMostlyClosed(points);

    if (closureInfo.closed) {
        fitClosedStroke(stroke, points);
    } else {
        fitOpenStroke(stroke, points);
    }
}

// ============================================================================
// CLOSED STROKE FITTING (circles, ellipses, rectangles, polygons, stars)
// ============================================================================

function fitClosedStroke(stroke: Stroke, points: Point[]): void {
    // Fit all shapes: circle, ellipse, square/rectangle, and equilateral polygon
    const circleFit = fitCircle(points);
    const ellipseFit = fitEllipse(points);
    const squareFit = fitSquare(points);
    const polygonFit = fitEquilateralPolygon(points, stroke.size!);

    if (!circleFit || !ellipseFit || !squareFit) {
        showDebug('One or more fits failed!');
        return;
    }

    // Display debug info - show fit errors to determine which fitter to use
    if (DEBUG_SHAPE_FITTING) {
        showClosedStrokeDebug(points, circleFit, ellipseFit, squareFit, polygonFit);
    }

    // Choose the best fitter based on minimum error
    const ellipseError = ellipseFit.error;
    const rectangleError = squareFit.error;
    const polygonError = polygonFit ? polygonFit.error : Infinity;

    const minError = Math.min(ellipseError, rectangleError, polygonError);

    const elongationThreshold = 0.20; // 20% threshold for using elongated vs constrained fit

    if (minError === ellipseError) {
        applyCircleOrEllipseFit(stroke, circleFit, ellipseFit, elongationThreshold);
    } else if (minError === rectangleError) {
        applySquareOrRectangleFit(stroke, points, squareFit, elongationThreshold);
    } else {
        applyPolygonFit(stroke, squareFit, polygonFit);
    }
}

function showClosedStrokeDebug(
    points: Point[],
    circleFit: ReturnType<typeof fitCircle>,
    ellipseFit: ReturnType<typeof fitEllipse>,
    squareFit: ReturnType<typeof fitSquare>,
    polygonFit: ReturnType<typeof fitEquilateralPolygon>
): void {
    let debugText = `Points: ${points.length}`;

    // Line 1: Circle vs Ellipse
    debugText += `\nCircle/Ellipse: ${Math.sqrt(circleFit!.error).toFixed(1)}px/${Math.sqrt(ellipseFit!.error).toFixed(1)}px`;

    // Line 2: Square vs Rectangle
    debugText += `\nSquare/Rect: ${Math.sqrt(squareFit!.squareError).toFixed(1)}px/${Math.sqrt(squareFit!.error).toFixed(1)}px`;

    // Line 3: Polygon (regularized)
    const polygonErr = polygonFit ? Math.sqrt(polygonFit.error).toFixed(1) : 'N/A';
    const polygonSides = polygonFit ? polygonFit.sides : 0;
    debugText += `\nPolygon: ${polygonErr}px (${polygonSides} sides)`;

    // Detailed debug info for circle/ellipse fitter
    if (DEBUG_CIRCLE_ELLIPSE) {
        debugText += `\n---`;
        debugText += `\nEllipticity: ${ellipseFit!.ellipticity.toFixed(3)}`;
        debugText += `\nEllipse err before 1D: ${ellipseFit!.debugInfo?.errorBefore1D.toFixed(2)}`;
        debugText += `\nEllipse err after 1D: ${ellipseFit!.debugInfo?.errorAfter1D.toFixed(2)}`;
    }

    // Detailed debug info for square/rectangle fitter
    if (DEBUG_SQUARE_RECTANGLE) {
        debugText += `\n---`;
        debugText += `\nSquareness: ${squareFit!.squareness.toFixed(3)}`;
    }

    // Detailed debug info for polygon/star fitter
    if (DEBUG_POLYGON_STAR && polygonFit) {
        debugText += `\n---`;
        const shapeLabel = polygonFit.shapeType === 'polygon'
            ? 'Polygon'
            : polygonFit.shapeType === 'star'
            ? 'Star'
            : 'X-Star';
        debugText += `\n${shapeLabel}: ${polygonFit.sides} ${polygonFit.shapeType === 'polygon' ? 'sides' : 'points'}`;
        debugText += `\nRadius: ${polygonFit.radius.toFixed(1)}`;
        if (polygonFit.innerRadius !== undefined) {
            debugText += `\nInner R: ${polygonFit.innerRadius.toFixed(1)}`;
        }
        if (polygonFit.stepPattern !== undefined) {
            debugText += `\nStep: ${polygonFit.stepPattern}/${polygonFit.sides}`;
        }
        debugText += `\nRotation: ${(polygonFit.rotation * 180 / Math.PI).toFixed(1)}°`;

        // Show radius debug info if available
        if ((polygonFit as any).debugRadiusInfo) {
            debugText += `\n${(polygonFit as any).debugRadiusInfo}`;
        }

        // Show starfish test debug info if available
        if ((polygonFit as any).debugStarfishTest) {
            debugText += `\n${(polygonFit as any).debugStarfishTest}`;
        }

        // Show step pattern debug info if available
        if ((polygonFit as any).debugStepPatterns) {
            debugText += `\nStep errors:`;
            const patterns = (polygonFit as any).debugStepPatterns;
            for (const p of patterns) {
                const mark = p.step === polygonFit.stepPattern ? '*' : ' ';
                debugText += `\n${mark}${p.step}:${p.error.toFixed(0)}`;
            }
        }
    }

    showDebug(debugText);
}

function applyCircleOrEllipseFit(
    stroke: Stroke,
    circleFit: NonNullable<ReturnType<typeof fitCircle>>,
    ellipseFit: NonNullable<ReturnType<typeof fitEllipse>>,
    elongationThreshold: number
): void {
    // Use ellipticity to decide between circle and ellipse
    if (ellipseFit.ellipticity > elongationThreshold) {
        // Use ellipse fit
        stroke.fittedPoints = generateEllipsePoints(
            ellipseFit.center,
            ellipseFit.radiusX,
            ellipseFit.radiusY,
            ellipseFit.rotation,
            64
        );
        stroke.fitType = 'ellipse';
    } else {
        // Use circle fit
        stroke.fittedPoints = generateCirclePoints(circleFit.center, circleFit.radius, 64);
        stroke.fitType = 'circle';
    }
    stroke.fittedWithSize = stroke.size!;
}

function applySquareOrRectangleFit(
    stroke: Stroke,
    points: Point[],
    squareFit: NonNullable<ReturnType<typeof fitSquare>>,
    elongationThreshold: number
): void {
    // Calculate elongation from squareness
    const elongation = squareFit.squareness;

    if (elongation > elongationThreshold) {
        // Use rectangle fit
        stroke.fittedPoints = generateRectanglePoints(
            squareFit.center,
            squareFit.width,
            squareFit.height,
            squareFit.rotation,
            64
        );
        stroke.fitType = 'rectangle';
    } else {
        // Use square fit - need to get the constrained square fit
        const squareOnlyFit = fitSquareConstrained(points);
        if (squareOnlyFit) {
            stroke.fittedPoints = generateRectanglePoints(
                squareOnlyFit.center,
                squareOnlyFit.size,
                squareOnlyFit.size,
                squareOnlyFit.rotation,
                64
            );
            stroke.fitType = 'square';
        } else {
            // Fallback to rectangle if square fit fails
            stroke.fittedPoints = generateRectanglePoints(
                squareFit.center,
                squareFit.width,
                squareFit.height,
                squareFit.rotation,
                64
            );
            stroke.fitType = 'rectangle';
        }
    }
    stroke.fittedWithSize = stroke.size!;
}

function applyPolygonFit(
    stroke: Stroke,
    squareFit: NonNullable<ReturnType<typeof fitSquare>>,
    polygonFit: ReturnType<typeof fitEquilateralPolygon>
): void {
    if (polygonFit) {
        stroke.fittedPoints = polygonFit.vertices;
        const shapePrefix = polygonFit.shapeType === 'polygon'
            ? 'polygon'
            : polygonFit.shapeType === 'star'
            ? 'star'
            : 'x-star';
        stroke.fitType = `${shapePrefix}-${polygonFit.sides}`;
        stroke.fittedWithSize = stroke.size!;
    } else {
        // Fallback to rectangle if polygon fit fails
        stroke.fittedPoints = generateRectanglePoints(
            squareFit.center,
            squareFit.width,
            squareFit.height,
            squareFit.rotation,
            64
        );
        stroke.fitType = 'rectangle';
        stroke.fittedWithSize = stroke.size!;
    }
}

// ============================================================================
// OPEN STROKE FITTING (polylines)
// ============================================================================

function fitOpenStroke(stroke: Stroke, points: Point[]): void {
    // For open strokes, use polyline fitting with RDP algorithm
    const polylineFit = fitPolyline(points, stroke.size!);

    if (!polylineFit) {
        showDebug('Polyline fit failed!');
        return;
    }

    // Display debug info for polyline fit
    if (DEBUG_SHAPE_FITTING) {
        let debugText = `Polyline: ${polylineFit.error.toFixed(2)}`;

        // Detailed debug info for polyline fitter
        if (DEBUG_POLYLINE) {
            debugText += `\n---`;
            debugText += `\nSegments: ${polylineFit.segments}`;
            debugText += `\nEpsilon: ${(2 * stroke.size!).toFixed(2)}`;
        }

        showDebug(debugText);
    }

    // Use the simplified polyline points
    stroke.fittedPoints = generatePolylinePoints(polylineFit.points);
    stroke.fitType = 'polyline';
    stroke.fittedWithSize = stroke.size!;  // Track the size used for fitting
}
