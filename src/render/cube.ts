/**
 * 3D Cube Renderer
 * Renders wireframe cube with axes, grid, and surface mesh
 */

import type { Point2D, Point3D, Projection, AxisLine } from './project.ts'
import {
  project3D,
  generateBoxWireframe,
  generateAxes,
  generateBottomGrid,
} from './project.ts'

export interface RenderLine {
  x1: number
  y1: number
  x2: number
  y2: number
  depth: number // average depth for z-ordering
  style: 'wireframe' | 'axis' | 'grid' | 'surface'
  zValue?: number // normalized z-value for height-based coloring (-1 to 1)
  normal?: { x: number; y: number; z: number } // surface normal for lighting
  lighting?: number // computed lighting intensity 0-1
}

export interface LightSource {
  x: number
  y: number
  z: number
  intensity: number
  ambient: number  // ambient light level 0-1
  specular: number // specular highlight strength 0-1
}

export interface RenderLabel {
  x: number
  y: number
  text: string
  depth: number
}

export interface CubeFrame {
  lines: RenderLine[]
  labels: RenderLabel[]
  width: number
  height: number
}

/**
 * Render the wireframe cube structure
 */
export function renderWireframe(proj: Projection): RenderLine[] {
  const edges = generateBoxWireframe()
  return edges.map(([p1, p2]) => {
    const s1 = project3D(p1, proj)
    const s2 = project3D(p2, proj)
    return {
      x1: s1.x,
      y1: s1.y,
      x2: s2.x,
      y2: s2.y,
      depth: (s1.depth + s2.depth) / 2,
      style: 'wireframe' as const,
    }
  })
}

/**
 * Render axis lines with labels
 */
export function renderAxes(
  proj: Projection,
  labels: { x: string; y: string; z: string } = { x: 'X', y: 'Y', z: 'Z' }
): { lines: RenderLine[]; labels: RenderLabel[] } {
  const axes = generateAxes()
  const lines: RenderLine[] = []
  const axisLabels: RenderLabel[] = []

  const labelMap: Record<string, string> = {
    X: labels.x,
    Y: labels.y,
    Z: labels.z,
  }

  for (const axis of axes) {
    const s1 = project3D(axis.start, proj)
    const s2 = project3D(axis.end, proj)
    const sLabel = project3D(axis.labelPos, proj)

    lines.push({
      x1: s1.x,
      y1: s1.y,
      x2: s2.x,
      y2: s2.y,
      depth: (s1.depth + s2.depth) / 2,
      style: 'axis',
    })

    axisLabels.push({
      x: sLabel.x,
      y: sLabel.y,
      text: labelMap[axis.label] || axis.label,
      depth: sLabel.depth,
    })
  }

  return { lines, labels: axisLabels }
}

/**
 * Render bottom grid
 */
export function renderGrid(proj: Projection, divisions = 4): RenderLine[] {
  const gridLines = generateBottomGrid(divisions)
  return gridLines.map(([p1, p2]) => {
    const s1 = project3D(p1, proj)
    const s2 = project3D(p2, proj)
    return {
      x1: s1.x,
      y1: s1.y,
      x2: s2.x,
      y2: s2.y,
      depth: (s1.depth + s2.depth) / 2,
      style: 'grid' as const,
    }
  })
}

/**
 * Calculate surface normal at a point using neighboring points
 */
function calculateNormal(
  points: Point3D[][],
  i: number,
  j: number
): { x: number; y: number; z: number } {
  const rows = points.length
  const cols = points[0]?.length || 0
  const p = points[i]![j]!

  // Get neighboring points for gradient calculation
  const left = j > 0 ? points[i]![j - 1]! : p
  const right = j < cols - 1 ? points[i]![j + 1]! : p
  const up = i > 0 ? points[i - 1]![j]! : p
  const down = i < rows - 1 ? points[i + 1]![j]! : p

  // Calculate tangent vectors
  const tx = { x: right.x - left.x, y: right.y - left.y, z: right.z - left.z }
  const ty = { x: down.x - up.x, y: down.y - up.y, z: down.z - up.z }

  // Cross product for normal
  const nx = ty.y * tx.z - ty.z * tx.y
  const ny = ty.z * tx.x - ty.x * tx.z
  const nz = ty.x * tx.y - ty.y * tx.x

  // Normalize
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  return { x: nx / len, y: ny / len, z: nz / len }
}

/**
 * Compute lighting intensity using Phong shading model
 */
function computeLighting(
  normal: { x: number; y: number; z: number },
  point: Point3D,
  light: LightSource,
  viewDir: { x: number; y: number; z: number }
): number {
  // Light direction (from point to light)
  const lx = light.x - point.x
  const ly = light.y - point.y
  const lz = light.z - point.z
  const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1
  const lightDir = { x: lx / lLen, y: ly / lLen, z: lz / lLen }

  // Diffuse lighting (Lambert)
  const diffuse = Math.max(0, normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z)

  // Specular lighting (Phong)
  // Reflect light direction around normal
  const dot = 2 * (normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z)
  const reflectDir = {
    x: dot * normal.x - lightDir.x,
    y: dot * normal.y - lightDir.y,
    z: dot * normal.z - lightDir.z,
  }

  const specDot = Math.max(0, reflectDir.x * viewDir.x + reflectDir.y * viewDir.y + reflectDir.z * viewDir.z)
  const specular = Math.pow(specDot, 16) * light.specular // shininess = 16

  // Combine: ambient + diffuse + specular
  const intensity = light.ambient + (1 - light.ambient) * diffuse * light.intensity + specular

  return Math.min(1, Math.max(0, intensity))
}

/**
 * Default light source (top-right-front)
 */
