/**
 * ASCII/Braille Rasterizer
 * Converts 2D projected lines to character-based output
 */

import type { RenderLine, RenderLabel, CubeFrame } from './cube.ts'

// Character sets for different intensities
export const ASCII_DENSITY = ' ·∙●○◯◌◍◎●'
export const ASCII_SLOPE = ' ░▒▓█'
export const DEPTH_CHARS = '·:;+*#@'
export const SURFACE_CHARS = '∙░▒▓█▓▒░'
export const SYNTHWAVE_CHARS = '·˙:∴∷⁘⁙∺'
export const BRAILLE_CHARS = [
  '⠀', '⠁', '⠂', '⠃', '⠄', '⠅', '⠆', '⠇',
  '⠈', '⠉', '⠊', '⠋', '⠌', '⠍', '⠎', '⠏',
  '⠐', '⠑', '⠒', '⠓', '⠔', '⠕', '⠖', '⠗',
  '⠘', '⠙', '⠚', '⠛', '⠜', '⠝', '⠞', '⠟',
  '⠠', '⠡', '⠢', '⠣', '⠤', '⠥', '⠦', '⠧',
  '⠨', '⠩', '⠪', '⠫', '⠬', '⠭', '⠮', '⠯',
  '⠰', '⠱', '⠲', '⠳', '⠴', '⠵', '⠶', '⠷',
  '⠸', '⠹', '⠺', '⠻', '⠼', '⠽', '⠾', '⠿',
]

// Line drawing characters
export const LINE_CHARS = {
  horizontal: '─',
  vertical: '│',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  cross: '┼',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  diagUp: '╱',
  diagDown: '╲',
  diagCross: '╳',
  dot: '·',
}

// Style-based character mapping
export const STYLE_CHARS: Record<string, string> = {
  wireframe: '─',
  axis: '━',
  grid: '·',
  surface: '░',
}

export interface RasterBuffer {
  chars: string[][]
  depths: number[][]
  colors: string[][]
  width: number
  height: number
}

/**
 * Create an empty raster buffer
 */
export function createBuffer(width: number, height: number): RasterBuffer {
  const chars: string[][] = []
  const depths: number[][] = []
  const colors: string[][] = []

  for (let y = 0; y < height; y++) {
    chars.push(Array(width).fill(' '))
    depths.push(Array(width).fill(-Infinity))
    colors.push(Array(width).fill(''))
  }

  return { chars, depths, colors, width, height }
}

/**
 * Set a character in the buffer with depth testing
 */
export function setChar(
  buf: RasterBuffer,
  x: number,
  y: number,
  char: string,
  depth: number,
  color = ''
): void {
  const ix = Math.round(x)
  const iy = Math.round(y)

  if (ix < 0 || ix >= buf.width || iy < 0 || iy >= buf.height) {
    return
  }

  // Depth test - only draw if closer (larger depth value = closer)
  if (depth >= buf.depths[iy]![ix]!) {
    buf.chars[iy]![ix] = char
    buf.depths[iy]![ix] = depth
    buf.colors[iy]![ix] = color
  }
}

/**
 * Draw a line using Bresenham's algorithm
 */
