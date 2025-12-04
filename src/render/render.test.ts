/**
 * Tests for 3D rendering modules
 */

import { describe, it, expect } from 'bun:test'
import {
  createProjection,
  project3D,
  rotateProjection,
  zoomProjection,
  generateBoxWireframe,
  generateAxes,
  generateBottomGrid,
  normalizePoint,
} from './project.ts'
import {
  renderWireframe,
  renderAxes,
  renderGrid,
  renderSurfaceMesh,
  renderCubeFrame,
  surfaceToPoints,
  sortByDepth,
} from './cube.ts'
import {
  createBuffer,
  setChar,
  drawLine,
  drawText,
  rasterizeCubeFrame,
  bufferToString,
  intensityChar,
} from './rasterize.ts'
import {
  lerpColor,
  sampleGradient,
  slopeToColor,
  directionToColor,
  computeRiskMetrics,
  formatRiskScore,
  slopeToColorGrid,
  GRADIENT_PRESETS,
} from './gradient.ts'

describe('3D Projection', () => {
  it('should create default projection', () => {
    const proj = createProjection(100, 80)
    expect(proj.azimuth).toBe(45)
    expect(proj.elevation).toBe(30)
    expect(proj.centerX).toBe(50)
    expect(proj.centerY).toBe(40)
    expect(proj.zoom).toBe(32) // default 3.2x zoom
  })

  it('should project origin to center', () => {
    const proj = createProjection(100, 100, { azimuth: 0, elevation: 0 })
    const point2d = project3D({ x: 0, y: 0, z: 0 }, proj)
    expect(point2d.x).toBeCloseTo(50)
    expect(point2d.y).toBeCloseTo(50)
  })

  it('should rotate projection', () => {
    const proj = createProjection(100, 100, { azimuth: 0, elevation: 0 })
    const rotated = rotateProjection(proj, 45, 30)
    expect(rotated.azimuth).toBe(45)
    expect(rotated.elevation).toBe(30)
  })

  it('should clamp elevation to valid range', () => {
    const proj = createProjection(100, 100, { elevation: 80 })
    const rotated = rotateProjection(proj, 0, 20)
    expect(rotated.elevation).toBe(89) // Clamped to max
  })

  it('should wrap azimuth around 360', () => {
    const proj = createProjection(100, 100, { azimuth: 350 })
    const rotated = rotateProjection(proj, 20, 0)
    expect(rotated.azimuth).toBe(10) // Wrapped
  })

  it('should zoom projection', () => {
    const proj = createProjection(100, 100)
    const zoomed = zoomProjection(proj, 2)
    expect(zoomed.zoom).toBe(proj.zoom * 2)
  })

  it('should generate box wireframe with 12 edges', () => {
    const edges = generateBoxWireframe()
    expect(edges.length).toBe(12)
  })

  it('should generate 3 axes', () => {
    const axes = generateAxes()
    expect(axes.length).toBe(3)
    expect(axes.map((a) => a.label)).toEqual(['X', 'Y', 'Z'])
  })

  it('should generate grid lines', () => {
    const grid = generateBottomGrid(4)
    expect(grid.length).toBe(10) // (4+1)*2 lines
  })

  it('should normalize points to [-1, 1] range', () => {
    const bounds = { xMin: 0, xMax: 100, yMin: 0, yMax: 200, zMin: 0, zMax: 50 }
    const point = normalizePoint({ x: 50, y: 100, z: 25 }, bounds)
    expect(point.x).toBeCloseTo(0)
    expect(point.y).toBeCloseTo(0)
    expect(point.z).toBeCloseTo(0)
  })
})

