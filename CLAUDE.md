# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebDraw is a browser-based multi-touch drawing application built with TypeScript and Vite. It uses the HTML5 Canvas API with Pointer Events for drawing functionality.

## Commands

- `npm run dev` - Start development server (localhost:127.0.0.1:5173)

No build, test, or lint commands are currently configured.

## Architecture

The application is a single-page web app with three main files:

- **index.html** - Entry point with toolbar UI (color picker, stroke size slider, undo/clear buttons) and canvas element
- **styles.css** - Styling with dark toolbar, responsive canvas, and touch-action prevention
- **src/app.ts** - All application logic

### Core State (src/app.ts)

- `activePointers` (Map) - Tracks active touch points for multi-touch support
- `history` (Array) - Stores completed strokes for undo functionality
- `currentStroke` - Stroke currently being drawn

### Drawing Flow

1. `startDrawing()` on pointerdown - Creates new stroke with current color/size
2. `draw()` on pointermove - Adds points to stroke and renders
3. `stopDrawing()` on pointerup/cancel/leave - Saves stroke to history

The canvas is redrawn from history on undo or resize operations via `redraw()`.
