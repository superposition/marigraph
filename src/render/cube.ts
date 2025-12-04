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
 * Render surface mesh lines from normalized points
 * Points should be in [-1, 1] range
 */
export function renderSurfaceMesh(
  points: Point3D[][],
  proj: Projection
): RenderLine[] {
  const lines: RenderLine[] = []
  const rows = points.length
  const cols = points[0]?.length || 0

  // Horizontal lines (along columns)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const p1 = points[i]![j]!
      const p2 = points[i]![j + 1]!
      const s1 = project3D(p1, proj)
      const s2 = project3D(p2, proj)
      lines.push({
        x1: s1.x,
        y1: s1.y,
        x2: s2.x,
        y2: s2.y,
        depth: (s1.depth + s2.depth) / 2,
        style: 'surface',
        zValue: (p1.z + p2.z) / 2, // average z for height-based coloring
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
      lines.push({
        x1: s1.x,
        y1: s1.y,
        x2: s2.x,
        y2: s2.y,
        depth: (s1.depth + s2.depth) / 2,
        style: 'surface',
        zValue: (p1.z + p2.z) / 2, // average z for height-based coloring
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
