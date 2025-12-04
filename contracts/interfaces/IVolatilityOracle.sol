// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IVolatilityOracle
 * @notice Interface for the Marigraph Volatility Oracle
 * @dev Provides real-time volatility metrics derived from Uniswap v4 pools
 */
interface IVolatilityOracle {
    /// @notice Volatility snapshot at a point in time
    struct VolatilitySnapshot {
        uint256 timestamp;
        uint256 blockNumber;
        uint128 realizedVol;      // 18 decimals, annualized (e.g., 0.5e18 = 50%)
        uint128 impliedVol;       // 18 decimals, annualized
        int128 volRiskPremium;    // IV - RV, can be negative
        int128 skew25Delta;       // Put wing - Call wing at 25 delta
        int128 termStructure;     // Long-dated IV - Short-dated IV
        uint128 atmIV;            // At-the-money implied volatility
        uint128 riskScore;        // 0-1e18 normalized risk score
    }

    /// @notice Term structure point (IV at specific expiry)
    struct TermPoint {
        uint32 daysToExpiry;
        uint128 impliedVol;
    }

    /// @notice Volatility smile at a specific expiry
    struct VolSmile {
        uint32 daysToExpiry;
        uint128 atmIV;
        uint128 put25IV;          // 25-delta put IV
        uint128 put10IV;          // 10-delta put IV
        uint128 call25IV;         // 25-delta call IV
        uint128 call10IV;         // 10-delta call IV
    }

    /// @notice Liquidity depth at price levels
    struct LiquidityDepth {
        uint128 bidDepth1Pct;     // Liquidity within 1% below spot
        uint128 askDepth1Pct;     // Liquidity within 1% above spot
        uint128 bidDepth5Pct;     // Liquidity within 5% below spot
        uint128 askDepth5Pct;     // Liquidity within 5% above spot
    }

    // ============ View Functions ============

    /// @notice Get the latest volatility snapshot
    function getLatestSnapshot() external view returns (VolatilitySnapshot memory);

    /// @notice Get snapshot at a specific index
    function getSnapshot(uint256 index) external view returns (VolatilitySnapshot memory);

    /// @notice Get the current realized volatility (annualized)
    /// @param window Time window in seconds (e.g., 86400 for 24h)
    function getRealizedVolatility(uint32 window) external view returns (uint128);

    /// @notice Get the current implied volatility from pool state
    function getImpliedVolatility() external view returns (uint128);

    /// @notice Get the volatility risk premium (IV - RV)
    function getVolRiskPremium() external view returns (int128);

    /// @notice Get the 25-delta skew (put - call)
    function getSkew25Delta() external view returns (int128);

    /// @notice Get the term structure slope
    function getTermStructure() external view returns (int128);

    /// @notice Get the current risk score (0-1e18)
    function getRiskScore() external view returns (uint128);

    /// @notice Get full volatility smile for an expiry
    function getVolSmile(uint32 daysToExpiry) external view returns (VolSmile memory);

    /// @notice Get current liquidity depth
    function getLiquidityDepth() external view returns (LiquidityDepth memory);

    /// @notice Get historical snapshots
    function getSnapshots(uint256 start, uint256 count)
        external view returns (VolatilitySnapshot[] memory);

    /// @notice Get the number of stored snapshots
    function snapshotCount() external view returns (uint256);

    // ============ Update Function ============

    /// @notice Update the oracle with new price and liquidity data
    /// @param currentPrice Current spot price (18 decimals)
    /// @param tickLiquidity Array of liquidity at tick ranges
    /// @param tickRanges Corresponding tick range boundaries
    function update(
        uint256 currentPrice,
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges
    ) external;

    // ============ Events ============

    event SnapshotUpdated(
        uint256 indexed snapshotIndex,
        uint128 realizedVol,
        uint128 impliedVol,
        int128 skew25Delta,
        uint128 riskScore
    );

    event RiskAlert(
        uint256 indexed snapshotIndex,
        uint128 riskScore,
        string reason
    );
}
