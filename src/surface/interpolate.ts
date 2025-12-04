/**
 * Surface Interpolation
 * Bilinear and bicubic interpolation for volatility surfaces
 */

import type { Surface } from '../data/surface.ts'
import type { Vec64 } from '../data/vec.ts'

/**
 * Binary search to find index for interpolation
 * Returns the lower index where values[i] <= target < values[i+1]
 */
export function findIndex(values: ArrayLike<number>, target: number): number {
  const n = values.length
  if (n === 0) return -1
  if (target <= values[0]!) return 0
  if (target >= values[n - 1]!) return n - 2

  let lo = 0
  let hi = n - 1

  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1
    if (values[mid]! <= target) {
      lo = mid
    } else {
      hi = mid
    }
  }

  return lo
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Bilinear interpolation on a 2D grid
 * @param surface - Surface data
 * @param x - X coordinate to interpolate
 * @param y - Y coordinate to interpolate
 */
export function bilinearInterpolate(
  surface: Surface<Vec64>,
  x: number,
  y: number
): number {
  const { nx, ny } = surface

  // Find grid cell
  const xi = findIndex(surface.x, x)
  const yi = findIndex(surface.y, y)

  // Clamp indices
  const x0 = Math.max(0, Math.min(xi, nx - 2))
  const x1 = x0 + 1
  const y0 = Math.max(0, Math.min(yi, ny - 2))
  const y1 = y0 + 1

  // Get corner values
  const z00 = surface.z[x0 * ny + y0]!
  const z01 = surface.z[x0 * ny + y1]!
  const z10 = surface.z[x1 * ny + y0]!
  const z11 = surface.z[x1 * ny + y1]!

  // Compute interpolation weights
  const xRange = surface.x[x1]! - surface.x[x0]!
  const yRange = surface.y[y1]! - surface.y[y0]!

  const tx = xRange !== 0 ? (x - surface.x[x0]!) / xRange : 0
  const ty = yRange !== 0 ? (y - surface.y[y0]!) / yRange : 0

  // Bilinear interpolation
  const z0 = lerp(z00, z01, ty)
  const z1 = lerp(z10, z11, ty)
  return lerp(z0, z1, tx)
}

/**
 * Cubic interpolation helper (Catmull-Rom spline)
 */
function cubicInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const t2 = t * t
  const t3 = t2 * t

  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/**
 * Bicubic interpolation on a 2D grid
 * Uses Catmull-Rom splines for smooth interpolation
 * @param surface - Surface data
 * @param x - X coordinate to interpolate
 * @param y - Y coordinate to interpolate
 */
export function bicubicInterpolate(
  surface: Surface<Vec64>,
  x: number,
  y: number
): number {
  const { nx, ny } = surface

  // Find grid cell
  const xi = findIndex(surface.x, x)
  const yi = findIndex(surface.y, y)

  // Need 4 points in each direction for cubic
  const x1 = Math.max(1, Math.min(xi, nx - 3))
  const y1 = Math.max(1, Math.min(yi, ny - 3))

  // Get 16 surrounding values (4x4 grid)
  const getZ = (i: number, j: number): number => {
    const ci = Math.max(0, Math.min(i, nx - 1))
    const cj = Math.max(0, Math.min(j, ny - 1))
    return surface.z[ci * ny + cj]!
  }

  // Compute interpolation weights
  const xRange = surface.x[x1 + 1]! - surface.x[x1]!
  const yRange = surface.y[y1 + 1]! - surface.y[y1]!

  const tx = xRange !== 0 ? (x - surface.x[x1]!) / xRange : 0
  const ty = yRange !== 0 ? (y - surface.y[y1]!) / yRange : 0

  // Interpolate in y direction for each x
  const cols: number[] = []
  for (let i = -1; i <= 2; i++) {
    const col = cubicInterpolate(
      getZ(x1 + i, y1 - 1),
      getZ(x1 + i, y1),
      getZ(x1 + i, y1 + 1),
      getZ(x1 + i, y1 + 2),
      ty
    )
    cols.push(col)
  }

  // Interpolate in x direction
  return cubicInterpolate(cols[0]!, cols[1]!, cols[2]!, cols[3]!, tx)
}

