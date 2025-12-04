/**
 * Vec64/Vec32 TypedArray utilities
 * f64 for computation, f32 for display/IPC
 */

export type Vec64 = Float64Array
export type Vec32 = Float32Array

// Conversion utilities
export const toDisplay = (v: Vec64): Vec32 => new Float32Array(v)
export const toCompute = (v: Vec32): Vec64 => new Float64Array(v)

// Create vectors
export const vec64 = (length: number): Vec64 => new Float64Array(length)
export const vec32 = (length: number): Vec32 => new Float32Array(length)

export const vec64From = (arr: ArrayLike<number>): Vec64 => new Float64Array(arr)
export const vec32From = (arr: ArrayLike<number>): Vec32 => new Float32Array(arr)

// Concatenate typed arrays
export function concat<T extends Vec64 | Vec32>(
  Constructor: new (length: number) => T,
  ...arrays: T[]
): T {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Constructor(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

export const concat64 = (...arrays: Vec64[]): Vec64 =>
  concat(Float64Array, ...arrays)

export const concat32 = (...arrays: Vec32[]): Vec32 =>
  concat(Float32Array, ...arrays)

// Basic math operations (in-place where possible)
export function add(a: Vec64, b: Vec64, out?: Vec64): Vec64 {
  const result = out ?? vec64(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! + b[i]!
  }
  return result
}

export function sub(a: Vec64, b: Vec64, out?: Vec64): Vec64 {
  const result = out ?? vec64(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! - b[i]!
  }
  return result
}

export function mul(a: Vec64, b: Vec64, out?: Vec64): Vec64 {
  const result = out ?? vec64(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! * b[i]!
  }
  return result
}

export function scale(a: Vec64, scalar: number, out?: Vec64): Vec64 {
  const result = out ?? vec64(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! * scalar
  }
  return result
}

// Reduction operations
export function sum(v: Vec64): number {
  let total = 0
  for (let i = 0; i < v.length; i++) {
    total += v[i]!
  }
  return total
}

export function min(v: Vec64): number {
  let m = Infinity
  for (let i = 0; i < v.length; i++) {
    if (v[i]! < m) m = v[i]!
  }
  return m
}

export function max(v: Vec64): number {
  let m = -Infinity
  for (let i = 0; i < v.length; i++) {
    if (v[i]! > m) m = v[i]!
  }
  return m
}

export function minmax(v: Vec64): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < v.length; i++) {
    const val = v[i]!
    if (val < lo) lo = val
    if (val > hi) hi = val
  }
  return [lo, hi]
}

// Linear interpolation
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Clamp value to range
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

// Normalize to [0, 1] range
export function normalize(v: Vec64, out?: Vec64): Vec64 {
  const [lo, hi] = minmax(v)
  const range = hi - lo
  const result = out ?? vec64(v.length)

  if (range === 0) {
    result.fill(0)
  } else {
    for (let i = 0; i < v.length; i++) {
      result[i] = (v[i]! - lo) / range
    }
  }
  return result
}

// Fill with linspace values
export function linspace(start: number, end: number, n: number): Vec64 {
  const result = vec64(n)
  const step = (end - start) / (n - 1)
  for (let i = 0; i < n; i++) {
    result[i] = start + i * step
  }
  return result
}

// Copy typed array
export function copy<T extends Vec64 | Vec32>(v: T): T {
  return v.slice() as T
}
