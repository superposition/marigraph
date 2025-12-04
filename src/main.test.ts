/**
 * Integration tests for main process and column workers
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { Sixcol, type SixcolConfig } from './main.ts'
import { MessageType } from './ipc/protocol.ts'

describe('Sixcol main process', () => {
  let app: Sixcol | null = null

  afterEach(async () => {
    if (app) {
      await app.shutdown()
      app = null
    }
  })

  it('should spawn columns and receive READY', async () => {
    const config: SixcolConfig = {
      name: 'test',
      columns: [
        { id: 'col1', type: 'list' },
        { id: 'col2', type: 'detail' },
      ],
    }

    app = new Sixcol(config)
    await app.start()

    expect(app.columnIds).toEqual(['col1', 'col2'])
    expect(app.getColumn('col1')?.ready).toBe(true)
    expect(app.getColumn('col2')?.ready).toBe(true)
  })

  it('should send messages to columns', async () => {
    const config: SixcolConfig = {
      name: 'test',
      columns: [{ id: 'col1', type: 'list' }],
    }

    app = new Sixcol(config)
    await app.start()

    // Send ping
    const pingPayload = new TextEncoder().encode('test')
    app.sendToColumn('col1', MessageType.PING, pingPayload, 0, 123)

    // Wait a bit for response
    await Bun.sleep(100)

    // Column should still be running
    expect(app.getColumn('col1')?.ready).toBe(true)
  })

  it('should handle multiple columns', async () => {
    const config: SixcolConfig = {
      name: 'test',
      columns: [
        { id: 'c1', type: 'list' },
        { id: 'c2', type: 'detail' },
        { id: 'c3', type: 'log' },
        { id: 'c4', type: 'table' },
      ],
    }

    app = new Sixcol(config)
    await app.start()

    expect(app.columnIds.length).toBe(4)

    for (const id of app.columnIds) {
      expect(app.getColumn(id)?.ready).toBe(true)
    }
  })

  it('should broadcast to all columns', async () => {
    const config: SixcolConfig = {
      name: 'test',
      columns: [
        { id: 'c1', type: 'list' },
        { id: 'c2', type: 'detail' },
      ],
    }

    app = new Sixcol(config)
    await app.start()

    // Broadcast ping
    const payload = new TextEncoder().encode('broadcast-test')
    app.broadcast(MessageType.PING, payload)

    await Bun.sleep(100)

    // All columns should still be running
    for (const id of app.columnIds) {
      expect(app.getColumn(id)?.ready).toBe(true)
    }
  })
})