/**
 * Nearest neighbor interpolation
 */
export function nearestInterpolate(
  surface: Surface<Vec64>,
  x: number,
  y: number
): number {
  const { nx, ny } = surface

  // Find nearest indices
  let xi = 0
  let minXDist = Math.abs(surface.x[0]! - x)
  for (let i = 1; i < nx; i++) {
    const dist = Math.abs(surface.x[i]! - x)
    if (dist < minXDist) {
      minXDist = dist
      xi = i
    }
  }

  let yi = 0
  let minYDist = Math.abs(surface.y[0]! - y)
  for (let j = 1; j < ny; j++) {
    const dist = Math.abs(surface.y[j]! - y)
    if (dist < minYDist) {
      minYDist = dist
      yi = j
    }
  }

  return surface.z[xi * ny + yi]!
}

/**
 * Interpolation method type
 */
export type InterpolationMethod = 'bilinear' | 'bicubic' | 'nearest'

/**
 * Generic interpolation function
 */
export function interpolate(
  surface: Surface<Vec64>,
  x: number,
  y: number,
  method: InterpolationMethod = 'bilinear'
): number {
  switch (method) {
    case 'bicubic':
      return bicubicInterpolate(surface, x, y)
    case 'nearest':
      return nearestInterpolate(surface, x, y)
    case 'bilinear':
    default:
      return bilinearInterpolate(surface, x, y)
  }
}

/**
 * Interpolate along a line (cross-section)
 */
export function interpolateLine(
  surface: Surface<Vec64>,
  start: { x: number; y: number },
  end: { x: number; y: number },
  numPoints: number,
  method: InterpolationMethod = 'bilinear'
): { x: number; y: number; z: number }[] {
  const result: { x: number; y: number; z: number }[] = []

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1)
    const x = lerp(start.x, end.x, t)
    const y = lerp(start.y, end.y, t)
    const z = interpolate(surface, x, y, method)
    result.push({ x, y, z })
  }

  return result
}

/**
 * Resample surface to new grid resolution
 */
export function resampleSurface(
  surface: Surface<Vec64>,
  newNx: number,
  newNy: number,
  method: InterpolationMethod = 'bilinear'
): Surface<Vec64> {
  const xMin = surface.x[0]!
  const xMax = surface.x[surface.nx - 1]!
  const yMin = surface.y[0]!
  const yMax = surface.y[surface.ny - 1]!

  const newX = new Float64Array(newNx)
  const newY = new Float64Array(newNy)
  const newZ = new Float64Array(newNx * newNy)

  // Generate new grid
  for (let i = 0; i < newNx; i++) {
    newX[i] = lerp(xMin, xMax, i / (newNx - 1))
  }
  for (let j = 0; j < newNy; j++) {
    newY[j] = lerp(yMin, yMax, j / (newNy - 1))
  }

  // Interpolate values
  for (let i = 0; i < newNx; i++) {
    for (let j = 0; j < newNy; j++) {
      newZ[i * newNy + j] = interpolate(surface, newX[i]!, newY[j]!, method)
    }
  }

  return {
    x: newX,
    y: newY,
    z: newZ,
    nx: newNx,
    ny: newNy,
    meta: { ...surface.meta },
  }
}

/**
 * Extract slice at fixed X (term structure at fixed strike)
 */
export function sliceAtX(
  surface: Surface<Vec64>,
  xValue: number,
  method: InterpolationMethod = 'bilinear'
): { y: number; z: number }[] {
  const result: { y: number; z: number }[] = []

  for (let j = 0; j < surface.ny; j++) {
    const y = surface.y[j]!
    const z = interpolate(surface, xValue, y, method)
    result.push({ y, z })
  }

  return result
}

/**
 * Extract slice at fixed Y (smile at fixed DTE)
 */
export function sliceAtY(
  surface: Surface<Vec64>,
  yValue: number,
  method: InterpolationMethod = 'bilinear'
): { x: number; z: number }[] {
  const result: { x: number; z: number }[] = []

  for (let i = 0; i < surface.nx; i++) {
    const x = surface.x[i]!
    const z = interpolate(surface, x, yValue, method)
    result.push({ x, z })
  }

  return result
}