export const DEFAULT_LIGHT: LightSource = {
  x: 2,
  y: -2,
  z: 3,
  intensity: 1.0,
  ambient: 0.15,
  specular: 0.4,
}

/**
 * Render surface mesh lines from normalized points with lighting
 * Points should be in [-1, 1] range
 */
export function renderSurfaceMesh(
  points: Point3D[][],
  proj: Projection,
  light: LightSource = DEFAULT_LIGHT
): RenderLine[] {
  const lines: RenderLine[] = []
  const rows = points.length
  const cols = points[0]?.length || 0

  // View direction (from camera)
  const azRad = (proj.azimuth * Math.PI) / 180
  const elRad = (proj.elevation * Math.PI) / 180
  const viewDir = {
    x: -Math.cos(elRad) * Math.sin(azRad),
    y: -Math.sin(elRad),
    z: -Math.cos(elRad) * Math.cos(azRad),
  }

  // Horizontal lines (along columns)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const p1 = points[i]![j]!
      const p2 = points[i]![j + 1]!
      const s1 = project3D(p1, proj)
      const s2 = project3D(p2, proj)

      // Calculate normal at midpoint
      const midI = i
      const midJ = Math.min(j, cols - 2)
      const normal = calculateNormal(points, midI, midJ)
      const midPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 }
      const lighting = computeLighting(normal, midPoint, light, viewDir)

      lines.push({
        x1: s1.x,
        y1: s1.y,
        x2: s2.x,
        y2: s2.y,
        depth: (s1.depth + s2.depth) / 2,
        style: 'surface',
        zValue: (p1.z + p2.z) / 2,
        normal,
        lighting,
      })
    }
  }

  // Vertical lines (along rows)
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const p1 = points[i]![j]!
      const p2 = points[i + 1]![j]!
      const s1 = project3D(p1, proj)
      const s2 = project3D(p2, proj)

      // Calculate normal at midpoint
      const midI = Math.min(i, rows - 2)
      const midJ = j
      const normal = calculateNormal(points, midI, midJ)
      const midPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 }
      const lighting = computeLighting(normal, midPoint, light, viewDir)

      lines.push({
        x1: s1.x,
        y1: s1.y,
        x2: s2.x,
        y2: s2.y,
        depth: (s1.depth + s2.depth) / 2,
        style: 'surface',
        zValue: (p1.z + p2.z) / 2,
        normal,
        lighting,
      })
    }
  }

  return lines
}

/**
 * Sort lines by depth for proper z-ordering (back to front)
 */
export function sortByDepth<T extends { depth: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.depth - b.depth)
}

/**
 * Render complete cube frame with all elements
 */
export function renderCubeFrame(
  surfacePoints: Point3D[][] | null,
  proj: Projection,
  options: {
    showWireframe?: boolean
    showGrid?: boolean
    showAxes?: boolean
    gridDivisions?: number
    axisLabels?: { x: string; y: string; z: string }
  } = {}
): CubeFrame {
  const {
    showWireframe = true,
    showGrid = true,
    showAxes = true,
    gridDivisions = 4,
    axisLabels = { x: 'DTE', y: 'Strike', z: 'IV' },
  } = options

  let allLines: RenderLine[] = []
  let allLabels: RenderLabel[] = []

  // Add wireframe
  if (showWireframe) {
    allLines.push(...renderWireframe(proj))
  }

  // Add grid
  if (showGrid) {
    allLines.push(...renderGrid(proj, gridDivisions))
  }

  // Add axes
  if (showAxes) {
    const { lines, labels } = renderAxes(proj, axisLabels)
    allLines.push(...lines)
    allLabels.push(...labels)
  }

  // Add surface mesh
  if (surfacePoints && surfacePoints.length > 0) {
    allLines.push(...renderSurfaceMesh(surfacePoints, proj))
  }

  // Sort by depth
  allLines = sortByDepth(allLines)
  allLabels = sortByDepth(allLabels)

  return {
    lines: allLines,
    labels: allLabels,
    width: proj.centerX * 2,
    height: proj.centerY * 2,
  }
}

/**
 * Convert Surface data to normalized 3D points grid
 */
export function surfaceToPoints(
  x: Float64Array | Float32Array,
  y: Float64Array | Float32Array,
  z: Float64Array | Float32Array,
  nx: number,
  ny: number
): Point3D[][] {
  const points: Point3D[][] = []

  // Find bounds
  let xMin = Infinity,
    xMax = -Infinity
  let yMin = Infinity,
    yMax = -Infinity
  let zMin = Infinity,
    zMax = -Infinity

  for (let i = 0; i < nx; i++) {
    xMin = Math.min(xMin, x[i]!)
    xMax = Math.max(xMax, x[i]!)
  }
  for (let j = 0; j < ny; j++) {
    yMin = Math.min(yMin, y[j]!)
    yMax = Math.max(yMax, y[j]!)
  }
  for (let k = 0; k < z.length; k++) {
    zMin = Math.min(zMin, z[k]!)
    zMax = Math.max(zMax, z[k]!)
  }

  const xRange = xMax - xMin || 1
  const yRange = yMax - yMin || 1
  const zRange = zMax - zMin || 1

  // Create normalized grid
  for (let i = 0; i < nx; i++) {
    const row: Point3D[] = []
    for (let j = 0; j < ny; j++) {
      const zIdx = i * ny + j
      row.push({
        x: ((x[i]! - xMin) / xRange) * 2 - 1,
        y: ((y[j]! - yMin) / yRange) * 2 - 1,
        z: ((z[zIdx]! - zMin) / zRange) * 2 - 1,
      })
    }
    points.push(row)
  }

  return points
}
