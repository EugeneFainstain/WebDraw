/**
 * STATE.TS - Centralized Application State
 *
 * This module serves as the single source of truth for all mutable application state.
 * It provides a singleton `state` object that all other modules import and use directly.
 *
 * Responsibilities:
 * - Define core data types (Stroke, ViewTransform, etc.)
 * - Hold all mutable application state (strokes, cursor, selection, transforms)
 * - Store DOM element references
 * - Provide state initialization and reset functions
 * - Define configuration constants
 *
 * Design: Other modules import `state` and read/write directly. This avoids circular
 * dependencies since state.ts has no dependencies on other app modules (only eventHandler
 * for the Point type and state machine instances).
 *
 * NOTE: If this file's responsibilities drift, update this description!
 */

import { Point } from './eventHandler';
import { StateMachine } from './stateMachine';
import { EventHandler } from './eventHandler';

// ============================================================================
// TYPES
// ============================================================================

export interface Stroke {
    color?: string;               // Color (undefined for groups)
    size?: number;                // Size (undefined for groups)
    points?: Point[];             // Currently displayed points (undefined for groups)
    originalPoints?: Point[];     // Original hand-drawn points
    fittedPoints?: Point[];       // Fitted analytical curve points
    fitType?: string;             // Type of fit: 'circle', 'ellipse', 'line', etc.
    showingFitted?: boolean;      // True if currently showing fitted version
    fittedWithSize?: number;      // Stroke size used when fitting (for polylines)
    strokes?: Stroke[];           // Child strokes (if this is a group)
}

export interface StrokeSnapshot {
    points: Point[];
    fittedPoints?: Point[];
    originalPoints?: Point[];
}

export interface ViewTransform {
    scale: number;
    rotation: number;  // in radians
    panX: number;
    panY: number;
}

