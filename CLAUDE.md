# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT**: When modifying the state machine ([src/stateMachine.ts](src/stateMachine.ts)), always update the documentation in STATE_MACHINE.md file synchronously. Keep code and documentation in sync.

## Project Overview

WebDraw is a browser-based multi-touch drawing application built with TypeScript and Vite. It uses the HTML5 Canvas API with Pointer Events for drawing functionality.

## Commands

- `npm run dev` - Start development server (localhost:127.0.0.1:5173)

No build, test, or lint commands are currently configured.

## Architecture

The application uses a state machine architecture with the following main files:

- **index.html** - Entry point with toolbar UI (color picker, stroke size slider, undo/clear buttons, X+ mode checkbox) and canvas element
- **styles.css** - Styling with dark toolbar, responsive canvas, and touch-action prevention
- **src/app.ts** - Main application logic and rendering
- **src/stateMachine.ts** - State machine controlling application behavior
- **src/eventHandler.ts** - Pointer event tracking and state machine event generation
- **src/colorPicker.ts** - Color picker UI component
- **src/sizePicker.ts** - Stroke size picker UI component

### State Machine

The app uses a formal state machine architecture (see [STATE_MACHINE.md](STATE_MACHINE.md) for complete documentation):
- **4 states**: Idle, MovingMarker, Drawing, Transform
- **Events**: Finger down/up, timeouts, movement thresholds, undo/clear
- **Actions**: Returned by state transitions, executed by app.ts
- **Selected Stroke Mode**: After drawing, the stroke is selected (green indicator) and can be transformed independently

### Core State (src/app.ts)

- `strokeHistory` (Array) - Stores completed strokes for undo functionality
- `currentStroke` - Stroke currently being drawn
- `indicatorAnchor` - Position of the drawing marker in canvas coordinates
- `selectedStrokeIdx` - Index of the selected stroke (null = no selection)
- `selectedStrokeMarkerPos` - Reference position when entering selected stroke mode
- `viewTransform` - Canvas transformation (scale, rotation, pan)
