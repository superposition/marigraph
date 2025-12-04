/**
 * Uniswap v4 Contract Interactions
 * Fetch pool state and volatility data
 */

import { type PublicClient, parseAbi, getAddress } from 'viem'
import { UNISWAP_V4, TOKENS, FEE_TIERS, TICK_SPACING } from './config.ts'

// Uniswap v4 Pool Manager ABI (minimal for reading state)
const POOL_MANAGER_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128)',
  'function getPosition(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
  'function extsload(bytes32 slot) external view returns (bytes32)',
  'function extsload(bytes32[] calldata slots) external view returns (bytes32[] memory)',
])

// Pool key structure for Uniswap v4
export interface PoolKey {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

// Pool state
export interface PoolState {
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  fee: number
  price: number
}

// Tick data for volatility surface
export interface TickData {
  tick: number
  liquidityNet: bigint
  liquidityGross: bigint
  price: number
}

// Volatility surface point
export interface VolatilityPoint {
  strike: number      // Price level (from tick)
  expiry: number      // Time bucket (in days)
  impliedVol: number  // Implied volatility
  liquidity: number   // Liquidity at this point
}

/**
 * Compute pool ID from pool key
 * PoolId is keccak256(abi.encode(poolKey))
 */
export function computePoolId(poolKey: PoolKey): `0x${string}` {
  // For simplicity, we use a deterministic ID based on token pair and fee
  // In production, this should be the actual keccak256 hash
  const { currency0, currency1, fee } = poolKey
  const combined = `${currency0}${currency1}${fee}`
  // Simple hash for demo - in production use keccak256
  let hash = 0n
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31n + BigInt(combined.charCodeAt(i))) % (2n ** 256n)
  }
  return `0x${hash.toString(16).padStart(64, '0')}` as `0x${string}`
}

/**
 * Convert tick to price
 * price = 1.0001^tick
 */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick)
}

/**
 * Convert price to tick
 * tick = log(price) / log(1.0001)
 */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001))
}

/**
 * Convert sqrtPriceX96 to price
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number = 18, decimals1: number = 6): number {
  const price = Number(sqrtPriceX96 * sqrtPriceX96) / (2 ** 192)
  return price * Math.pow(10, decimals0 - decimals1)
}

/**
 * Create common pool keys for ETH pairs
 */
export function getCommonPoolKeys(): PoolKey[] {
  const keys: PoolKey[] = []

  // ETH/USDC pools at different fee tiers
  for (const fee of FEE_TIERS) {
    keys.push({
      currency0: TOKENS.USDC, // USDC is currency0 (lower address)
      currency1: TOKENS.WETH, // WETH is currency1
      fee,
      tickSpacing: TICK_SPACING[fee]!,
      hooks: '0x0000000000000000000000000000000000000000',
    })
  }

  return keys
}

/**
 * Fetch pool state from Pool Manager
 */
export async function getPoolState(
  client: PublicClient,
  poolKey: PoolKey
): Promise<PoolState | null> {
  try {
    const poolId = computePoolId(poolKey)

    // Try to read slot0 data
    const result = await client.readContract({
      address: UNISWAP_V4.POOL_MANAGER,
      abi: POOL_MANAGER_ABI,
      functionName: 'getSlot0',
      args: [poolId],
    }) as [bigint, number, number, number]

    const [sqrtPriceX96, tick, , lpFee] = result

    // Get liquidity
    const liquidity = await client.readContract({
      address: UNISWAP_V4.POOL_MANAGER,
      abi: POOL_MANAGER_ABI,
      functionName: 'getLiquidity',
      args: [poolId],
    }) as bigint

    const price = sqrtPriceX96ToPrice(sqrtPriceX96)

    return {
      sqrtPriceX96,
      tick,
      liquidity,
      fee: lpFee,
      price,
    }
  } catch (error) {
    // Pool may not exist at this block
    console.error('Failed to fetch pool state:', error)
    return null
  }
}

