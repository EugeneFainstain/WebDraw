# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ CRITICAL: Debug Output Rules ⚠️

**NEVER USE `console.log()` FOR DEBUGGING IN THIS PROJECT!**

This application is tested on mobile devices where the browser console is not accessible. All debug output MUST use the on-screen overlay via `showDebug()` from `state.ts`:

```typescript
import { showDebug } from './state';
showDebug('Your debug message here');
```

The overlay is the ONLY way to see debug information during mobile testing.

---

## ⚠️ CRITICAL: State Machine Documentation Rules ⚠️

**WHEN MODIFYING THE STATE MACHINE, YOU MUST UPDATE THE DOCUMENTATION!**

Any changes to the following files REQUIRE immediate updates to [STATE_MACHINE.md](STATE_MACHINE.md):
- [src/stateMachine.ts](src/stateMachine.ts) - State transitions, events, actions
- [src/actions.ts](src/actions.ts) - Action handlers (if adding new actions or changing behavior)

**Before completing ANY state machine change:**
1. Update the relevant sections in STATE_MACHINE.md
2. Update transition tables if transitions changed
3. Update action descriptions if actions changed
4. Update event descriptions if events changed

**This is NON-NEGOTIABLE. Code and documentation MUST stay in sync.**

---

## Project Overview

WebDraw is a browser-based multi-touch drawing application built with TypeScript and Vite. It uses the HTML5 Canvas API with Pointer Events for drawing functionality.

## Commands

- `npm run dev` - Start development server (localhost:127.0.0.1:5173)

No build, test, or lint commands are currently configured.

## Architecture

The application uses a state machine architecture with the following main files:

- **index.html** - Entry point with toolbar UI (color picker, stroke size slider, undo/clear buttons, X+ mode checkbox) and canvas element
- **styles.css** - Styling with dark toolbar, responsive canvas, and touch-action prevention
- **src/app.ts** - Main application logic, initialization, and rendering
- **src/stateMachine.ts** - State machine controlling application behavior
- **src/actions.ts** - Action handlers executed in response to state machine transitions
- **src/eventHandler.ts** - Pointer event tracking and state machine event generation
- **src/colorPicker.ts** - Color picker UI component
- **src/sizePicker.ts** - Stroke size picker UI component

### State Machine

The app uses a formal state machine architecture (see [STATE_MACHINE.md](STATE_MACHINE.md) for complete documentation):
- **4 states**: Idle, MovingCursor, Drawing, Transform
- **Events**: Finger down/up, timeouts, movement thresholds, undo/clear
- **Actions**: Returned by state transitions, executed by actions.ts
- **Selected Stroke Mode**: After drawing, the stroke is selected (green cursor) and can be transformed independently

### Core State (src/app.ts)

- `strokeHistory` (Array) - Stores completed strokes for undo functionality
- `currentStroke` - Stroke currently being drawn
- `cursorPos` - Position of the drawing cursor in canvas coordinates
- `selectedStrokeIdx` - Index of the selected stroke (null = no selection)
- `selectedStrokeCursorPos` - Anchor point for deselection (updated while drawing, set on manual selection)
- `viewTransform` - Canvas transformation (scale, rotation, pan)
