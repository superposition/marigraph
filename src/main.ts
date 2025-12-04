/**
 * Main process - spawns column workers and handles IPC routing
 */

import { spawn, type Subprocess } from 'bun'
import { mkdir, rm } from 'node:fs/promises'
import { MessageType, type FrameHeader } from './ipc/protocol.ts'
import { encodeFrame, FrameReader } from './ipc/frame.ts'

export interface ColumnConfig {
  id: string
  type: string
  title?: string
  width?: string | number
  source?: {
    type: string
    value: string
    refresh?: number
  }
  options?: Record<string, unknown>
}

export interface SixcolConfig {
  name: string
  settings?: {
    title?: string
    socketDir?: string
    theme?: string
  }
  columns: ColumnConfig[]
  wiring?: Array<{
    on: { column: string; event: string }
    do: { column: string; method: string }
  }>
}

interface ColumnProcess {
  id: string
  proc: Subprocess
  reader: FrameReader
  ready: boolean
}

export class Sixcol {
  private columns: Map<string, ColumnProcess> = new Map()
  private socketDir: string
  private config: SixcolConfig
  private messageHandlers: Map<string, (header: FrameHeader, payload: Uint8Array) => void> = new Map()

  constructor(config: SixcolConfig) {
    this.config = config
    this.socketDir = config.settings?.socketDir ?? `/tmp/sixcol-${Date.now()}`
  }

  async start(): Promise<void> {
    // Create socket directory
    await mkdir(this.socketDir, { recursive: true })

    // Spawn all columns
    for (const colConfig of this.config.columns) {
      await this.spawnColumn(colConfig)
    }

    // Wait for all columns to report READY
    await this.waitForReady(10000)

    console.log(`Sixcol started with ${this.columns.size} columns`)
  }

  private async spawnColumn(config: ColumnConfig): Promise<void> {
    const proc = spawn({
      cmd: ['bun', 'run', new URL('./column/worker.ts', import.meta.url).pathname],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
      env: {
        ...process.env,
        COLUMN_ID: config.id,
        COLUMN_CONFIG: JSON.stringify(config),
        SOCKET_DIR: this.socketDir,
      },
    })

    const column: ColumnProcess = {
      id: config.id,
      proc,
      reader: new FrameReader(),
      ready: false,
    }

    this.columns.set(config.id, column)

    // Start reading from column's stdout
    this.readFromColumn(column)
  }

  private async readFromColumn(column: ColumnProcess): Promise<void> {
    const reader = column.proc.stdout.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        column.reader.append(value)

        // Process all complete frames
        for (const { header, payload } of column.reader.readAll()) {
          this.handleColumnMessage(column.id, header, payload)
        }
      }
    } catch (err) {
      console.error(`Error reading from column ${column.id}:`, err)
    }
  }

  private handleColumnMessage(
    columnId: string,
    header: FrameHeader,
    payload: Uint8Array
  ): void {
    const column = this.columns.get(columnId)
    if (!column) return

    switch (header.type) {
      case MessageType.READY:
        column.ready = true
        console.log(`Column ${columnId} ready`)
        break

      case MessageType.ERROR:
        const error = JSON.parse(new TextDecoder().decode(payload))
        console.error(`Column ${columnId} error:`, error)
        break

      case MessageType.SELECTED:
      case MessageType.CLICKED:
      case MessageType.SUBMITTED:
        // Route event to wired columns
        this.routeEvent(columnId, header, payload)
        break

      default:
        // Check for custom handlers
        const handler = this.messageHandlers.get(`${columnId}:${header.type}`)
        if (handler) {
          handler(header, payload)
        }
    }
  }

  private routeEvent(
    sourceId: string,
    header: FrameHeader,
    payload: Uint8Array
  ): void {
    if (!this.config.wiring) return

    // Find matching wiring rules
    const eventName = MessageType[header.type]
    for (const wire of this.config.wiring) {
      if (wire.on.column === sourceId && wire.on.event === eventName) {
        // Send to target column
        this.sendToColumn(wire.do.column, MessageType.SET_DATA, payload)
      }
    }
  }

  sendToColumn(
    columnId: string,
    type: MessageType,
    payload: Uint8Array,
    flags = 0,
    seq = 0
  ): void {
    const column = this.columns.get(columnId)
    if (!column) {
      console.error(`Column ${columnId} not found`)
      return
    }

    const frame = encodeFrame(type, payload, flags, seq)
    column.proc.stdin.write(frame)
    column.proc.stdin.flush()
  }

  broadcast(type: MessageType, payload: Uint8Array, flags = 0): void {
    for (const [id] of this.columns) {
      this.sendToColumn(id, type, payload, flags)
    }
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      const allReady = Array.from(this.columns.values()).every((c) => c.ready)
      if (allReady) return
      await Bun.sleep(50)
    }

    const notReady = Array.from(this.columns.values())
      .filter((c) => !c.ready)
      .map((c) => c.id)

    throw new Error(`Columns not ready after ${timeoutMs}ms: ${notReady.join(', ')}`)
  }

  onMessage(
    columnId: string,
    type: MessageType,
    handler: (header: FrameHeader, payload: Uint8Array) => void
  ): () => void {
    const key = `${columnId}:${type}`
    this.messageHandlers.set(key, handler)
    return () => this.messageHandlers.delete(key)
  }

  async shutdown(): Promise<void> {
    // Send SHUTDOWN to all columns
    const shutdownPayload = new TextEncoder().encode(JSON.stringify({ reason: 'shutdown' }))
    this.broadcast(MessageType.SHUTDOWN, shutdownPayload)

    // Wait for processes to exit
    await Promise.all(
      Array.from(this.columns.values()).map((col) => col.proc.exited)
    )

    // Cleanup sockets
    try {
      await rm(this.socketDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }

    console.log('Sixcol shutdown complete')
  }

  getColumn(id: string): ColumnProcess | undefined {
    return this.columns.get(id)
  }

  get columnIds(): string[] {
    return Array.from(this.columns.keys())
  }
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
sixcol - 6-column terminal dashboard

Usage:
  sixcol --template <path>    Run with YAML/JSON template
  sixcol --headless           Run without TUI (IPC only)
  sixcol --help               Show this help

Example:
  sixcol --template ./dashboard.yaml
`)
    process.exit(0)
  }

  // Demo mode - create a simple config
  const demoConfig: SixcolConfig = {
    name: 'demo',
    columns: [
      { id: 'col1', type: 'list', title: 'Column 1' },
      { id: 'col2', type: 'detail', title: 'Column 2' },
      { id: 'col3', type: 'log', title: 'Column 3' },
      { id: 'col4', type: 'table', title: 'Column 4' },
      { id: 'col5', type: 'form', title: 'Column 5' },
      { id: 'col6', type: 'surface', title: 'Column 6' },
    ],
  }

  const app = new Sixcol(demoConfig)

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await app.shutdown()
    process.exit(0)
  })

  app.start().catch((err) => {
    console.error('Failed to start:', err)
    process.exit(1)
  })
}