export function drawLine(
  buf: RasterBuffer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  char: string,
  depth: number,
  color = ''
): void {
  let x = Math.round(x1)
  let y = Math.round(y1)
  const endX = Math.round(x2)
  const endY = Math.round(y2)

  const dx = Math.abs(endX - x)
  const dy = Math.abs(endY - y)
  const sx = x < endX ? 1 : -1
  const sy = y < endY ? 1 : -1
  let err = dx - dy

  // Choose character based on line angle
  let lineChar = char
  if (char === '─' || char === '━') {
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const deg = (angle * 180) / Math.PI
    if (Math.abs(deg) < 30 || Math.abs(deg) > 150) {
      lineChar = char // horizontal
    } else if (Math.abs(deg - 90) < 30 || Math.abs(deg + 90) < 30) {
      lineChar = char === '━' ? '┃' : '│' // vertical
    } else if (deg > 0) {
      lineChar = '╲' // diagonal down
    } else {
      lineChar = '╱' // diagonal up
    }
  }

  // Max iterations to prevent infinite loop
  const maxIter = dx + dy + 2

  for (let i = 0; i <= maxIter; i++) {
    setChar(buf, x, y, lineChar, depth, color)

    if (x === endX && y === endY) break

    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/**
 * Draw text at position
 */
export function drawText(
  buf: RasterBuffer,
  x: number,
  y: number,
  text: string,
  depth: number,
  color = ''
): void {
  const ix = Math.round(x)
  const iy = Math.round(y)

  for (let i = 0; i < text.length; i++) {
    setChar(buf, ix + i, iy, text[i]!, depth + 1, color) // Labels always on top
  }
}

/**
 * Get line character for a specific style
 */
export function getLineChar(style: string): string {
  switch (style) {
    case 'wireframe':
      return '─'
    case 'axis':
      return '━'
    case 'grid':
      return '·'
    case 'surface':
      return '░'
    default:
      return '─'
  }
}

/**
 * Get color for a specific style
 */
export function getStyleColor(style: string): string {
  switch (style) {
    case 'wireframe':
      return 'blue'
    case 'axis':
      return 'magenta'
    case 'grid':
      return 'blue'
    case 'surface':
      return 'cyan'
    default:
      return ''
  }
}

/**
 * Get synthwave color based on depth (closer = brighter/warmer)
 */
export function getDepthColor(depth: number, minDepth: number, maxDepth: number): string {
  const range = maxDepth - minDepth || 1
  const normalized = (depth - minDepth) / range // 0 = far, 1 = close

  // Synthwave gradient: blue (far) -> cyan -> magenta -> yellow (close)
  if (normalized < 0.25) return 'blue'
  if (normalized < 0.5) return 'cyan'
  if (normalized < 0.75) return 'magenta'
  return 'yellow'
}

/**
 * Get color based on z-value (height) for surface heat map
 * zValue is normalized to [-1, 1] range
 */
export function getHeightColor(zValue: number): string {
  // Rich gradient with white only at extreme peaks
  const normalized = (zValue + 1) / 2 // convert to 0-1 range
  if (normalized < 0.08) return 'gray'
  if (normalized < 0.20) return 'blue'
  if (normalized < 0.35) return 'cyan'
  if (normalized < 0.50) return 'green'
  if (normalized < 0.65) return 'yellow'
  if (normalized < 0.80) return 'magenta'
  if (normalized < 0.95) return 'red'
  return 'white' // only top 5%
}

/**
 * Get character based on z-value (height) for varied surface texture
 */
export function getHeightChar(zValue: number): string {
  // Different characters for different heights - more granular
  const normalized = (zValue + 1) / 2 // convert to 0-1 range
  if (normalized < 0.08) return '·'
  if (normalized < 0.20) return '∙'
  if (normalized < 0.35) return ':'
  if (normalized < 0.50) return '░'
  if (normalized < 0.65) return '▒'
  if (normalized < 0.80) return '▓'
  if (normalized < 0.95) return '█'
  return '▀' // only top 5%
}

/**
 * Get character based on depth for shading effect
 */
export function getDepthChar(depth: number, minDepth: number, maxDepth: number, style: string): string {
  const range = maxDepth - minDepth || 1
  const normalized = (depth - minDepth) / range // 0 = far, 1 = close

  if (style === 'surface') {
    // Brighter chars for closer surface lines
    if (normalized < 0.2) return '·'
    if (normalized < 0.4) return '░'
    if (normalized < 0.6) return '▒'
    if (normalized < 0.8) return '▓'
    return '█'
  }

  if (style === 'wireframe') {
    // Different line styles based on depth
    if (normalized < 0.3) return '·'
    if (normalized < 0.6) return '─'
    return '━'
  }

  if (style === 'grid') {
    if (normalized < 0.5) return '·'
    return '+'
  }

  return '─'
}

/**
 * Rasterize a complete cube frame to a character buffer
 */
export function rasterizeCubeFrame(
  frame: CubeFrame,
  width: number,
  height: number,
  options: { colorBySurface?: boolean } = {}
): RasterBuffer {
  const { colorBySurface = true } = options
  const buf = createBuffer(width, height)

  // Scale factor to fit frame into buffer
  const scaleX = (width - 4) / frame.width
  const scaleY = (height - 2) / frame.height
  const scale = Math.min(scaleX, scaleY)
  const offsetX = (width - frame.width * scale) / 2
  const offsetY = (height - frame.height * scale) / 2

  // Draw lines (already sorted by depth)
  for (const line of frame.lines) {
    const x1 = line.x1 * scale + offsetX
    const y1 = line.y1 * scale + offsetY
    const x2 = line.x2 * scale + offsetX
    const y2 = line.y2 * scale + offsetY

    let char: string
    let color: string

    if (line.style === 'surface' && colorBySurface && line.zValue !== undefined) {
      // Use height-based coloring for surface lines
      char = getHeightChar(line.zValue)
      color = getHeightColor(line.zValue)
    } else {
      char = getLineChar(line.style)
      color = getStyleColor(line.style)
    }

    drawLine(buf, x1, y1, x2, y2, char, line.depth, color)
  }

  // Draw labels
  for (const label of frame.labels) {
    const x = label.x * scale + offsetX
    const y = label.y * scale + offsetY
    drawText(buf, x, y, label.text, label.depth, 'white')
  }

  return buf
}

/**
 * Convert buffer to string output
 */
export function bufferToString(buf: RasterBuffer): string {
  return buf.chars.map((row) => row.join('')).join('\n')
}

/**
 * Convert buffer to string with ANSI colors
 */
export function bufferToAnsi(buf: RasterBuffer): string {
  const ANSI_COLORS: Record<string, string> = {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
  }

  const lines: string[] = []

  for (let y = 0; y < buf.height; y++) {
    let line = ''
    let lastColor = ''

    for (let x = 0; x < buf.width; x++) {
      const color = buf.colors[y]![x]!
      const char = buf.chars[y]![x]!

      if (color !== lastColor) {
        if (lastColor) line += ANSI_COLORS.reset
        if (color && ANSI_COLORS[color]) {
          line += ANSI_COLORS[color]
        }
        lastColor = color
      }

      line += char
    }

    if (lastColor) line += ANSI_COLORS.reset
    lines.push(line)
  }

  return lines.join('\n')
}

/**
 * Create intensity character from value 0-1
 */
export function intensityChar(value: number, charset = ASCII_SLOPE): string {
  const clamped = Math.max(0, Math.min(1, value))
  const idx = Math.floor(clamped * (charset.length - 1))
  return charset[idx]!
}

/**
 * Fill a cell with intensity-based character
 */
export function fillCell(
  buf: RasterBuffer,
  x: number,
  y: number,
  intensity: number,
  depth: number,
  color = ''
): void {
  const char = intensityChar(intensity)
  setChar(buf, x, y, char, depth, color)
}
