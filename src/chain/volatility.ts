/**
 * Volatility Data Fetcher
 * Combines chain forking with Uniswap v4 pool data to build volatility surfaces
 */

import type { PublicClient } from 'viem'
import { createForkManager, type ForkState, formatBlockInfo } from './fork.ts'
import {
  getCommonPoolKeys,
  getPoolState,
  generateTickData,
  buildVolatilitySurface,
  toMarigraphSurface,
  tickToPrice,
  type PoolState,
  type VolatilityPoint,
} from './uniswap.ts'
import { VOLATILITY_EVENTS, BLOCK_RANGE, FEE_TIERS } from './config.ts'
import { createSurface, type Surface } from '../data/surface.ts'
import type { Vec64 } from '../data/vec.ts'

export interface VolatilitySnapshot {
  blockNumber: number
  timestamp: number
  date: string
  eventName?: string
  eventSeverity?: string
  ethPrice: number
  poolStates: Map<number, PoolState> // fee tier -> state
  surface: Surface<Vec64>
  riskScore: number
}

export interface VolatilityPlaylist {
  snapshots: VolatilitySnapshot[]
  currentIndex: number
  isPlaying: boolean
  playbackSpeed: number // ms between frames
}

/**
 * Seeded random number generator for reproducible surfaces
 */
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/**
 * Create a mock volatility snapshot for demo purposes
 * In production, this would fetch real data from the chain
 */
export function createMockSnapshot(
  blockNumber: number,
  timestamp: number,
  eventIndex: number = 0
): VolatilitySnapshot {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0]!

  // Seeded RNG for reproducible but varied surfaces
  const rng = seededRandom(blockNumber)

  // Find matching event
  const event = VOLATILITY_EVENTS.find(e =>
    Math.abs(e.block - blockNumber) < 25000
  )

  // Simulate ETH price based on block (rough approximation)
  const basePrice = 2500
  const priceVariation = Math.sin(blockNumber / 100000) * 500
  const eventShock = event?.severity === 'extreme' ? -300 :
    event?.severity === 'high' ? -150 : 0
  const ethPrice = basePrice + priceVariation + eventShock

  // Create pool states for each fee tier
  const poolStates = new Map<number, PoolState>()
  for (const fee of FEE_TIERS) {
    const tick = Math.floor(Math.log(ethPrice / 1) / Math.log(1.0001))

    // Vary liquidity based on event severity
    const liquidityBase = 1000000000000000n
    const liquidityMultiplier = event?.severity === 'extreme' ? 0.3 :
      event?.severity === 'high' ? 0.5 : 1.0

    poolStates.set(fee, {
      sqrtPriceX96: BigInt(Math.floor(Math.sqrt(ethPrice) * 2 ** 96)),
      tick,
      liquidity: BigInt(Math.floor(Number(liquidityBase) * liquidityMultiplier)),
      fee,
      price: ethPrice,
    })
  }

  // Generate a dramatically varied volatility surface
  // Parameters that change per snapshot for visible differences
  const baseVol = event?.severity === 'extreme' ? 0.8 + rng() * 0.4 :
    event?.severity === 'high' ? 0.5 + rng() * 0.3 :
    event?.severity === 'elevated' ? 0.35 + rng() * 0.2 :
    0.15 + rng() * 0.15

  // Skew direction and magnitude (put skew vs call skew)
  const skewDirection = event?.severity === 'extreme' ? -0.4 - rng() * 0.3 :
    event?.severity === 'high' ? -0.25 - rng() * 0.2 :
    (rng() - 0.5) * 0.3

  // Smile curvature (wings)
  const smileCurvature = event?.severity === 'extreme' ? 0.5 + rng() * 0.4 :
    event?.severity === 'high' ? 0.3 + rng() * 0.3 :
    0.1 + rng() * 0.2

  // Term structure slope (contango vs backwardation)
  const termSlope = event?.severity === 'extreme' ? -0.15 - rng() * 0.1 : // backwardation in crisis
    event?.severity === 'high' ? -0.08 - rng() * 0.08 :
    0.03 + rng() * 0.06 // normal contango

  // Generate custom surface with these parameters
  const nx = 25 // strikes
  const ny = 6  // expiries
  const expiryDays = [1, 7, 14, 30, 60, 90]
  const strikes = new Float64Array(nx)
  const expiries = new Float64Array(ny)
  const ivs = new Float64Array(nx * ny)

  // Strike range: 70% to 130% of spot
  for (let i = 0; i < nx; i++) {
    strikes[i] = 70 + (i / (nx - 1)) * 60 // 70 to 130
  }

  for (let j = 0; j < ny; j++) {
    expiries[j] = expiryDays[j]!
    const tte = expiryDays[j]! / 365

    for (let i = 0; i < nx; i++) {
      const moneyness = (strikes[i]! - 100) / 100 // -0.3 to +0.3

      // Base IV with term structure
      let iv = baseVol + termSlope * Math.sqrt(tte) * 2

      // Add skew (asymmetric)
      iv += skewDirection * moneyness

      // Add smile (symmetric curvature)
      iv += smileCurvature * moneyness * moneyness * 3

      // Add some per-point noise for texture
      iv += (rng() - 0.5) * 0.05

      // Time decay on wings
      const wingDecay = Math.abs(moneyness) > 0.15 ? (1 - tte * 0.3) : 1
      iv *= wingDecay

      // Clamp to reasonable range
      iv = Math.max(0.05, Math.min(2.0, iv))

      ivs[j * nx + i] = iv
    }
  }

  const surface = createSurface(
    strikes,
    expiries,
    ivs,
    {
      x: 'Strike %',
      y: 'Expiry (days)',
      z: 'IV',
    }
  )

  // Calculate risk score based on volatility levels and shape
  const avgVol = Array.from(ivs).reduce((a, b) => a + b, 0) / ivs.length
  const maxVol = Math.max(...Array.from(ivs))
  const riskScore = Math.min(1, (avgVol * 0.6 + maxVol * 0.4) / 1.2)

  return {
    blockNumber,
    timestamp,
    date,
    eventName: event?.name,
    eventSeverity: event?.severity,
    ethPrice,
    poolStates,
    surface,
    riskScore,
  }
}

