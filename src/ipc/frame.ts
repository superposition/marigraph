/**
 * Binary frame encode/decode
 * Frame format: [length: u32][type: u8][flags: u8][seq: u16][payload: u8[]]
 */

import {
  type FrameHeader,
  type MessageType,
  FRAME_HEADER_SIZE,
} from './protocol.ts'

// Encode frame header + payload into binary
export function encodeFrame(
  type: MessageType,
  payload: Uint8Array,
  flags = 0,
  seq = 0
): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length)
  const view = new DataView(frame.buffer)

  view.setUint32(0, payload.length, true) // little-endian
  view.setUint8(4, type)
  view.setUint8(5, flags)
  view.setUint16(6, seq, true)
  frame.set(payload, FRAME_HEADER_SIZE)

  return frame
}

// Decode frame header from binary
export function decodeHeader(data: Uint8Array): FrameHeader | null {
  if (data.length < FRAME_HEADER_SIZE) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset)
  return {
    length: view.getUint32(0, true),
    type: view.getUint8(4) as MessageType,
    flags: view.getUint8(5),
    seq: view.getUint16(6, true),
  }
}

// Decode full frame (header + payload)
export function decodeFrame(data: Uint8Array): {
  header: FrameHeader
  payload: Uint8Array
} | null {
  const header = decodeHeader(data)
  if (!header) return null

  if (data.length < FRAME_HEADER_SIZE + header.length) {
    return null // incomplete frame
  }

  const payload = data.slice(
    FRAME_HEADER_SIZE,
    FRAME_HEADER_SIZE + header.length
  )
  return { header, payload }
}

// Frame reader for streaming data
export class FrameReader {
  private buffer: Uint8Array = new Uint8Array(0)

  // Append incoming data to buffer
  append(data: Uint8Array): void {
    const newBuffer = new Uint8Array(this.buffer.length + data.length)
    newBuffer.set(this.buffer)
    newBuffer.set(data, this.buffer.length)
    this.buffer = newBuffer
  }

  // Try to read a complete frame, returns null if incomplete
  read(): { header: FrameHeader; payload: Uint8Array } | null {
    if (this.buffer.length < FRAME_HEADER_SIZE) {
      return null
    }

    const header = decodeHeader(this.buffer)
    if (!header) return null

    const frameSize = FRAME_HEADER_SIZE + header.length
    if (this.buffer.length < frameSize) {
      return null // incomplete frame
    }

    const payload = this.buffer.slice(FRAME_HEADER_SIZE, frameSize)

    // Remove consumed data from buffer
    this.buffer = this.buffer.slice(frameSize)

    return { header, payload }
  }

  // Read all complete frames
  readAll(): Array<{ header: FrameHeader; payload: Uint8Array }> {
    const frames: Array<{ header: FrameHeader; payload: Uint8Array }> = []
    let frame: { header: FrameHeader; payload: Uint8Array } | null
    while ((frame = this.read()) !== null) {
      frames.push(frame)
    }
    return frames
  }

  // Get remaining buffer size
  get pending(): number {
    return this.buffer.length
  }
}

// Encode JSON payload to frame
export function encodeJsonFrame(
  type: MessageType,
  data: unknown,
  flags = 0,
  seq = 0
): Uint8Array {
  const json = JSON.stringify(data)
  const payload = new TextEncoder().encode(json)
  return encodeFrame(type, payload, flags, seq)
}

// Decode JSON payload from frame
export function decodeJsonPayload<T = unknown>(payload: Uint8Array): T {
  const json = new TextDecoder().decode(payload)
  return JSON.parse(json) as T
}

// Encode typed array to frame (with type tag)
export function encodeTypedArrayFrame(
  type: MessageType,
  arr: Float32Array | Float64Array | Uint32Array | Int32Array,
  flags = 0,
  seq = 0
): Uint8Array {
  // Type tag: 0=f32, 1=f64, 2=u32, 3=i32
  let tag: number
  if (arr instanceof Float32Array) tag = 0
  else if (arr instanceof Float64Array) tag = 1
  else if (arr instanceof Uint32Array) tag = 2
  else if (arr instanceof Int32Array) tag = 3
  else throw new Error('Unsupported typed array')

  const payload = new Uint8Array(1 + arr.byteLength)
  payload[0] = tag
  payload.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), 1)

  return encodeFrame(type, payload, flags, seq)
}

// Decode typed array from frame payload
export function decodeTypedArrayPayload(
  payload: Uint8Array
): Float32Array | Float64Array | Uint32Array | Int32Array {
  const tag = payload[0]!
  const data = payload.slice(1)

  switch (tag) {
    case 0:
      return new Float32Array(
        data.buffer,
        data.byteOffset,
        data.byteLength / 4
      )
    case 1:
      return new Float64Array(
        data.buffer,
        data.byteOffset,
        data.byteLength / 8
      )
    case 2:
      return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    case 3:
      return new Int32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    default:
      throw new Error(`Unknown typed array tag: ${tag}`)
  }
}
