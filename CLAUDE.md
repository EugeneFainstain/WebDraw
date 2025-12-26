# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT**: When modifying the state machine ([src/stateMachine.ts](src/stateMachine.ts)), always update this documentation file synchronously. Keep code and documentation in sync.

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

### State Machine (src/stateMachine.ts)

The app uses a formal state machine with 4 states:
- **Idle** - No fingers touching
- **MovingMarker** - One finger moving the drawing marker
- **Drawing** - Two fingers drawing a stroke
- **Transform** - Three fingers transforming canvas or fresh stroke

#### Key Transitions

- **Drawing + FINGER_UP** → **MovingMarker** (one finger lifted, continue with remaining finger, stroke saved)
- **Transform + FINGER_UP** → **Idle** (finger lifted during transform)

#### Fresh Stroke Mode

After completing a stroke, the app enters "Fresh Stroke" mode:
- Indicator shows **green (lime)** instead of white
- 3-finger transform affects **only the last stroke** instead of the entire canvas
- Allows quick adjustment of the just-drawn stroke

**Exit conditions for Fresh Stroke mode:**
1. **Single tap** - Quick tap (finger down and up within 250ms, no movement >30px)
2. **Moving marker far** - Moving the marker >30px from the fresh stroke position
3. **Undo/Clear** - Using undo or clear buttons
4. **Too many fingers** - Touching with 3+ fingers during marker movement

### Core State (src/app.ts)

- `strokeHistory` (Array) - Stores completed strokes for undo functionality
- `currentStroke` - Stroke currently being drawn
- `indicatorAnchor` - Position of the drawing marker in canvas coordinates
- `freshStrokeMarkerPos` - Reference position when entering fresh stroke mode
- `viewTransform` - Canvas transformation (scale, rotation, pan)
