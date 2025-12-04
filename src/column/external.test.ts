/**
 * Tests for external program bridge
 */

import { describe, it, expect } from 'bun:test'
import { spawnExternal, spawnShell, createPollingSource } from './external.ts'

describe('External program bridge', () => {
  it('should spawn and communicate with external program', async () => {
    // Use a simple echo script
    const bridge = spawnExternal(['bun', '-e', `
      for await (const line of console) {
        const data = JSON.parse(line)
        console.log(JSON.stringify({ echo: data.message }))
      }
    `])

    const messages: unknown[] = []
    bridge.onMessage((data) => {
      messages.push(data)
    })

    bridge.send({ message: 'hello' })
    bridge.send({ message: 'world' })

    // Wait for responses
    await Bun.sleep(200)

    bridge.kill()

    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0]).toEqual({ echo: 'hello' })
  })

  it('should handle shell command output', async () => {
    const lines: string[] = []

    const bridge = spawnShell('echo "line1" && echo "line2" && echo "line3"', {
      onLine: (line) => lines.push(line),
    })

    // Wait for command to complete
    await bridge.proc.exited

    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  it('should poll command periodically', async () => {
    const results: unknown[] = []

    const source = createPollingSource('echo "polled"', 50, {
      onData: (data) => results.push(data),
    })

    source.start()

    // Wait for a few polls
    await Bun.sleep(180)

    source.stop()

    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]).toBe('polled')
  })

  it('should parse JSON from polling source', async () => {
    const results: unknown[] = []

    const source = createPollingSource('echo \'{"value": 42}\'', 50, {
      parse: (output) => JSON.parse(output),
      onData: (data) => results.push(data),
    })

    source.start()
    await Bun.sleep(100)
    source.stop()

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]).toEqual({ value: 42 })
  })
})
