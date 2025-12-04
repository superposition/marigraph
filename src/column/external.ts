/**
 * External Program Bridge
 * Spawns external programs and bridges their stdin/stdout to column IPC
 */

import { spawn, type Subprocess } from 'bun'

export interface ExternalBridge {
  proc: Subprocess
  send: (data: unknown) => void
  onMessage: (handler: (data: unknown) => void) => void
  kill: () => void
}

/**
 * Spawn an external program and bridge JSON newline protocol
 * External program reads JSON from stdin, writes JSON to stdout
 */
export function spawnExternal(
  cmd: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    onError?: (error: Error) => void
    onExit?: (code: number) => void
  } = {}
): ExternalBridge {
  const proc = spawn({
    cmd,
    cwd: options.cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...options.env,
    },
  })

  let messageHandler: ((data: unknown) => void) | null = null
  let buffer = ''

  // Read stdout and parse JSON lines
  const readStdout = async () => {
    const reader = proc.stdout.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += new TextDecoder().decode(value)

        // Parse complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const data = JSON.parse(line)
            if (messageHandler) {
              messageHandler(data)
            }
          } catch (err) {
            // Not JSON, emit as raw text
            if (messageHandler) {
              messageHandler({ type: 'raw', text: line })
            }
          }
        }
      }
    } catch (err) {
      if (options.onError) {
        options.onError(err as Error)
      }
    }
  }

  // Start reading
  readStdout()

  // Handle process exit
  proc.exited.then((code) => {
    if (options.onExit) {
      options.onExit(code)
    }
  })

  return {
    proc,

    send(data: unknown): void {
      const json = JSON.stringify(data) + '\n'
      proc.stdin.write(json)
      proc.stdin.flush()
    },

    onMessage(handler: (data: unknown) => void): void {
      messageHandler = handler
    },

    kill(): void {
      proc.kill()
    },
  }
}

/**
 * Spawn a shell command with streaming output
 * Output is sent line by line
 */
export function spawnShell(
  command: string,
  options: {
    cwd?: string
    env?: Record<string, string>
    onLine?: (line: string) => void
    onExit?: (code: number) => void
  } = {}
): ExternalBridge {
  const proc = spawn({
    cmd: ['sh', '-c', command],
    cwd: options.cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...options.env,
    },
  })

  let messageHandler: ((data: unknown) => void) | null = null
  let buffer = ''

  // Read stdout line by line
  const readOutput = async (stream: ReadableStream<Uint8Array>, isStderr = false) => {
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += new TextDecoder().decode(value)

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (options.onLine) {
            options.onLine(line)
          }
          if (messageHandler) {
            messageHandler({
              type: isStderr ? 'stderr' : 'stdout',
              line,
            })
          }
        }
      }
    } catch {
      // Stream closed
    }
  }

  readOutput(proc.stdout)
  readOutput(proc.stderr, true)

  proc.exited.then((code) => {
    if (options.onExit) {
      options.onExit(code)
    }
  })

  return {
    proc,

    send(data: unknown): void {
      if (typeof data === 'string') {
        proc.stdin.write(data)
      } else {
        proc.stdin.write(JSON.stringify(data) + '\n')
      }
      proc.stdin.flush()
    },

    onMessage(handler: (data: unknown) => void): void {
      messageHandler = handler
    },

    kill(): void {
      proc.kill()
    },
  }
}

/**
 * Create a data source that periodically runs a command
 */
export function createPollingSource(
  command: string,
  intervalMs: number,
  options: {
    cwd?: string
    parse?: (output: string) => unknown
    onData?: (data: unknown) => void
    onError?: (error: Error) => void
  } = {}
): { start: () => void; stop: () => void } {
  let timer: Timer | null = null
  let running = false

  const poll = async () => {
    if (!running) return

    try {
      const proc = spawn({
        cmd: ['sh', '-c', command],
        cwd: options.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      if (exitCode === 0) {
        const data = options.parse ? options.parse(output) : output.trim()
        if (options.onData) {
          options.onData(data)
        }
      }
    } catch (err) {
      if (options.onError) {
        options.onError(err as Error)
      }
    }

    if (running) {
      timer = setTimeout(poll, intervalMs)
    }
  }

  return {
    start(): void {
      running = true
      poll()
    },

    stop(): void {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/**
 * Create a WebSocket data source
 */
export function createWebSocketSource(
  url: string,
  options: {
    onMessage?: (data: unknown) => void
    onError?: (error: Event) => void
    onClose?: () => void
    reconnect?: boolean
    reconnectDelay?: number
  } = {}
): { send: (data: unknown) => void; close: () => void } {
  let ws: WebSocket | null = null
  let shouldReconnect = options.reconnect ?? true
  const reconnectDelay = options.reconnectDelay ?? 5000

  const connect = () => {
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.error(`WebSocket connected to ${url}`)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (options.onMessage) {
          options.onMessage(data)
        }
      } catch {
        if (options.onMessage) {
          options.onMessage(event.data)
        }
      }
    }

    ws.onerror = (event) => {
      if (options.onError) {
        options.onError(event)
      }
    }

    ws.onclose = () => {
      if (options.onClose) {
        options.onClose()
      }
      if (shouldReconnect) {
        setTimeout(connect, reconnectDelay)
      }
    }
  }

  connect()

  return {
    send(data: unknown): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      }
    },

    close(): void {
      shouldReconnect = false
      if (ws) {
        ws.close()
      }
    },
  }
}