/**
 * Generate simulated tick data for volatility surface
 * In production, this would read actual tick bitmap and liquidity
 */
export function generateTickData(
  currentTick: number,
  tickSpacing: number,
  basePrice: number,
  baseLiquidity: bigint
): TickData[] {
  const ticks: TickData[] = []
  const range = 50 // Number of ticks on each side

  for (let i = -range; i <= range; i++) {
    const tick = Math.round(currentTick / tickSpacing) * tickSpacing + i * tickSpacing
    const price = tickToPrice(tick)

    // Simulate liquidity distribution (concentrated around current price)
    const distance = Math.abs(i)
    const liquidityMultiplier = Math.exp(-distance * 0.1)
    const liquidity = BigInt(Math.floor(Number(baseLiquidity) * liquidityMultiplier))

    ticks.push({
      tick,
      liquidityNet: liquidity,
      liquidityGross: liquidity,
      price,
    })
  }

  return ticks
}

/**
 * Calculate implied volatility from liquidity distribution
 * Higher liquidity concentration = lower volatility expectation
 * Sparse liquidity = higher volatility expectation
 */
export function calculateImpliedVolatility(
  tickData: TickData[],
  currentTick: number,
  timeToExpiry: number // in days
): VolatilityPoint[] {
  const points: VolatilityPoint[] = []
  const currentPrice = tickToPrice(currentTick)

  for (const tick of tickData) {
    const strike = tick.price
    const moneyness = Math.log(strike / currentPrice)

    // Base volatility estimation from liquidity
    // Less liquidity = higher expected volatility
    const liquidityFactor = Number(tick.liquidityGross) > 0
      ? Math.log(Number(tick.liquidityGross) + 1) / 50
      : 1

    // Volatility smile - higher vol for OTM options
    const smileEffect = 0.1 + 0.2 * Math.abs(moneyness)

    // Time decay effect
    const timeEffect = Math.sqrt(timeToExpiry / 365)

    // Combined implied volatility
    const impliedVol = Math.max(0.1, Math.min(2.0,
      (0.5 - liquidityFactor * 0.3 + smileEffect) * timeEffect + 0.2
    ))

    points.push({
      strike,
      expiry: timeToExpiry,
      impliedVol,
      liquidity: Number(tick.liquidityGross),
    })
  }

  return points
}

/**
 * Build full volatility surface from pool data
 */
export function buildVolatilitySurface(
  tickData: TickData[],
  currentTick: number,
  expiryDays: number[] = [1, 7, 14, 30, 60, 90]
): VolatilityPoint[][] {
  const surface: VolatilityPoint[][] = []

  for (const expiry of expiryDays) {
    const points = calculateImpliedVolatility(tickData, currentTick, expiry)
    surface.push(points)
  }

  return surface
}

/**
 * Convert volatility surface to marigraph Surface format
 */
export function toMarigraphSurface(
  volSurface: VolatilityPoint[][],
  currentPrice: number
): {
  x: Float64Array  // Strike prices (as % of current)
  y: Float64Array  // Expiry days
  z: Float64Array  // Implied volatility
  nx: number
  ny: number
} {
  const ny = volSurface.length
  const nx = volSurface[0]?.length || 0

  const x = new Float64Array(nx)
  const y = new Float64Array(ny)
  const z = new Float64Array(nx * ny)

  // Fill strike prices (as percentage of spot)
  if (volSurface[0]) {
    for (let i = 0; i < nx; i++) {
      x[i] = (volSurface[0][i]!.strike / currentPrice) * 100 // As percentage
    }
  }

  // Fill expiry days and volatility grid
  for (let j = 0; j < ny; j++) {
    y[j] = volSurface[j]![0]?.expiry || 0

    for (let i = 0; i < nx; i++) {
      z[j * nx + i] = volSurface[j]![i]?.impliedVol || 0
    }
  }

  return { x, y, z, nx, ny }
}
