/**
 * 3D to 2D Projection
 * Transforms 3D points to screen coordinates with rotation and zoom
 */

const DEG2RAD = Math.PI / 180

export interface Projection {
  azimuth: number // horizontal rotation (0-360°)
  elevation: number // vertical rotation (-90 to 90°)
  zoom: number // scale factor
  centerX: number // screen center X
  centerY: number // screen center Y
  aspectRatio: number // terminal char aspect ratio (width/height), typically 0.5
}

export interface Point3D {
  x: number
  y: number
  z: number
}

export interface Point2D {
  x: number
  y: number
  depth: number // for z-ordering
}

/**
 * Create default projection
 * Terminal characters are typically ~2x taller than wide, so aspectRatio defaults to 0.5
 */
export function createProjection(
  width: number,
  height: number,
  options: Partial<Projection> = {}
): Projection {
  const aspectRatio = options.aspectRatio ?? 0.5 // Terminal chars are ~2x tall as wide
  return {
    azimuth: options.azimuth ?? 45,
    elevation: options.elevation ?? 30,
    zoom: options.zoom ?? 32, // default 3.2x
    centerX: options.centerX ?? width / 2,
    centerY: options.centerY ?? height / 2,
    aspectRatio,
  }
}

/**
 * Project a 3D point to 2D screen coordinates
 * Uses isometric-style projection with rotation and aspect ratio correction
 */
export function project3D(p: Point3D, proj: Projection): Point2D {
  const azRad = proj.azimuth * DEG2RAD
  const elRad = proj.elevation * DEG2RAD

  const cosA = Math.cos(azRad)
  const sinA = Math.sin(azRad)
  const cosE = Math.cos(elRad)
  const sinE = Math.sin(elRad)

  // Rotate around Z axis (azimuth)
  const x1 = p.x * cosA - p.y * sinA
  const y1 = p.x * sinA + p.y * cosA
  const z1 = p.z

  // Rotate around X axis (elevation)
  const x2 = x1
  const y2 = y1 * cosE - z1 * sinE
  const z2 = y1 * sinE + z1 * cosE

  // Project to 2D (orthographic) with aspect ratio correction
  // Multiply Y by aspectRatio to compensate for tall terminal characters
  return {
    x: proj.centerX + x2 * proj.zoom,
    y: proj.centerY - z2 * proj.zoom * proj.aspectRatio,
    depth: y2, // depth for z-ordering (further = more negative)
  }
}

/**
 * Project array of 3D points
 */
export function projectPoints(points: Point3D[], proj: Projection): Point2D[] {
  return points.map((p) => project3D(p, proj))
}

/**
 * Rotate projection by delta angles
 */
export function rotateProjection(
  proj: Projection,
  deltaAzimuth: number,
  deltaElevation: number
): Projection {
  return {
    ...proj,
    azimuth: (proj.azimuth + deltaAzimuth + 360) % 360,
    elevation: Math.max(-89, Math.min(89, proj.elevation + deltaElevation)),
  }
}

/**
 * Zoom projection
 */
export function zoomProjection(proj: Projection, factor: number): Projection {
  return {
    ...proj,
    zoom: Math.max(1, proj.zoom * factor),
  }
}

/**
 * Normalize a 3D point to [-1, 1] range based on bounds
 */
export function normalizePoint(
  p: Point3D,
  bounds: {
    xMin: number
    xMax: number
    yMin: number
    yMax: number
    zMin: number
    zMax: number
  }
): Point3D {
  const xRange = bounds.xMax - bounds.xMin || 1
  const yRange = bounds.yMax - bounds.yMin || 1
  const zRange = bounds.zMax - bounds.zMin || 1

  return {
    x: ((p.x - bounds.xMin) / xRange) * 2 - 1,
    y: ((p.y - bounds.yMin) / yRange) * 2 - 1,
    z: ((p.z - bounds.zMin) / zRange) * 2 - 1,
  }
}

/**
 * Generate line segments for a 3D box wireframe
 */
export function generateBoxWireframe(): Array<[Point3D, Point3D]> {
  const corners: Point3D[] = [
    { x: -1, y: -1, z: -1 }, // 0: back-bottom-left
    { x: 1, y: -1, z: -1 }, // 1: back-bottom-right
    { x: 1, y: 1, z: -1 }, // 2: front-bottom-right
    { x: -1, y: 1, z: -1 }, // 3: front-bottom-left
    { x: -1, y: -1, z: 1 }, // 4: back-top-left
    { x: 1, y: -1, z: 1 }, // 5: back-top-right
    { x: 1, y: 1, z: 1 }, // 6: front-top-right
    { x: -1, y: 1, z: 1 }, // 7: front-top-left
  ]

  // 12 edges of a cube
  const edges: Array<[number, number]> = [
    // Bottom face
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    // Top face
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    // Vertical edges
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]

  return edges.map(([i, j]) => [corners[i]!, corners[j]!])
}

/**
 * Generate axis lines with labels
 */
export interface AxisLine {
  start: Point3D
  end: Point3D
  label: string
  labelPos: Point3D
}

export function generateAxes(): AxisLine[] {
  return [
    {
      start: { x: -1, y: -1, z: -1 },
      end: { x: 1, y: -1, z: -1 },
      label: 'X',
      labelPos: { x: 1.1, y: -1, z: -1 },
    },
    {
      start: { x: -1, y: -1, z: -1 },
      end: { x: -1, y: 1, z: -1 },
      label: 'Y',
      labelPos: { x: -1, y: 1.1, z: -1 },
    },
    {
      start: { x: -1, y: -1, z: -1 },
      end: { x: -1, y: -1, z: 1 },
      label: 'Z',
      labelPos: { x: -1, y: -1, z: 1.1 },
    },
  ]
}

/**
 * Generate grid lines on the bottom face (z = -1)
 */
export function generateBottomGrid(divisions: number): Array<[Point3D, Point3D]> {
  const lines: Array<[Point3D, Point3D]> = []
  const step = 2 / divisions

  for (let i = 0; i <= divisions; i++) {
    const pos = -1 + i * step
    // Lines parallel to Y axis
    lines.push([
      { x: pos, y: -1, z: -1 },
      { x: pos, y: 1, z: -1 },
    ])
    // Lines parallel to X axis
    lines.push([
      { x: -1, y: pos, z: -1 },
      { x: 1, y: pos, z: -1 },
    ])
  }

  return lines
}
