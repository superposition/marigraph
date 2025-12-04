/**
 * Column Worker - subprocess that handles widget rendering and IPC
 */

import { type Socket } from 'bun'
import { MessageType, type FrameHeader } from '../ipc/protocol.ts'
import { encodeFrame, FrameReader, decodeFrame } from '../ipc/frame.ts'

// Get config from environment
const columnId = process.env.COLUMN_ID!
const config = JSON.parse(process.env.COLUMN_CONFIG!)
const socketDir = process.env.SOCKET_DIR!
const socketPath = `${socketDir}/${columnId}.sock`

// Frame reader for stdin
const stdinReader = new FrameReader()

// Connected external clients
const externalClients = new Set<Socket>()

// Widget state
let widgetData: unknown = null

// Message handlers
type MessageHandler = (header: FrameHeader, payload: Uint8Array) => void
const messageHandlers = new Map<MessageType, MessageHandler>()

// Send frame to parent via stdout
function sendToParent(
  type: MessageType,
  payload: Uint8Array,
  flags = 0,
  seq = 0
): void {
  const frame = encodeFrame(type, payload, flags, seq)
  Bun.write(Bun.stdout, frame)
}

// Send JSON message to parent
function sendJsonToParent(type: MessageType, data: unknown): void {
  const payload = new TextEncoder().encode(JSON.stringify(data))
  sendToParent(type, payload)
}

// Broadcast to all connected external clients
function broadcastToExternal(data: Uint8Array): void {
  for (const client of externalClients) {
    client.write(data)
  }
}

// Handle message from parent
function handleParentMessage(header: FrameHeader, payload: Uint8Array): void {
  const handler = messageHandlers.get(header.type)
  if (handler) {
    handler(header, payload)
    return
  }

  // Default handlers
  switch (header.type) {
    case MessageType.INIT:
      // Already initialized via env
      break

    case MessageType.SHUTDOWN:
      shutdown()
      break

    case MessageType.PING:
      sendToParent(MessageType.PONG, payload, 0, header.seq)
      break

    case MessageType.SET_DATA:
      const data = JSON.parse(new TextDecoder().decode(payload))
      widgetData = data
      // TODO: trigger re-render
      break

    case MessageType.CLEAR:
      widgetData = null
      break

    default:
      console.error(`[${columnId}] Unknown message type: ${header.type}`)
  }
}

// Handle message from external client
function handleExternalMessage(socket: Socket, data: Buffer): void {
  try {
    // Try to parse as JSON-RPC
    const text = data.toString()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue

      const msg = JSON.parse(line)

      if (msg.method === 'setData') {
        widgetData = msg.params?.data
        // Notify parent
        sendJsonToParent(MessageType.SET_DATA, {
          columnId,
          data: widgetData,
        })
      } else if (msg.method === 'getData') {
        socket.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: widgetData,
          }) + '\n'
        )
      } else if (msg.method === 'subscribe') {
        // Client wants to receive updates
        // Already in externalClients set
      }
    }
  } catch (err) {
    console.error(`[${columnId}] Error parsing external message:`, err)
  }
}

// Start unix socket server for external programs
async function startSocketServer(): Promise<void> {
  try {
    Bun.listen({
      unix: socketPath,
      socket: {
        open(socket) {
          externalClients.add(socket)
          console.error(`[${columnId}] External client connected`)
        },
        close(socket) {
          externalClients.delete(socket)
          console.error(`[${columnId}] External client disconnected`)
        },
        data(socket, data) {
          handleExternalMessage(socket, data)
        },
        error(socket, error) {
          console.error(`[${columnId}] Socket error:`, error)
        },
      },
    })
    console.error(`[${columnId}] Socket server listening at ${socketPath}`)
  } catch (err) {
    console.error(`[${columnId}] Failed to start socket server:`, err)
  }
}

// Read from stdin
async function readStdin(): Promise<void> {
  const reader = Bun.stdin.stream().getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      stdinReader.append(value)

      // Process all complete frames
      for (const { header, payload } of stdinReader.readAll()) {
        handleParentMessage(header, payload)
      }
    }
  } catch (err) {
    console.error(`[${columnId}] Error reading stdin:`, err)
  }

  // Stdin closed, shutdown
  shutdown()
}

// Graceful shutdown
function shutdown(): void {
  console.error(`[${columnId}] Shutting down`)
  process.exit(0)
}

// Register message handler
export function onMessage(type: MessageType, handler: MessageHandler): void {
  messageHandlers.set(type, handler)
}

// Get current widget data
export function getData(): unknown {
  return widgetData
}

// Set widget data and notify parent
export function setData(data: unknown): void {
  widgetData = data
  sendJsonToParent(MessageType.SET_DATA, { columnId, data })
}

// Emit event to parent
export function emit(event: MessageType, data: unknown): void {
  sendJsonToParent(event, { columnId, ...data })
}

// Main entry
async function main(): Promise<void> {
  console.error(`[${columnId}] Worker starting, config:`, config)

  // Start socket server
  await startSocketServer()

  // Signal ready to parent
  sendJsonToParent(MessageType.READY, { columnId })

  // Start reading from parent
  await readStdin()
}

main().catch((err) => {
  console.error(`[${columnId}] Fatal error:`, err)
  process.exit(1)
})

// Export for use by widget components
export { columnId, config, socketPath, sendToParent, sendJsonToParent }