/**
 * Create a playlist of volatility snapshots across historical blocks
 */
export function createPlaylist(
  startBlock: number = BLOCK_RANGE.start,
  endBlock: number = BLOCK_RANGE.end,
  step: number = BLOCK_RANGE.step
): VolatilityPlaylist {
  const snapshots: VolatilitySnapshot[] = []

  // Generate blocks including event blocks
  const blocks = new Set<number>()
  for (let block = startBlock; block <= endBlock; block += step) {
    blocks.add(block)
  }
  for (const event of VOLATILITY_EVENTS) {
    if (event.block >= startBlock && event.block <= endBlock) {
      blocks.add(event.block)
    }
  }

  const sortedBlocks = Array.from(blocks).sort((a, b) => a - b)

  // Create snapshots
  let eventIndex = 0
  const baseTimestamp = 1722816000 // Aug 5, 2024 00:00:00 UTC
  const secondsPerBlock = 12

  for (const block of sortedBlocks) {
    const timestamp = baseTimestamp + (block - startBlock) * secondsPerBlock
    const snapshot = createMockSnapshot(block, timestamp, eventIndex++)
    snapshots.push(snapshot)
  }

  return {
    snapshots,
    currentIndex: 0,
    isPlaying: false,
    playbackSpeed: 500, // 500ms between frames
  }
}

/**
 * Get snapshot at specific index
 */
export function getSnapshot(playlist: VolatilityPlaylist, index: number): VolatilitySnapshot | null {
  if (index < 0 || index >= playlist.snapshots.length) {
    return null
  }
  return playlist.snapshots[index]!
}

/**
 * Advance playlist to next snapshot
 */
export function nextSnapshot(playlist: VolatilityPlaylist): VolatilitySnapshot | null {
  if (playlist.currentIndex < playlist.snapshots.length - 1) {
    playlist.currentIndex++
  }
  return getSnapshot(playlist, playlist.currentIndex)
}

/**
 * Go to previous snapshot
 */
export function prevSnapshot(playlist: VolatilityPlaylist): VolatilitySnapshot | null {
  if (playlist.currentIndex > 0) {
    playlist.currentIndex--
  }
  return getSnapshot(playlist, playlist.currentIndex)
}

/**
 * Jump to specific block in playlist
 */
export function jumpToBlock(playlist: VolatilityPlaylist, targetBlock: number): VolatilitySnapshot | null {
  // Find closest snapshot
  let closestIndex = 0
  let closestDiff = Infinity

  for (let i = 0; i < playlist.snapshots.length; i++) {
    const diff = Math.abs(playlist.snapshots[i]!.blockNumber - targetBlock)
    if (diff < closestDiff) {
      closestDiff = diff
      closestIndex = i
    }
  }

  playlist.currentIndex = closestIndex
  return getSnapshot(playlist, closestIndex)
}

/**
 * Jump to specific event
 */
export function jumpToEvent(playlist: VolatilityPlaylist, eventName: string): VolatilitySnapshot | null {
  const index = playlist.snapshots.findIndex(s =>
    s.eventName?.toLowerCase().includes(eventName.toLowerCase())
  )
  if (index >= 0) {
    playlist.currentIndex = index
    return playlist.snapshots[index]!
  }
  return null
}

/**
 * Format snapshot info for display
 */
export function formatSnapshotInfo(snapshot: VolatilitySnapshot): string {
  const eventStr = snapshot.eventName ? ` [${snapshot.eventName}]` : ''
  const severityStr = snapshot.eventSeverity ? ` (${snapshot.eventSeverity})` : ''
  return `Block ${snapshot.blockNumber.toLocaleString()} | ${snapshot.date} | ETH: $${snapshot.ethPrice.toFixed(0)}${eventStr}${severityStr}`
}

/**
 * Get progress percentage through playlist
 */
export function getPlaylistProgress(playlist: VolatilityPlaylist): number {
  if (playlist.snapshots.length <= 1) return 100
  return (playlist.currentIndex / (playlist.snapshots.length - 1)) * 100
}

/**
 * Export playlist data for external use
 */
export function exportPlaylistData(playlist: VolatilityPlaylist): object {
  return {
    totalSnapshots: playlist.snapshots.length,
    currentIndex: playlist.currentIndex,
    startBlock: playlist.snapshots[0]?.blockNumber,
    endBlock: playlist.snapshots[playlist.snapshots.length - 1]?.blockNumber,
    events: VOLATILITY_EVENTS.map(e => ({
      name: e.name,
      date: e.date,
      block: e.block,
      severity: e.severity,
    })),
    snapshots: playlist.snapshots.map(s => ({
      block: s.blockNumber,
      date: s.date,
      ethPrice: s.ethPrice,
      riskScore: s.riskScore,
      eventName: s.eventName,
    })),
  }
}
