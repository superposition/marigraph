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
 * Create a mock volatility snapshot for demo purposes
 * In production, this would fetch real data from the chain
 */
export function createMockSnapshot(
  blockNumber: number,
  timestamp: number,
  eventIndex: number = 0
): VolatilitySnapshot {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0]!

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

  // Generate volatility surface
  const primaryPool = poolStates.get(3000)! // 0.3% fee tier
  const tickData = generateTickData(
    primaryPool.tick,
    60, // tick spacing for 0.3%
    ethPrice,
    primaryPool.liquidity
  )

  // Adjust volatility based on event
  const volMultiplier = event?.severity === 'extreme' ? 2.0 :
    event?.severity === 'high' ? 1.5 :
      event?.severity === 'elevated' ? 1.2 : 1.0

  const expiryDays = [1, 7, 14, 30, 60, 90]
  const volSurface = buildVolatilitySurface(tickData, primaryPool.tick, expiryDays)

  // Apply event-based volatility multiplier
  for (const row of volSurface) {
    for (const point of row) {
      point.impliedVol *= volMultiplier
    }
  }

  // Convert to marigraph surface format
  const surfaceData = toMarigraphSurface(volSurface, ethPrice)

  const surface = createSurface(
    surfaceData.x,
    surfaceData.y,
    surfaceData.z,
    surfaceData.nx,
    surfaceData.ny,
    {
      xLabel: 'Strike %',
      yLabel: 'Expiry (days)',
      zLabel: 'IV',
      title: `ETH Volatility Surface - ${date}`,
    }
  )

  // Calculate risk score based on volatility levels
  const avgVol = surfaceData.z.reduce((a, b) => a + b, 0) / surfaceData.z.length
  const riskScore = Math.min(1, avgVol / 1.5)

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