describe('Cube Rendering', () => {
  it('should render wireframe lines', () => {
    const proj = createProjection(100, 100)
    const lines = renderWireframe(proj)
    expect(lines.length).toBe(12)
    expect(lines[0]!.style).toBe('wireframe')
  })

  it('should render axes with labels', () => {
    const proj = createProjection(100, 100)
    const { lines, labels } = renderAxes(proj, { x: 'DTE', y: 'Strike', z: 'IV' })
    expect(lines.length).toBe(3)
    expect(labels.length).toBe(3)
    expect(labels.map((l) => l.text)).toEqual(['DTE', 'Strike', 'IV'])
  })

  it('should render grid', () => {
    const proj = createProjection(100, 100)
    const lines = renderGrid(proj, 4)
    expect(lines.length).toBe(10)
    expect(lines[0]!.style).toBe('grid')
  })

  it('should render surface mesh', () => {
    const points = [
      [
        { x: -1, y: -1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ],
      [
        { x: 1, y: -1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
    ]
    const proj = createProjection(100, 100)
    const lines = renderSurfaceMesh(points, proj)
    expect(lines.length).toBe(4) // 2 horizontal + 2 vertical
  })

  it('should sort by depth', () => {
    const items = [{ depth: 1 }, { depth: -1 }, { depth: 0 }]
    const sorted = sortByDepth(items)
    expect(sorted[0]!.depth).toBe(-1)
    expect(sorted[2]!.depth).toBe(1)
  })

  it('should render complete cube frame', () => {
    const proj = createProjection(100, 100)
    const frame = renderCubeFrame(null, proj)
    expect(frame.lines.length).toBeGreaterThan(0)
    expect(frame.labels.length).toBe(3)
  })

  it('should convert surface data to points', () => {
    const x = new Float64Array([0, 1, 2])
    const y = new Float64Array([0, 10, 20])
    const z = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const points = surfaceToPoints(x, y, z, 3, 3)
    expect(points.length).toBe(3)
    expect(points[0]!.length).toBe(3)
    // Center point should be normalized to (0, 0, 0)
    expect(points[1]![1]!.x).toBeCloseTo(0)
    expect(points[1]![1]!.y).toBeCloseTo(0)
  })
})

describe('Rasterizer', () => {
  it('should create empty buffer', () => {
    const buf = createBuffer(10, 5)
    expect(buf.width).toBe(10)
    expect(buf.height).toBe(5)
    expect(buf.chars[0]![0]).toBe(' ')
  })

  it('should set character with depth testing', () => {
    const buf = createBuffer(10, 10)
    setChar(buf, 5, 5, 'A', 0)
    setChar(buf, 5, 5, 'B', 1) // Higher depth = closer, should replace
    expect(buf.chars[5]![5]).toBe('B')

    setChar(buf, 5, 5, 'C', -1) // Lower depth = further, should not replace
    expect(buf.chars[5]![5]).toBe('B')
  })

  it('should draw line', () => {
    const buf = createBuffer(10, 10)
    drawLine(buf, 0, 0, 9, 0, '-', 0)
    expect(buf.chars[0]![0]).not.toBe(' ')
    expect(buf.chars[0]![9]).not.toBe(' ')
  })

  it('should draw text', () => {
    const buf = createBuffer(20, 10)
    drawText(buf, 5, 5, 'Hello', 0)
    expect(buf.chars[5]![5]).toBe('H')
    expect(buf.chars[5]![9]).toBe('o')
  })

  it('should convert buffer to string', () => {
    const buf = createBuffer(5, 3)
    setChar(buf, 2, 1, 'X', 0)
    const str = bufferToString(buf)
    expect(str).toContain('X')
    expect(str.split('\n').length).toBe(3)
  })

  it('should rasterize cube frame', () => {
    const proj = createProjection(40, 20)
    const frame = renderCubeFrame(null, proj)
    const buf = rasterizeCubeFrame(frame, 40, 20)
    const str = bufferToString(buf)
    expect(str.length).toBeGreaterThan(0)
  })

  it('should create intensity character', () => {
    expect(intensityChar(0)).toBe(' ')
    expect(intensityChar(1)).toBe('█')
    expect(intensityChar(0.5).length).toBe(1)
  })
})

describe('Gradient and Color', () => {
  it('should lerp colors', () => {
    const c1 = { r: 0, g: 0, b: 0 }
    const c2 = { r: 255, g: 255, b: 255 }
    const mid = lerpColor(c1, c2, 0.5)
    expect(mid.r).toBe(128)
    expect(mid.g).toBe(128)
    expect(mid.b).toBe(128)
  })

  it('should sample gradient', () => {
    const colors = GRADIENT_PRESETS.heat
    const start = sampleGradient(colors, 0)
    const end = sampleGradient(colors, 1)
    expect(start.b).toBeGreaterThan(0) // Blue
    expect(end.r).toBeGreaterThan(0) // Red
  })

  it('should map slope to color', () => {
    const low = slopeToColor(0, 1, 'heat')
    const high = slopeToColor(1, 1, 'heat')
    expect(low.b).toBeGreaterThan(low.r) // Blue for low
    expect(high.r).toBeGreaterThan(high.b) // Red for high
  })

  it('should map direction to color', () => {
    const color0 = directionToColor(0)
    const colorPi = directionToColor(Math.PI)
    // Different angles should give different colors
    expect(color0.r !== colorPi.r || color0.g !== colorPi.g).toBe(true)
  })

  it('should compute risk metrics', () => {
    const slope = {
      dz_dx: new Float64Array([0.1, 0.2, 0.3, 0.4]),
      dz_dy: new Float64Array([0.1, 0.1, 0.1, 0.1]),
      magnitude: new Float64Array([0.14, 0.22, 0.32, 0.41]),
      angle: new Float64Array([0.78, 0.46, 0.32, 0.24]),
    }
    const metrics = computeRiskMetrics(slope, 2, 2)
    expect(metrics.maxSlope).toBeGreaterThan(0)
    expect(metrics.avgSlope).toBeGreaterThan(0)
    expect(metrics.riskScore).toBeGreaterThanOrEqual(0)
    expect(metrics.riskScore).toBeLessThanOrEqual(1)
  })

  it('should format risk score', () => {
    expect(formatRiskScore(0.1).text).toBe('LOW')
    expect(formatRiskScore(0.5).text).toBe('MEDIUM')
    expect(formatRiskScore(0.7).text).toBe('HIGH')
    expect(formatRiskScore(0.9).text).toBe('CRITICAL')
  })

  it('should generate slope color grid', () => {
    const slope = {
      dz_dx: new Float64Array([0.1, 0.2, 0.3, 0.4]),
      dz_dy: new Float64Array([0.1, 0.1, 0.1, 0.1]),
      magnitude: new Float64Array([0.14, 0.22, 0.32, 0.41]),
      angle: new Float64Array([0.78, 0.46, 0.32, 0.24]),
    }
    const grid = slopeToColorGrid(slope, 2, 2, 'heat')
    expect(grid.length).toBe(2)
    expect(grid[0]!.length).toBe(2)
    expect(grid[0]![0]).toHaveProperty('r')
    expect(grid[0]![0]).toHaveProperty('g')
    expect(grid[0]![0]).toHaveProperty('b')
  })
})