export interface TransformStart {
    pivot: Point;
    initialScale: number;
    fingerAngles: number[];
    unwrappedRotation: number;
    initialTransform: ViewTransform;
    // For 3-finger stroke transformation: maps stroke index -> snapshots
    strokeSnapshotsMap?: Map<number, StrokeSnapshot[]>;
    // Combined bounding box center for all transformed strokes
    initialCombinedCenter?: Point;
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// Two-finger drawing mode: control delta averaging behavior
// true = Use intricate batching mechanism (handles finger promotion, mode transitions)
// false = Simple averaging of every 2 consecutive deltas (regardless of finger ID)
export const USE_BATCHED_DELTA_MECHANISM = false;

// Stroke length threshold for locking two-finger gesture as drawing (in millimeters)
export const STROKE_LEN_THRESHOLD_MM = 4;

// Distance threshold for deselecting a stroke (cursor distance from anchor, in millimeters)
export const DESELECT_DISTANCE_THRESHOLD_MM = 3;

// Double-tap detection constants
export const DOUBLE_TAP_DELAY = 300; // ms - max time between first lift and second down
export const DOUBLE_TAP_MAX_DURATION = 200; // ms - max time the second tap can be held
export const DOUBLE_TAP_DISTANCE = 50; // pixels - max distance between taps

// Toolbar height - cursor can extend into this area
export const TOOLBAR_HEIGHT = 60;

// UI drag threshold
export const UI_DRAG_THRESHOLD = 15; // pixels before UI touch becomes canvas drag

// ============================================================================
// SINGLETON STATE OBJECT
// ============================================================================

export const state = {
    // Canvas & context (initialized in initState())
    canvas: null as HTMLCanvasElement | null,
    ctx: null as CanvasRenderingContext2D | null,

    // DOM Elements (initialized in initState())
    dom: {
        combinedPickerEl: null as HTMLElement | null,
        menuPickerEl: null as HTMLElement | null,
        undoBtn: null as HTMLButtonElement | null,
        delBtn: null as HTMLButtonElement | null,
        btnDup: null as HTMLButtonElement | null,
        btnGroup: null as HTMLButtonElement | null,
        btnUngroup: null as HTMLButtonElement | null,
        btnFit: null as HTMLButtonElement | null,
        iosFullscreenTooltip: null as HTMLElement | null,
        iosTooltipClose: null as HTMLButtonElement | null,
        debugOverlay: null as HTMLElement | null,
        cursorDiv: null as HTMLElement | null,
    },

    // Core state machine
    stateMachine: new StateMachine(),
    eventHandler: new EventHandler(),

    // History for undo functionality (strokes can be hierarchical/grouped)
    strokeHistory: [] as Stroke[],

    // Current stroke being drawn
    currentStroke: null as Stroke | null,

    // Cursor anchor point (in canvas coordinates)
    cursorPos: null as Point | null,

    // Selected stroke index (null = no selection, number = index in strokeHistory)
    selectedStrokeIdx: null as number | null,

    // Index of the point within the selected stroke where the cursor is positioned
    selectedStrokePointIdx: null as number | null,

    // Anchor point on the selected stroke (used to determine when to deselect)
    // Updated continuously while drawing, or set to closest point when selecting via double-click
    selectedStrokeCursorPos: null as Point | null,

    // Cursor position at start of drag gesture (for restoring if drag is cancelled)
    dragStartCursorPos: null as Point | null,

    // Track if we're in "fresh stroke" mode (just drew, not manually selected)
    isFreshStroke: false,

    // Track transformation undo state
    transformSnapshot: null as Point[] | null,  // Original points before transformation
    hasUndoableTransform: false,     // True if selected stroke has been transformed

    // Track last grid position for grid mode
    lastGridPosition: null as Point | null,

    // Grid mode state
    isGridMode: false,

    // Selection rectangle state
    selectionRectStart: null as Point | null,
    selectionRectEnd: null as Point | null,

    // Highlighted strokes (indices of strokes currently highlighted by selection rectangle)
    highlightedStrokes: new Set<number>(),

    // View transform (for 2-finger canvas transformation)
    viewTransform: {
        scale: 1,
        rotation: 0,  // in radians
        panX: 0,
        panY: 0
    } as ViewTransform,

    // Transform state for multi-finger gesture
    transformStart: null as TransformStart | null,

    // Movement tracking for continuous updates
    lastPrimaryPos: null as Point | null,
    lastSecondaryPos: null as Point | null,
    lastDelta: null as { x: number; y: number; pointerId: number } | null,
    batchedDelta: null as { x: number; y: number } | null,

    // Double-tap detection for stroke selection
    firstTapDownTime: 0,
    firstTapDownPos: null as Point | null,
    firstTapUpTime: 0,
    secondTapDownTime: 0,
    secondTapDownPos: null as Point | null,
    isTrackingDoubleTap: false, // True when we're waiting to see if second tap completes

    // Track pointers that started on UI elements (for drag detection)
    pointersOnUI: new Map<number, { startX: number; startY: number }>(),

    // Debug messages
    debugMessages: [] as string[],
};

// ============================================================================
// STATE INITIALIZATION
// ============================================================================

export function initState(canvas: HTMLCanvasElement) {
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d')!;

    // Initialize DOM references
    state.dom.combinedPickerEl = document.getElementById('combinedPicker') as HTMLElement;
    state.dom.menuPickerEl = document.getElementById('menuPicker') as HTMLElement;
    state.dom.undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
    state.dom.delBtn = document.getElementById('delBtn') as HTMLButtonElement;
    state.dom.btnDup = document.getElementById('btnDup') as HTMLButtonElement;
    state.dom.btnGroup = document.getElementById('btnGroup') as HTMLButtonElement;
    state.dom.btnUngroup = document.getElementById('btnUngroup') as HTMLButtonElement;
    state.dom.btnFit = document.getElementById('btnFit') as HTMLButtonElement;
    state.dom.iosFullscreenTooltip = document.getElementById('iosFullscreenTooltip') as HTMLElement;
    state.dom.iosTooltipClose = document.getElementById('iosTooltipClose') as HTMLButtonElement;
    state.dom.debugOverlay = document.getElementById('debugOverlay') as HTMLElement;
    state.dom.cursorDiv = document.getElementById('cursorDiv') as HTMLElement;
}

// ============================================================================
// STATE RESET (for clear functionality)
// ============================================================================

export function resetState() {
    state.strokeHistory = [];
    state.currentStroke = null;
    state.lastGridPosition = null;
    state.transformStart = null;
    state.transformSnapshot = null;
    state.hasUndoableTransform = false;
    state.viewTransform = { scale: 1, rotation: 0, panX: 0, panY: 0 };
    state.isFreshStroke = false;
    state.selectedStrokeIdx = null;
    state.selectedStrokePointIdx = null;
    state.selectedStrokeCursorPos = null;
    state.dragStartCursorPos = null;
    state.selectionRectStart = null;
    state.selectionRectEnd = null;
    state.highlightedStrokes.clear();
    state.lastPrimaryPos = null;
    state.lastSecondaryPos = null;
    state.lastDelta = null;
    state.batchedDelta = null;
    state.firstTapDownTime = 0;
    state.firstTapDownPos = null;
    state.firstTapUpTime = 0;
    state.secondTapDownTime = 0;
    state.secondTapDownPos = null;
    state.isTrackingDoubleTap = false;
    state.pointersOnUI.clear();
    state.debugMessages = [];

    // Reset state machine and event handler
    state.stateMachine.reset();
    state.eventHandler.reset();
}

// ============================================================================
// DEBUG HELPERS
// ============================================================================

export function showDebug(message: string) {
    state.debugMessages.push(message);
    if (state.dom.debugOverlay) {
        state.dom.debugOverlay.textContent = state.debugMessages.join('\n---\n');
        state.dom.debugOverlay.style.display = 'block';
    }
}

export function clearDebug() {
    if (state.dom.debugOverlay) {
        state.dom.debugOverlay.style.display = 'none';
    }
    state.debugMessages = [];
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Convert millimeters to screen pixels based on device DPI
export function mmToPixels(mm: number): number {
    const dpi = 96; // Standard web DPI
    const pixelRatio = window.devicePixelRatio || 1;
    return (mm / 25.4) * dpi * pixelRatio;
}

// Computed constant (depends on mmToPixels)
export function getStrokeLenThreshold(): number {
    return mmToPixels(STROKE_LEN_THRESHOLD_MM);
}

// Get deselect distance threshold in pixels
export function getDeselectDistanceThreshold(): number {
    return mmToPixels(DESELECT_DISTANCE_THRESHOLD_MM);
}
