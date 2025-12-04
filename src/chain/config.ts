/**
 * Chain Configuration
 * Uniswap v4 addresses and high-volatility historical blocks
 */

// Uniswap v4 Contract Addresses (Ethereum Mainnet)
export const UNISWAP_V4 = {
  POOL_MANAGER: '0x000000000004444c5dc75cb358380d2e3de08a90' as const,
  UNIVERSAL_ROUTER: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as const,
  POSITION_MANAGER: '0x000000000000BBAcD3bf38B52ccbde02Ef4cf987' as const,
}

// Common token addresses
export const TOKENS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const,
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const,
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const,
  DAI: '0x6B175474E89094C44Da98b954EesadFe3C360D27' as const,
}

// High-volatility periods in 2024 with approximate block numbers
// These are key dates when ETH experienced significant volatility
export const VOLATILITY_EVENTS = [
  {
    name: 'Yen Carry Trade Unwinding',
    date: '2024-08-05',
    block: 20450000,
    description: 'Massive unwinding of yen carry trades caused ETH to drop sharply',
    severity: 'extreme' as const,
  },
  {
    name: 'ETH Recovery Rally',
    date: '2024-08-13',
    block: 20520000,
    description: 'Sharp recovery creating long lower wick pattern',
    severity: 'high' as const,
  },
  {
    name: 'US Election Day',
    date: '2024-11-05',
    block: 21110000,
    description: 'US presidential election caused market uncertainty',
    severity: 'elevated' as const,
  },
  {
    name: 'BTC ATH Pullback',
    date: '2024-12-18',
    block: 21430000,
    description: 'Bitcoin reached ATH then pulled back sharply',
    severity: 'high' as const,
  },
  {
    name: 'Uniswap v4 Launch',
    date: '2025-01-30',
    block: 21750000,
    description: 'Uniswap v4 mainnet deployment',
    severity: 'normal' as const,
  },
] as const

export type VolatilityEvent = typeof VOLATILITY_EVENTS[number]

// Block range for playlist (covers major 2024 events)
export const BLOCK_RANGE = {
  start: 20450000, // Aug 2024
  end: 21750000,   // Jan 2025
  step: 50000,     // ~1 week of blocks
}

// Default RPC endpoints (user should set ETHEREUM_RPC env var)
export const RPC_ENDPOINTS = {
  mainnet: process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
  local: 'http://127.0.0.1:8545',
}

// Anvil fork configuration
export const ANVIL_CONFIG = {
  port: 8545,
  chainId: 1,
  blockTime: 0, // instant mining
}

// Pool fee tiers (in hundredths of a bip, so 3000 = 0.3%)
export const FEE_TIERS = [100, 500, 3000, 10000] as const

// Tick spacing for different fee tiers
export const TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
}
