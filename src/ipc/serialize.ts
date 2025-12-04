/**
 * Serialization for Surface and other data types
 * Converts f64 computation data to f32 wire format
 */

import type { Surface } from '../data/surface.ts'
import type { Vec64, Vec32 } from '../data/vec.ts'
import { MessageType, type SurfaceFullMessage } from './protocol.ts'
import { encodeFrame } from './frame.ts'

// Serialize Surface to binary frame
// Layout: [nx:u32][ny:u32][meta:json_len:u32][meta:json][x:f32*nx][y:f32*ny][z:f32*nx*ny]
export function serializeSurface(s: Surface<Vec64>): Uint8Array {
  const { nx, ny } = s

  // Encode metadata as JSON
  const metaJson = JSON.stringify({
    xLabel: s.meta.xLabel,
    yLabel: s.meta.yLabel,
    zLabel: s.meta.zLabel,
    xDomain: s.meta.xDomain,
    yDomain: s.meta.yDomain,
    zDomain: s.meta.zDomain,
    timestamp: s.meta.timestamp,
  })
  const metaBytes = new TextEncoder().encode(metaJson)

  // Calculate total size with alignment padding
  // 4 (nx) + 4 (ny) + 4 (meta_len) + meta_len + padding + 4*nx + 4*ny + 4*nx*ny
  const headerSize = 4 + 4 + 4 + metaBytes.length
  // Align to 4 bytes for Float32Array
  const padding = (4 - (headerSize % 4)) % 4
  const dataSize = (nx + ny + nx * ny) * 4
  const totalSize = headerSize + padding + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  let offset = 0

  // Write dimensions
  view.setUint32(offset, nx, true)
  offset += 4
  view.setUint32(offset, ny, true)
  offset += 4

  // Write metadata
  view.setUint32(offset, metaBytes.length, true)
  offset += 4
  bytes.set(metaBytes, offset)
  offset += metaBytes.length

  // Add padding for alignment
  offset += padding

  // Write x, y, z as f32
  const f32View = new Float32Array(
    buffer,
    offset,
    nx + ny + nx * ny
  )
  let f32Offset = 0

  for (let i = 0; i < nx; i++) {
    f32View[f32Offset++] = s.x[i]!
  }
  for (let i = 0; i < ny; i++) {
    f32View[f32Offset++] = s.y[i]!
  }
  for (let i = 0; i < nx * ny; i++) {
    f32View[f32Offset++] = s.z[i]!
  }

  return encodeFrame(MessageType.SURFACE_FULL, bytes)
}

// Deserialize Surface from binary payload
export function deserializeSurface(
  payload: Uint8Array
): Surface<Vec32> {
  const view = new DataView(payload.buffer, payload.byteOffset)
  let offset = 0

  // Read dimensions
  const nx = view.getUint32(offset, true)
  offset += 4
  const ny = view.getUint32(offset, true)
  offset += 4

  // Read metadata
  const metaLen = view.getUint32(offset, true)
  offset += 4
  const metaBytes = payload.slice(offset, offset + metaLen)
  const meta = JSON.parse(new TextDecoder().decode(metaBytes))
  offset += metaLen

  // Skip alignment padding
  const headerSize = 4 + 4 + 4 + metaLen
  const padding = (4 - (headerSize % 4)) % 4
  offset += padding

  // Read x, y, z as f32
  const f32Data = new Float32Array(
    payload.buffer,
    payload.byteOffset + offset,
    nx + ny + nx * ny
  )

  const x = f32Data.slice(0, nx)
  const y = f32Data.slice(nx, nx + ny)
  const z = f32Data.slice(nx + ny)

  return {
    x,
    y,
    z,
    nx,
    ny,
    meta: {
      xLabel: meta.xLabel,
      yLabel: meta.yLabel,
      zLabel: meta.zLabel,
      xDomain: meta.xDomain,
      yDomain: meta.yDomain,
      zDomain: meta.zDomain,
      timestamp: meta.timestamp,
    },
  }
}

// Serialize delta update (only changed cells)
export function serializeSurfaceDelta(
  indices: Uint32Array,
  values: Float32Array
): Uint8Array {
  // Layout: [count:u32][indices:u32*count][values:f32*count]
  const count = indices.length
  const size = 4 + count * 4 + count * 4
  const buffer = new ArrayBuffer(size)
  const view = new DataView(buffer)

  view.setUint32(0, count, true)

  const indicesView = new Uint32Array(buffer, 4, count)
  indicesView.set(indices)

  const valuesView = new Float32Array(buffer, 4 + count * 4, count)
  valuesView.set(values)

  return encodeFrame(MessageType.SURFACE_DELTA, new Uint8Array(buffer))
}

// Deserialize delta update
export function deserializeSurfaceDelta(payload: Uint8Array): {
  indices: Uint32Array
  values: Float32Array
} {
  const view = new DataView(payload.buffer, payload.byteOffset)
  const count = view.getUint32(0, true)

  const indices = new Uint32Array(
    payload.buffer,
    payload.byteOffset + 4,
    count
  )
  const values = new Float32Array(
    payload.buffer,
    payload.byteOffset + 4 + count * 4,
    count
  )

  return { indices, values }
}
