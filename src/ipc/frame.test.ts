/**
 * Unit tests for frame encode/decode
 */

import { describe, it, expect } from 'bun:test'
import {
  encodeFrame,
  decodeFrame,
  decodeHeader,
  FrameReader,
  encodeJsonFrame,
  decodeJsonPayload,
  encodeTypedArrayFrame,
  decodeTypedArrayPayload,
} from './frame.ts'
import { MessageType, FRAME_HEADER_SIZE } from './protocol.ts'
import { createTestSurface } from '../data/surface.ts'
import { serializeSurface, deserializeSurface } from './serialize.ts'

describe('Frame encode/decode', () => {
  it('should encode and decode frame header', () => {
    const payload = new Uint8Array([1, 2, 3, 4])
    const frame = encodeFrame(MessageType.PING, payload, 0x01, 42)

    const header = decodeHeader(frame)
    expect(header).not.toBeNull()
    expect(header!.length).toBe(4)
    expect(header!.type).toBe(MessageType.PING)
    expect(header!.flags).toBe(0x01)
    expect(header!.seq).toBe(42)
  })

  it('should encode and decode full frame', () => {
    const payload = new Uint8Array([10, 20, 30])
    const frame = encodeFrame(MessageType.SET_DATA, payload, 0, 100)

    const decoded = decodeFrame(frame)
    expect(decoded).not.toBeNull()
    expect(decoded!.header.type).toBe(MessageType.SET_DATA)
    expect(decoded!.header.seq).toBe(100)
    expect(decoded!.payload).toEqual(payload)
  })

  it('should return null for incomplete frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const frame = encodeFrame(MessageType.PING, payload)

    // Truncate frame
    const incomplete = frame.slice(0, FRAME_HEADER_SIZE + 2)
    const decoded = decodeFrame(incomplete)
    expect(decoded).toBeNull()
  })
})

describe('FrameReader streaming', () => {
  it('should read complete frames from chunks', () => {
    const reader = new FrameReader()

    const frame1 = encodeFrame(MessageType.PING, new Uint8Array([1, 2]))
    const frame2 = encodeFrame(MessageType.PONG, new Uint8Array([3, 4, 5]))

    // Combine frames
    const combined = new Uint8Array(frame1.length + frame2.length)
    combined.set(frame1)
    combined.set(frame2, frame1.length)

    // Feed in chunks
    reader.append(combined.slice(0, 5))
    expect(reader.read()).toBeNull() // incomplete

    reader.append(combined.slice(5, 15))
    const first = reader.read()
    expect(first).not.toBeNull()
    expect(first!.header.type).toBe(MessageType.PING)

    reader.append(combined.slice(15))
    const second = reader.read()
    expect(second).not.toBeNull()
    expect(second!.header.type).toBe(MessageType.PONG)
  })

  it('should read all complete frames at once', () => {
    const reader = new FrameReader()

    const frames = [
      encodeFrame(MessageType.INIT, new Uint8Array([1])),
      encodeFrame(MessageType.READY, new Uint8Array([2])),
      encodeFrame(MessageType.PING, new Uint8Array([3])),
    ]

    const combined = new Uint8Array(
      frames.reduce((sum, f) => sum + f.length, 0)
    )
    let offset = 0
    for (const frame of frames) {
      combined.set(frame, offset)
      offset += frame.length
    }

    reader.append(combined)
    const all = reader.readAll()
    expect(all.length).toBe(3)
    expect(all[0]!.header.type).toBe(MessageType.INIT)
    expect(all[1]!.header.type).toBe(MessageType.READY)
    expect(all[2]!.header.type).toBe(MessageType.PING)
  })
})

describe('JSON frame encoding', () => {
  it('should encode and decode JSON payload', () => {
    const data = { foo: 'bar', num: 42, arr: [1, 2, 3] }
    const frame = encodeJsonFrame(MessageType.SET_DATA, data)

    const decoded = decodeFrame(frame)
    expect(decoded).not.toBeNull()

    const payload = decodeJsonPayload(decoded!.payload)
    expect(payload).toEqual(data)
  })
})

describe('TypedArray frame encoding', () => {
  it('should encode and decode Float32Array', () => {
    const arr = new Float32Array([1.5, 2.5, 3.5])
    const frame = encodeTypedArrayFrame(MessageType.SURFACE_FULL, arr)

    const decoded = decodeFrame(frame)
    expect(decoded).not.toBeNull()

    const result = decodeTypedArrayPayload(decoded!.payload) as Float32Array
    expect(result).toBeInstanceOf(Float32Array)
    expect(Array.from(result)).toEqual([1.5, 2.5, 3.5])
  })

  it('should encode and decode Float64Array', () => {
    const arr = new Float64Array([1.123456789, 2.987654321])
    const frame = encodeTypedArrayFrame(MessageType.SURFACE_FULL, arr)

    const decoded = decodeFrame(frame)
    const result = decodeTypedArrayPayload(decoded!.payload) as Float64Array
    expect(result).toBeInstanceOf(Float64Array)
    expect(result[0]).toBeCloseTo(1.123456789, 8)
    expect(result[1]).toBeCloseTo(2.987654321, 8)
  })

  it('should encode and decode Uint32Array', () => {
    const arr = new Uint32Array([1000000, 2000000, 3000000])
    const frame = encodeTypedArrayFrame(MessageType.SURFACE_DELTA, arr)

    const decoded = decodeFrame(frame)
    const result = decodeTypedArrayPayload(decoded!.payload) as Uint32Array
    expect(result).toBeInstanceOf(Uint32Array)
    expect(Array.from(result)).toEqual([1000000, 2000000, 3000000])
  })
})

describe('Surface serialization', () => {
  it('should serialize and deserialize surface', () => {
    const surface = createTestSurface(10, 10)

    const frame = serializeSurface(surface)
    const decoded = decodeFrame(frame)
    expect(decoded).not.toBeNull()

    const result = deserializeSurface(decoded!.payload)

    expect(result.nx).toBe(surface.nx)
    expect(result.ny).toBe(surface.ny)
    expect(result.meta.xLabel).toBe(surface.meta.xLabel)
    expect(result.meta.yLabel).toBe(surface.meta.yLabel)
    expect(result.meta.zLabel).toBe(surface.meta.zLabel)

    // Check values (f32 precision)
    for (let i = 0; i < surface.nx; i++) {
      expect(result.x[i]).toBeCloseTo(surface.x[i]!, 5)
    }
    for (let i = 0; i < surface.ny; i++) {
      expect(result.y[i]).toBeCloseTo(surface.y[i]!, 5)
    }
    for (let i = 0; i < surface.nx * surface.ny; i++) {
      expect(result.z[i]).toBeCloseTo(surface.z[i]!, 5)
    }
  })

  it('should preserve surface metadata', () => {
    const surface = createTestSurface(5, 5)

    const frame = serializeSurface(surface)
    const decoded = decodeFrame(frame)
    const result = deserializeSurface(decoded!.payload)

    expect(result.meta.xDomain[0]).toBeCloseTo(surface.meta.xDomain[0], 5)
    expect(result.meta.xDomain[1]).toBeCloseTo(surface.meta.xDomain[1], 5)
    expect(result.meta.yDomain[0]).toBeCloseTo(surface.meta.yDomain[0], 5)
    expect(result.meta.yDomain[1]).toBeCloseTo(surface.meta.yDomain[1], 5)
  })
})
