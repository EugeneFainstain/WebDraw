/**
 * STATE.TS - Centralized Application State
 *
 * This module serves as the single source of truth for all mutable application state.
 * It provides two separate objects:
 * - `appState`: Pure data that gets snapshotted for undo functionality
 * - `appContext`: DOM references and class instances that don't get snapshotted
 *
 * Responsibilities:
 * - Define core data types (Stroke, ViewTransform, etc.)
 * - Hold all mutable application state (strokes, cursor, selection, transforms)
 * - Store DOM element references
 * - Provide state initialization and reset functions
 * - Define configuration constants
 *
 * Design: Other modules import `appState` and `appContext` and read/write directly.
 * The undo system snapshots `appState` using structuredClone().
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
// APP STATE INTERFACE - Everything that gets snapshotted for undo
// ============================================================================

export interface AppState {
    // History for undo functionality (strokes can be hierarchical/grouped)
    strokeHistory: Stroke[];

    // Current stroke being drawn
    currentStroke: Stroke | null;

    // Cursor anchor point (in canvas coordinates)
    cursorPos: Point | null;

    // Selected stroke index (null = no selection, number = index in strokeHistory)
    selectedStrokeIdx: number | null;

    // Index of the point within the selected stroke where the cursor is positioned
    selectedStrokePointIdx: number | null;

    // Anchor point on the selected stroke (used to determine when to deselect)
    selectedStrokeCursorPos: Point | null;

    // Flag indicating cursor is "ready" to continue a stroke
    cursorReadyToContinueStroke: boolean;

    // Cursor position at start of drag gesture
    dragStartCursorPos: Point | null;

    // Track transformation undo state
    transformSnapshot: Point[] | null;
    hasUndoableTransform: boolean;

    // Track last grid position for grid mode
    lastGridPosition: Point | null;

    // Grid mode state
    isGridMode: boolean;

    // Selection rectangle state
    selectionRectStart: Point | null;
    selectionRectEnd: Point | null;

    // Highlighted strokes (indices)
    highlightedStrokes: Set<number>;

    // View transform (for 2-finger canvas transformation)
    viewTransform: ViewTransform;

    // Transform state for multi-finger gesture
    transformStart: TransformStart | null;

    // Movement tracking for continuous updates
    lastPrimaryPos: Point | null;
    lastSecondaryPos: Point | null;
    lastDelta: { x: number; y: number; pointerId: number } | null;
    batchedDelta: { x: number; y: number } | null;

    // Track pointers that started on UI elements
    pointersOnUI: Map<number, { startX: number; startY: number }>;

    // Debug messages
    debugMessages: string[];
}

// ============================================================================
// APP CONTEXT INTERFACE - DOM references and class instances (not snapshotted)
// ============================================================================

export interface AppContext {
    // Canvas & context
    canvas: HTMLCanvasElement | null;
    ctx: CanvasRenderingContext2D | null;

    // DOM Elements
    dom: {
        combinedPickerEl: HTMLElement | null;
        menuPickerEl: HTMLElement | null;
        undoBtn: HTMLButtonElement | null;
        delBtn: HTMLButtonElement | null;
        btnDup: HTMLButtonElement | null;
        btnGroup: HTMLButtonElement | null;
        btnUngroup: HTMLButtonElement | null;
        btnFit: HTMLButtonElement | null;
        iosFullscreenTooltip: HTMLElement | null;
        iosTooltipClose: HTMLButtonElement | null;
        debugOverlay: HTMLElement | null;
        cursorDiv: HTMLElement | null;
    };

    // Core state machine and event handler
    stateMachine: StateMachine;
    eventHandler: EventHandler;
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// Two-finger drawing mode: control delta averaging behavior
export const USE_BATCHED_DELTA_MECHANISM = false;

// Stroke length threshold for locking two-finger gesture as drawing (in millimeters)
export const STROKE_LEN_THRESHOLD_MM = 4;

// Distance threshold for deselecting a stroke (in millimeters)
export const DESELECT_DISTANCE_THRESHOLD_MM = 3;

// Toolbar height - cursor can extend into this area
export const TOOLBAR_HEIGHT = 60;

// UI drag threshold
export const UI_DRAG_THRESHOLD = 15; // pixels before UI touch becomes canvas drag

// ============================================================================
// DEFAULT APP STATE - Initial values for snapshotted state
// ============================================================================

function createDefaultAppState(): AppState {
    return {
        strokeHistory: [],
        currentStroke: null,
        cursorPos: null,
        selectedStrokeIdx: null,
        selectedStrokePointIdx: null,
        selectedStrokeCursorPos: null,
        cursorReadyToContinueStroke: false,
        dragStartCursorPos: null,
        transformSnapshot: null,
        hasUndoableTransform: false,
        lastGridPosition: null,
        isGridMode: false,
        selectionRectStart: null,
        selectionRectEnd: null,
        highlightedStrokes: new Set<number>(),
        viewTransform: { scale: 1, rotation: 0, panX: 0, panY: 0 },
        transformStart: null,
        lastPrimaryPos: null,
        lastSecondaryPos: null,
        lastDelta: null,
        batchedDelta: null,
        pointersOnUI: new Map<number, { startX: number; startY: number }>(),
        debugMessages: [],
    };
}

// ============================================================================
// SINGLETON STATE OBJECTS
// ============================================================================

// AppState - pure data, gets snapshotted for undo
export const appState: AppState = createDefaultAppState();

// AppContext - DOM references and class instances, not snapshotted
export const appContext: AppContext = {
    canvas: null,
    ctx: null,
    dom: {
        combinedPickerEl: null,
        menuPickerEl: null,
        undoBtn: null,
        delBtn: null,
        btnDup: null,
        btnGroup: null,
        btnUngroup: null,
        btnFit: null,
        iosFullscreenTooltip: null,
        iosTooltipClose: null,
        debugOverlay: null,
        cursorDiv: null,
    },
    stateMachine: new StateMachine(),
    eventHandler: new EventHandler(),
};

// ============================================================================
// BACKWARDS COMPATIBILITY - Export combined state object
// This allows gradual migration: existing code using `state.xxx` continues to work
// ============================================================================

export const state = new Proxy({} as AppState & AppContext, {
    get(_target, prop: string) {
        // Check appState first (most common)
        if (prop in appState) {
            return (appState as any)[prop];
        }
        // Then check appContext
        if (prop in appContext) {
            return (appContext as any)[prop];
        }
        return undefined;
    },
    set(_target, prop: string, value) {
        // Check appState first
        if (prop in appState) {
            (appState as any)[prop] = value;
            return true;
        }
        // Then check appContext
        if (prop in appContext) {
            (appContext as any)[prop] = value;
            return true;
        }
        // Unknown property - add to appState by default
        (appState as any)[prop] = value;
        return true;
    }
});

// ============================================================================
// STATE INITIALIZATION
// ============================================================================

export function initState(canvas: HTMLCanvasElement) {
    appContext.canvas = canvas;
    appContext.ctx = canvas.getContext('2d')!;

    // Wire up state machine's selectedStrokeIdx reference
    appContext.stateMachine.setSelectedStrokeIdxRef({
        get current() { return appState.selectedStrokeIdx; }
    });

    // Initialize DOM references
    appContext.dom.combinedPickerEl = document.getElementById('combinedPicker') as HTMLElement;
    appContext.dom.menuPickerEl = document.getElementById('menuPicker') as HTMLElement;
    appContext.dom.undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
    appContext.dom.delBtn = document.getElementById('delBtn') as HTMLButtonElement;
    appContext.dom.btnDup = document.getElementById('btnDup') as HTMLButtonElement;
    appContext.dom.btnGroup = document.getElementById('btnGroup') as HTMLButtonElement;
    appContext.dom.btnUngroup = document.getElementById('btnUngroup') as HTMLButtonElement;
    appContext.dom.btnFit = document.getElementById('btnFit') as HTMLButtonElement;
    appContext.dom.iosFullscreenTooltip = document.getElementById('iosFullscreenTooltip') as HTMLElement;
    appContext.dom.iosTooltipClose = document.getElementById('iosTooltipClose') as HTMLButtonElement;
    appContext.dom.debugOverlay = document.getElementById('debugOverlay') as HTMLElement;
    appContext.dom.cursorDiv = document.getElementById('cursorDiv') as HTMLElement;
}

// ============================================================================
// STATE RESET (for clear functionality)
// ============================================================================

// Import will be added after undoSystem.ts is created
let clearUndoStackFn: (() => void) | null = null;

export function setClearUndoStackFn(fn: () => void) {
    clearUndoStackFn = fn;
}

export function resetState() {
    // Reset all appState properties to defaults
    const defaults = createDefaultAppState();

    appState.strokeHistory = defaults.strokeHistory;
    appState.currentStroke = defaults.currentStroke;
    appState.cursorPos = defaults.cursorPos;
    appState.selectedStrokeIdx = defaults.selectedStrokeIdx;
    appState.selectedStrokePointIdx = defaults.selectedStrokePointIdx;
    appState.selectedStrokeCursorPos = defaults.selectedStrokeCursorPos;
    appState.cursorReadyToContinueStroke = defaults.cursorReadyToContinueStroke;
    appState.dragStartCursorPos = defaults.dragStartCursorPos;
    appState.transformSnapshot = defaults.transformSnapshot;
    appState.hasUndoableTransform = defaults.hasUndoableTransform;
    appState.lastGridPosition = defaults.lastGridPosition;
    appState.isGridMode = defaults.isGridMode;
    appState.selectionRectStart = defaults.selectionRectStart;
    appState.selectionRectEnd = defaults.selectionRectEnd;
    appState.highlightedStrokes.clear();
    appState.viewTransform = defaults.viewTransform;
    appState.transformStart = defaults.transformStart;
    appState.lastPrimaryPos = defaults.lastPrimaryPos;
    appState.lastSecondaryPos = defaults.lastSecondaryPos;
    appState.lastDelta = defaults.lastDelta;
    appState.batchedDelta = defaults.batchedDelta;
    appState.pointersOnUI.clear();
    appState.debugMessages = defaults.debugMessages;

    // Reset state machine and event handler
    appContext.stateMachine.reset();
    appContext.eventHandler.reset();

    // Clear undo stack (page reload behavior)
    if (clearUndoStackFn) {
        clearUndoStackFn();
    }
}

// ============================================================================
// DEBUG HELPERS
// ============================================================================

export function showDebug(message: string) {
    appState.debugMessages.push(message);
    if (appContext.dom.debugOverlay) {
        appContext.dom.debugOverlay.textContent = appState.debugMessages.join('\n---\n');
        appContext.dom.debugOverlay.style.display = 'block';
    }
}

export function clearDebug() {
    if (appContext.dom.debugOverlay) {
        appContext.dom.debugOverlay.style.display = 'none';
    }
    appState.debugMessages = [];
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
