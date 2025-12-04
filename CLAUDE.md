# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # Run TUI with hot reload
bun run start        # Run TUI
bun run cli          # Run CLI (--help for options)
bun test             # Run all tests
bun test src/stats   # Run tests in specific directory
```

## Architecture

Marigraph is a terminal-based volatility surface visualization tool with a multi-process architecture:

### Process Model
- **Main Process** (`src/main.ts`): Spawns column workers via `Bun.spawn()`, routes IPC messages between them
- **Column Workers** (`src/column/worker.ts`): Independent subprocesses that handle widget rendering, communicate via stdin/stdout binary frames
- **TUI** (`src/tui/App.tsx`): Ink/React-based terminal UI that renders the 7-column risk oracle layout

### IPC Protocol
Binary frame format (8-byte header):
- `length: u32` - payload length
- `type: u8` - MessageType enum from `src/ipc/protocol.ts`
- `flags: u8` - compression, request/response flags
- `seq: u16` - sequence number for request/response matching

Messages are encoded/decoded in `src/ipc/frame.ts`, surfaces serialized in `src/ipc/serialize.ts`.

### Data Flow
```
External Data → Main Process → Column Workers → TUI Render
                     ↓
              Unix Sockets (/tmp/marigraph-{id}/*.sock)
                     ↓
              External Programs (JSON-RPC)
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/data/surface.ts` | Surface<Vec64\|Vec32> type, slope computation |
| `src/render/project.ts` | 3D→2D projection with rotation/zoom |
| `src/render/rasterize.ts` | ASCII/braille terminal rasterization |
| `src/stats/welford.ts` | Streaming statistics (Welford's algorithm) |
| `src/surface/svi.ts` | SVI volatility model calibration |
| `src/surface/arbitrage.ts` | Calendar/butterfly arbitrage detection |
| `src/oracle/risk.ts` | Risk metrics computation, term structure/smile analysis |

### Widget Types
Widgets in `src/column/widgets/` are Ink/React components:
- `Surface.tsx` - 3D cube visualization with keyboard controls
- `List.tsx`, `Table.tsx`, `Chart.tsx`, `Log.tsx` - Standard TUI widgets

### Configuration
Templates (`src/config/`) define column layouts and event wiring in YAML/JSON. Event wiring routes messages between columns (e.g., surface update → risk score recalculation).

## Bun-Specific

- Use `bun:test` for testing with `expect()` assertions
- Use `Bun.spawn()` for subprocesses, `Bun.listen()` for Unix sockets
- Use `Bun.sleep()` instead of setTimeout for async delays
- Prefer `Bun.write(Bun.stdout, data)` for binary stdout writes
