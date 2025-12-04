// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/IVolatilityOracle.sol";
import "./libraries/VolatilityMath.sol";

/**
 * @title VolatilityOracle
 * @notice On-chain volatility oracle for Uniswap v4 pools
 * @dev Computes realized volatility from price history and derives implied vol from liquidity
 *
 * Key Metrics:
 * - Realized Volatility (RV): Historical price volatility over configurable windows
 * - Implied Volatility (IV): Derived from concentrated liquidity distribution
 * - Vol Risk Premium: IV - RV spread indicating market fear
 * - 25Δ Skew: Put/call wing imbalance for crash protection pricing
 * - Term Structure: Short vs long-dated vol for event risk
 */
contract VolatilityOracle is IVolatilityOracle {
    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365.25 days;
    uint256 public constant MAX_SNAPSHOTS = 8640; // ~30 days at 5min intervals

    // Risk thresholds
    uint128 public constant HIGH_VOL_THRESHOLD = 0.8e18;  // 80% annualized
    uint128 public constant HIGH_SKEW_THRESHOLD = 0.1e18; // 10% skew
    uint128 public constant HIGH_RISK_THRESHOLD = 0.7e18; // 70% risk score

    // ============ State ============

    /// @notice Uniswap v4 Pool Manager
    address public immutable poolManager;

    /// @notice Pool ID for the tracked pair
    bytes32 public immutable poolId;

    /// @notice Oracle keeper/updater
    address public keeper;

    /// @notice Snapshot history (circular buffer)
    VolatilitySnapshot[] public snapshots;
    uint256 public snapshotHead;

    /// @notice Price history for RV calculation (circular buffer)
    uint256[] public priceHistory;
    uint256[] public priceTimestamps;
    uint256 public priceHead;
    uint256 public constant PRICE_HISTORY_SIZE = 2880; // 10 days at 5min

    /// @notice Last update timestamp
    uint256 public lastUpdateTime;

    /// @notice Minimum update interval
    uint256 public updateInterval = 5 minutes;

    // ============ Constructor ============

    constructor(address _poolManager, bytes32 _poolId, address _keeper) {
        poolManager = _poolManager;
        poolId = _poolId;
        keeper = _keeper;

        // Initialize price history
        priceHistory = new uint256[](PRICE_HISTORY_SIZE);
        priceTimestamps = new uint256[](PRICE_HISTORY_SIZE);
    }

    // ============ Modifiers ============

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Only keeper");
        _;
    }

    // ============ External Functions ============

    /**
     * @notice Update the oracle with new price data
     * @param currentPrice Current spot price (18 decimals)
     * @param tickLiquidity Array of liquidity at tick ranges for IV calculation
     * @param tickRanges Corresponding tick range boundaries
     */
    function update(
        uint256 currentPrice,
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges
    ) external onlyKeeper {
        require(block.timestamp >= lastUpdateTime + updateInterval, "Too soon");

        // Record price
        _recordPrice(currentPrice);

        // Calculate metrics
        uint128 rv = _calculateRealizedVolatility(24 hours);
        uint128 iv = _calculateImpliedVolatility(tickLiquidity, tickRanges, currentPrice);
        int128 vrp = int128(iv) - int128(rv);
        int128 skew = _calculateSkew(tickLiquidity, tickRanges, currentPrice);
        int128 term = _calculateTermStructure(tickLiquidity, tickRanges);
        uint128 atmIV = iv; // Simplified: ATM IV ≈ overall IV
        uint128 risk = _calculateRiskScore(rv, iv, skew);

        // Create snapshot
        VolatilitySnapshot memory snapshot = VolatilitySnapshot({
            timestamp: block.timestamp,
            blockNumber: block.number,
            realizedVol: rv,
            impliedVol: iv,
            volRiskPremium: vrp,
            skew25Delta: skew,
            termStructure: term,
            atmIV: atmIV,
            riskScore: risk
        });

        // Store snapshot
        if (snapshots.length < MAX_SNAPSHOTS) {
            snapshots.push(snapshot);
        } else {
            snapshots[snapshotHead] = snapshot;
            snapshotHead = (snapshotHead + 1) % MAX_SNAPSHOTS;
        }

        lastUpdateTime = block.timestamp;

        emit SnapshotUpdated(
            snapshots.length - 1,
            rv,
            iv,
            skew,
            risk
        );

        // Emit risk alert if needed
        if (risk >= HIGH_RISK_THRESHOLD) {
            string memory reason = risk >= 0.9e18 ? "EXTREME" :
                                   iv >= HIGH_VOL_THRESHOLD ? "HIGH_VOL" :
                                   skew >= int128(uint128(HIGH_SKEW_THRESHOLD)) ? "HIGH_SKEW" : "ELEVATED";
            emit RiskAlert(snapshots.length - 1, risk, reason);
        }
    }

    // ============ View Functions ============

    function getLatestSnapshot() external view override returns (VolatilitySnapshot memory) {
        require(snapshots.length > 0, "No snapshots");
        uint256 latestIndex = snapshots.length < MAX_SNAPSHOTS
            ? snapshots.length - 1
            : (snapshotHead + MAX_SNAPSHOTS - 1) % MAX_SNAPSHOTS;
        return snapshots[latestIndex];
    }

    function getSnapshot(uint256 index) external view override returns (VolatilitySnapshot memory) {
        require(index < snapshots.length, "Index out of bounds");
        return snapshots[index];
    }

    function getRealizedVolatility(uint32 window) external view override returns (uint128) {
        return _calculateRealizedVolatility(window);
    }

    function getImpliedVolatility() external view override returns (uint128) {
        if (snapshots.length == 0) return 0;
        return snapshots[snapshots.length - 1].impliedVol;
    }

    function getVolRiskPremium() external view override returns (int128) {
        if (snapshots.length == 0) return 0;
        return snapshots[snapshots.length - 1].volRiskPremium;
    }

    function getSkew25Delta() external view override returns (int128) {
        if (snapshots.length == 0) return 0;
        return snapshots[snapshots.length - 1].skew25Delta;
    }

    function getTermStructure() external view override returns (int128) {
        if (snapshots.length == 0) return 0;
        return snapshots[snapshots.length - 1].termStructure;
    }

    function getRiskScore() external view override returns (uint128) {
        if (snapshots.length == 0) return 0;
        return snapshots[snapshots.length - 1].riskScore;
    }

    function getVolSmile(uint32 daysToExpiry) external view override returns (VolSmile memory) {
        // Simplified implementation - would need options data for full smile
        if (snapshots.length == 0) {
            return VolSmile(daysToExpiry, 0, 0, 0, 0, 0);
        }

        VolatilitySnapshot memory latest = snapshots[snapshots.length - 1];
        uint128 atm = latest.atmIV;
        int128 skew = latest.skew25Delta;

        // Estimate wing IVs from skew
        uint128 put25 = uint128(int128(atm) + skew / 2);
        uint128 call25 = uint128(int128(atm) - skew / 2);
        uint128 put10 = uint128(int128(put25) + skew / 2);
        uint128 call10 = uint128(int128(call25) - skew / 2);

        return VolSmile({
            daysToExpiry: daysToExpiry,
            atmIV: atm,
            put25IV: put25,
            put10IV: put10,
            call25IV: call25,
            call10IV: call10
        });
    }

    function getLiquidityDepth() external view override returns (LiquidityDepth memory) {
        // Would need to query pool state for accurate depth
        return LiquidityDepth(0, 0, 0, 0);
    }

    function getSnapshots(uint256 start, uint256 count)
        external view override returns (VolatilitySnapshot[] memory)
    {
        uint256 len = snapshots.length;
        if (start >= len) return new VolatilitySnapshot[](0);

        uint256 end = start + count;
        if (end > len) end = len;

        VolatilitySnapshot[] memory result = new VolatilitySnapshot[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = snapshots[i];
        }
        return result;
    }

    function snapshotCount() external view override returns (uint256) {
        return snapshots.length;
    }

    // ============ Internal Functions ============

    function _recordPrice(uint256 price) internal {
        priceHistory[priceHead] = price;
        priceTimestamps[priceHead] = block.timestamp;
        priceHead = (priceHead + 1) % PRICE_HISTORY_SIZE;
    }

    function _calculateRealizedVolatility(uint256 window) internal view returns (uint128) {
        return VolatilityMath.calculateRealizedVol(
            priceHistory,
            priceTimestamps,
            priceHead,
            window
        );
    }

    function _calculateImpliedVolatility(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges,
        uint256 currentPrice
    ) internal pure returns (uint128) {
        return VolatilityMath.calculateImpliedVol(
            tickLiquidity,
            tickRanges,
            currentPrice
        );
    }

    function _calculateSkew(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges,
        uint256 currentPrice
    ) internal pure returns (int128) {
        return VolatilityMath.calculateSkew(
            tickLiquidity,
            tickRanges,
            currentPrice
        );
    }

    function _calculateTermStructure(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges
    ) internal pure returns (int128) {
        return VolatilityMath.calculateTermStructure(tickLiquidity, tickRanges);
    }

    function _calculateRiskScore(
        uint128 rv,
        uint128 iv,
        int128 skew
    ) internal pure returns (uint128) {
        return VolatilityMath.calculateRiskScore(rv, iv, skew);
    }

    // ============ Admin Functions ============

    function setKeeper(address _keeper) external {
        require(msg.sender == keeper, "Only keeper");
        keeper = _keeper;
    }

    function setUpdateInterval(uint256 _interval) external onlyKeeper {
        require(_interval >= 1 minutes && _interval <= 1 hours, "Invalid interval");
        updateInterval = _interval;
    }
}
