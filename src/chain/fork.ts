/**
 * Anvil Fork Manager
 * Manages forked Ethereum state at specific blocks
 */

import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { RPC_ENDPOINTS, ANVIL_CONFIG, VOLATILITY_EVENTS, type VolatilityEvent } from './config.ts'

export interface ForkState {
  blockNumber: number
  timestamp: number
  client: PublicClient
  event?: VolatilityEvent
}

export interface ForkManager {
  currentBlock: number
  client: PublicClient
  switchToBlock: (block: number) => Promise<ForkState>
  switchToEvent: (eventName: string) => Promise<ForkState>
  getBlockTimestamp: (block: number) => Promise<number>
  getCurrentState: () => ForkState
}

/**
 * Create a client connected to the RPC endpoint
 * Can be used with live mainnet or local Anvil fork
 */
export function createClient(rpcUrl?: string): PublicClient {
  const url = rpcUrl || RPC_ENDPOINTS.mainnet
  return createPublicClient({
    chain: mainnet,
    transport: http(url),
  })
}

/**
 * Create a fork manager for navigating historical blocks
 */
export async function createForkManager(rpcUrl?: string): Promise<ForkManager> {
  const client = createClient(rpcUrl)

  // Get current block
  const latestBlock = await client.getBlockNumber()
  let currentBlock = Number(latestBlock)
  let currentTimestamp = Math.floor(Date.now() / 1000)
  let currentEvent: VolatilityEvent | undefined

  const getBlockTimestamp = async (block: number): Promise<number> => {
    try {
      const blockData = await client.getBlock({ blockNumber: BigInt(block) })
      return Number(blockData.timestamp)
    } catch {
      // Estimate timestamp if block not accessible
      const secondsPerBlock = 12
      const blockDiff = Number(latestBlock) - block
      return Math.floor(Date.now() / 1000) - (blockDiff * secondsPerBlock)
    }
  }

  const switchToBlock = async (block: number): Promise<ForkState> => {
    currentBlock = block
    currentTimestamp = await getBlockTimestamp(block)

    // Find matching event if any
    currentEvent = VOLATILITY_EVENTS.find(e =>
      Math.abs(e.block - block) < 25000 // Within ~3 days
    )

    return {
      blockNumber: currentBlock,
      timestamp: currentTimestamp,
      client,
      event: currentEvent,
    }
  }

  const switchToEvent = async (eventName: string): Promise<ForkState> => {
    const event = VOLATILITY_EVENTS.find(e =>
      e.name.toLowerCase().includes(eventName.toLowerCase())
    )
    if (!event) {
      throw new Error(`Event not found: ${eventName}`)
    }
    return switchToBlock(event.block)
  }

  const getCurrentState = (): ForkState => ({
    blockNumber: currentBlock,
    timestamp: currentTimestamp,
    client,
    event: currentEvent,
  })

  return {
    currentBlock,
    client,
    switchToBlock,
    switchToEvent,
    getBlockTimestamp,
    getCurrentState,
  }
}

/**
 * Generate Anvil fork command for a specific block
 */
export function getAnvilCommand(blockNumber: number, rpcUrl?: string): string {
  const url = rpcUrl || RPC_ENDPOINTS.mainnet
  return `anvil --fork-url ${url} --fork-block-number ${blockNumber} --port ${ANVIL_CONFIG.port} --chain-id ${ANVIL_CONFIG.chainId}`
}

/**
 * Spawn Anvil fork process (requires anvil to be installed)
 */
export async function spawnAnvilFork(
  blockNumber: number,
  rpcUrl?: string
): Promise<{ proc: ReturnType<typeof Bun.spawn>; client: PublicClient }> {
  const url = rpcUrl || RPC_ENDPOINTS.mainnet

  const proc = Bun.spawn([
    'anvil',
    '--fork-url', url,
    '--fork-block-number', blockNumber.toString(),
    '--port', ANVIL_CONFIG.port.toString(),
    '--chain-id', ANVIL_CONFIG.chainId.toString(),
    '--silent',
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for Anvil to start
  await Bun.sleep(2000)

  const client = createClient(RPC_ENDPOINTS.local)

  return { proc, client }
}

/**
 * Get block number from timestamp (approximate)
 */
export function estimateBlockFromTimestamp(
  targetTimestamp: number,
  currentBlock: number,
  currentTimestamp: number
): number {
  const secondsPerBlock = 12
  const timeDiff = currentTimestamp - targetTimestamp
  const blockDiff = Math.floor(timeDiff / secondsPerBlock)
  return Math.max(0, currentBlock - blockDiff)
}

/**
 * Format block info for display
 */
export function formatBlockInfo(state: ForkState): string {
  const date = new Date(state.timestamp * 1000)
  const dateStr = date.toISOString().split('T')[0]
  const eventStr = state.event ? ` (${state.event.name})` : ''
  return `Block ${state.blockNumber.toLocaleString()} - ${dateStr}${eventStr}`
}

/**
 * Get list of blocks for the playlist
 */
export function getPlaylistBlocks(
  startBlock: number,
  endBlock: number,
  step: number
): number[] {
  const blocks: number[] = []
  for (let block = startBlock; block <= endBlock; block += step) {
    blocks.push(block)
  }
  // Always include event blocks
  for (const event of VOLATILITY_EVENTS) {
    if (event.block >= startBlock && event.block <= endBlock) {
      if (!blocks.includes(event.block)) {
        blocks.push(event.block)
      }
    }
  }
  return blocks.sort((a, b) => a - b)
}
