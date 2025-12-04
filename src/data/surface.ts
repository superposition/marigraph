/**
 * Surface<T> - 3D grid data structure
 * Row-major flattened z array: z[xi][yi] = z[xi * ny + yi]
 */

import { type Vec64, type Vec32, vec64, toDisplay, minmax } from './vec.ts'

export interface SurfaceMeta {
  xLabel: string
  yLabel: string
  zLabel: string
  xDomain: [number, number]
  yDomain: [number, number]
  zDomain: [number, number]
  timestamp: number
}

export interface Surface<T extends Vec64 | Vec32 = Vec64> {
  x: T // x-axis values (length: nx)
  y: T // y-axis values (length: ny)
  z: T // z values row-major (length: nx * ny)
  nx: number
  ny: number
  meta: SurfaceMeta
}

// Create surface with computed domains
export function createSurface(
  x: Vec64,
  y: Vec64,
  z: Vec64,
  labels: { x?: string; y?: string; z?: string } = {}
): Surface<Vec64> {
  const nx = x.length
  const ny = y.length

  if (z.length !== nx * ny) {
    throw new Error(`z length ${z.length} does not match nx*ny ${nx * ny}`)
  }

  return {
    x,
    y,
    z,
    nx,
    ny,
    meta: {
      xLabel: labels.x ?? 'X',
      yLabel: labels.y ?? 'Y',
      zLabel: labels.z ?? 'Z',
      xDomain: minmax(x),
      yDomain: minmax(y),
      zDomain: minmax(z),
      timestamp: Date.now(),
    },
  }
}

// Access z value at grid indices
export function getZ<T extends Vec64 | Vec32>(
  s: Surface<T>,
  xi: number,
  yi: number
): number {
  return s.z[xi * s.ny + yi]!
}

// Set z value at grid indices
export function setZ<T extends Vec64 | Vec32>(
  s: Surface<T>,
  xi: number,
  yi: number,
  value: number
): void {
  s.z[xi * s.ny + yi] = value
}

// Get row (fixed x index)
export function getRow<T extends Vec64 | Vec32>(s: Surface<T>, xi: number): T {
  const start = xi * s.ny
  return s.z.slice(start, start + s.ny) as T
}

// Get column (fixed y index)
export function getCol<T extends Vec64 | Vec32>(s: Surface<T>, yi: number): T {
  const Constructor = s.z.constructor as new (length: number) => T
  const result = new Constructor(s.nx)
  for (let xi = 0; xi < s.nx; xi++) {
    result[xi] = getZ(s, xi, yi)
  }
  return result
}

// Convert f64 surface to f32 for display/IPC
export function toDisplaySurface(s: Surface<Vec64>): Surface<Vec32> {
  return {
    x: toDisplay(s.x),
    y: toDisplay(s.y),
    z: toDisplay(s.z),
    nx: s.nx,
    ny: s.ny,
    meta: { ...s.meta },
  }
}

// Bilinear interpolation at arbitrary (x, y) point
export function interpolate(s: Surface<Vec64>, x: number, y: number): number {
  // Find grid cell containing (x, y)
  let xi0 = 0
  let yi0 = 0

  // Find x index
  for (let i = 0; i < s.nx - 1; i++) {
    if (s.x[i]! <= x && x <= s.x[i + 1]!) {
      xi0 = i
      break
    }
  }

  // Find y index
  for (let j = 0; j < s.ny - 1; j++) {
    if (s.y[j]! <= y && y <= s.y[j + 1]!) {
      yi0 = j
      break
    }
  }

  const xi1 = Math.min(xi0 + 1, s.nx - 1)
  const yi1 = Math.min(yi0 + 1, s.ny - 1)

  // Compute interpolation weights
  const x0 = s.x[xi0]!
  const x1 = s.x[xi1]!
  const y0 = s.y[yi0]!
  const y1 = s.y[yi1]!

  const tx = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
  const ty = y1 === y0 ? 0 : (y - y0) / (y1 - y0)

  // Get corner values
  const z00 = getZ(s, xi0, yi0)
  const z10 = getZ(s, xi1, yi0)
  const z01 = getZ(s, xi0, yi1)
  const z11 = getZ(s, xi1, yi1)

  // Bilinear interpolation
  const z0 = z00 * (1 - tx) + z10 * tx
  const z1 = z01 * (1 - tx) + z11 * tx
  return z0 * (1 - ty) + z1 * ty
}

// Compute gradient (∂z/∂x, ∂z/∂y) at each point
export interface SlopeData {
  dz_dx: Vec64 // partial derivative w.r.t. x
  dz_dy: Vec64 // partial derivative w.r.t. y
  magnitude: Vec64 // √(dz_dx² + dz_dy²)
  angle: Vec64 // atan2(dz_dy, dz_dx)
}

export function computeSlope(s: Surface<Vec64>): SlopeData {
  const n = s.nx * s.ny
  const dz_dx = vec64(n)
  const dz_dy = vec64(n)
  const magnitude = vec64(n)
  const angle = vec64(n)

  for (let xi = 0; xi < s.nx; xi++) {
    for (let yi = 0; yi < s.ny; yi++) {
      const idx = xi * s.ny + yi

      // Central differences (forward/backward at edges)
      let dx: number
      let dy: number

      if (xi === 0) {
        dx =
          (getZ(s, xi + 1, yi) - getZ(s, xi, yi)) / (s.x[xi + 1]! - s.x[xi]!)
      } else if (xi === s.nx - 1) {
        dx =
          (getZ(s, xi, yi) - getZ(s, xi - 1, yi)) / (s.x[xi]! - s.x[xi - 1]!)
      } else {
        dx =
          (getZ(s, xi + 1, yi) - getZ(s, xi - 1, yi)) /
          (s.x[xi + 1]! - s.x[xi - 1]!)
      }

      if (yi === 0) {
        dy =
          (getZ(s, xi, yi + 1) - getZ(s, xi, yi)) / (s.y[yi + 1]! - s.y[yi]!)
      } else if (yi === s.ny - 1) {
        dy =
          (getZ(s, xi, yi) - getZ(s, xi, yi - 1)) / (s.y[yi]! - s.y[yi - 1]!)
      } else {
        dy =
          (getZ(s, xi, yi + 1) - getZ(s, xi, yi - 1)) /
          (s.y[yi + 1]! - s.y[yi - 1]!)
      }

      dz_dx[idx] = dx
      dz_dy[idx] = dy
      magnitude[idx] = Math.sqrt(dx * dx + dy * dy)
      angle[idx] = Math.atan2(dy, dx)
    }
  }

  return { dz_dx, dz_dy, magnitude, angle }
}

// Create test surface (sine wave)
export function createTestSurface(
  nx: number,
  ny: number,
  freqX = 1,
  freqY = 1
): Surface<Vec64> {
  const x = vec64(nx)
  const y = vec64(ny)
  const z = vec64(nx * ny)

  for (let i = 0; i < nx; i++) {
    x[i] = i / (nx - 1)
  }
  for (let j = 0; j < ny; j++) {
    y[j] = j / (ny - 1)
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      z[i * ny + j] =
        Math.sin(x[i]! * Math.PI * 2 * freqX) *
        Math.cos(y[j]! * Math.PI * 2 * freqY)
    }
  }

  return createSurface(x, y, z, { x: 'X', y: 'Y', z: 'Z' })
}
