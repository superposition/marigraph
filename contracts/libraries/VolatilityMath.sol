// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title VolatilityMath
 * @notice Mathematical functions for volatility calculations
 * @dev Uses fixed-point arithmetic with 18 decimals precision
 */
library VolatilityMath {
    uint256 constant PRECISION = 1e18;
    uint256 constant SECONDS_PER_YEAR = 365.25 days;
    int24 constant TICK_SPACING = 60; // 0.3% fee tier

    /**
     * @notice Calculate realized volatility from price history
     * @param prices Circular buffer of prices
     * @param timestamps Circular buffer of timestamps
     * @param head Current head position in buffer
     * @param window Time window in seconds
     * @return Annualized realized volatility (18 decimals)
     */
    function calculateRealizedVol(
        uint256[] storage prices,
        uint256[] storage timestamps,
        uint256 head,
        uint256 window
    ) internal view returns (uint128) {
        uint256 len = prices.length;
        if (len < 2) return 0;

        uint256 cutoff = block.timestamp - window;
        uint256 count = 0;
        uint256 sumSquaredReturns = 0;

        // Find valid price points within window
        for (uint256 i = 0; i < len && count < 1000; i++) {
            uint256 idx = (head + len - 1 - i) % len;
            uint256 prevIdx = (idx + len - 1) % len;

            if (timestamps[idx] == 0 || timestamps[prevIdx] == 0) continue;
            if (timestamps[idx] < cutoff) break;

            uint256 price = prices[idx];
            uint256 prevPrice = prices[prevIdx];

            if (price == 0 || prevPrice == 0) continue;

            // Calculate log return approximation: (P1 - P0) / P0
            // Squared for variance calculation
            int256 ret = (int256(price) - int256(prevPrice)) * int256(PRECISION) / int256(prevPrice);
            uint256 retSquared = uint256(ret * ret) / PRECISION;
            sumSquaredReturns += retSquared;
            count++;
        }

        if (count < 2) return 0;

        // Variance = sum of squared returns / (n - 1)
        uint256 variance = sumSquaredReturns / (count - 1);

        // Annualize: vol = sqrt(variance * periodsPerYear)
        // Assuming ~5 minute intervals: 365.25 * 24 * 12 = 105,192 periods/year
        uint256 periodsPerYear = SECONDS_PER_YEAR / (window / count);
        uint256 annualizedVariance = variance * periodsPerYear;

        // Square root approximation using Babylonian method
        return uint128(sqrt(annualizedVariance));
    }

    /**
     * @notice Calculate implied volatility from tick liquidity distribution
     * @dev Higher concentration = lower implied vol, sparse liquidity = higher vol
     * @param tickLiquidity Liquidity at each tick range
     * @param tickRanges Tick range boundaries
     * @param currentPrice Current spot price
     * @return Annualized implied volatility (18 decimals)
     */
    function calculateImpliedVol(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges,
        uint256 currentPrice
    ) internal pure returns (uint128) {
        if (tickLiquidity.length == 0 || tickRanges.length == 0) {
            return 0.3e18; // Default 30% IV
        }

        uint256 totalLiquidity = 0;
        uint256 weightedSpread = 0;

        // Calculate liquidity-weighted average spread from current price
        for (uint256 i = 0; i < tickLiquidity.length && i < tickRanges.length; i++) {
            uint128 liq = tickLiquidity[i];
            int24 tick = tickRanges[i];

            // Convert tick to price: price = 1.0001^tick
            // Approximate price difference from spot
            int256 tickDiff = int256(tick) - int256(priceToTick(currentPrice));
            uint256 priceDiff = abs(tickDiff) * 10; // ~0.01% per tick -> basis points

            totalLiquidity += liq;
            weightedSpread += uint256(liq) * priceDiff;
        }

        if (totalLiquidity == 0) return 0.3e18;

        // Average spread in basis points
        uint256 avgSpread = weightedSpread / totalLiquidity;

        // Convert spread to implied vol
        // Wider spread = higher IV, narrower = lower IV
        // Heuristic: IV ≈ spread * 4 (annualized from daily)
        uint256 iv = avgSpread * 4 * PRECISION / 10000;

        // Clamp to reasonable range [5%, 200%]
        if (iv < 0.05e18) iv = 0.05e18;
        if (iv > 2e18) iv = 2e18;

        return uint128(iv);
    }

    /**
     * @notice Calculate 25-delta skew from liquidity distribution
     * @dev Positive skew = puts more expensive than calls
     */
    function calculateSkew(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges,
        uint256 currentPrice
    ) internal pure returns (int128) {
        if (tickLiquidity.length < 2) return 0;

        int24 currentTick = priceToTick(currentPrice);
        uint256 putSideLiquidity = 0;
        uint256 callSideLiquidity = 0;

        for (uint256 i = 0; i < tickLiquidity.length && i < tickRanges.length; i++) {
            if (tickRanges[i] < currentTick) {
                putSideLiquidity += tickLiquidity[i];
            } else {
                callSideLiquidity += tickLiquidity[i];
            }
        }

        uint256 total = putSideLiquidity + callSideLiquidity;
        if (total == 0) return 0;

        // Skew = (put liquidity - call liquidity) / total
        // More put-side liquidity = negative skew (puts cheaper)
        // Less put-side liquidity = positive skew (puts more expensive)
        int256 skew = (int256(callSideLiquidity) - int256(putSideLiquidity)) * int256(PRECISION) / int256(total);

        // Scale to typical skew range (-20% to +20%)
        return int128(skew / 5);
    }

    /**
     * @notice Calculate term structure slope
     * @dev Positive = contango (longer-dated IV higher), Negative = backwardation
     */
    function calculateTermStructure(
        uint128[] calldata tickLiquidity,
        int24[] calldata tickRanges
    ) internal pure returns (int128) {
        // Simplified: use liquidity concentration as proxy for term structure
        // Concentrated liquidity suggests low near-term vol expectation (contango)
        // Sparse liquidity suggests high near-term vol (backwardation)

        if (tickLiquidity.length == 0) return 0;

        uint256 nearLiquidity = 0;
        uint256 farLiquidity = 0;
        uint256 half = tickLiquidity.length / 2;

        for (uint256 i = 0; i < tickLiquidity.length; i++) {
            if (i < half) {
                nearLiquidity += tickLiquidity[i];
            } else {
                farLiquidity += tickLiquidity[i];
            }
        }

        uint256 total = nearLiquidity + farLiquidity;
        if (total == 0) return 0;

        // Contango if far liquidity > near (market expects higher vol later)
        int256 term = (int256(farLiquidity) - int256(nearLiquidity)) * int256(PRECISION) / int256(total);
        return int128(term / 10); // Scale down
    }

    /**
     * @notice Calculate composite risk score
     * @param rv Realized volatility
     * @param iv Implied volatility
     * @param skew 25-delta skew
     * @return Risk score 0-1e18
     */
    function calculateRiskScore(
        uint128 rv,
        uint128 iv,
        int128 skew
    ) internal pure returns (uint128) {
        // Risk components:
        // 1. High IV = higher risk
        // 2. High VRP (IV >> RV) = fear, higher risk
        // 3. High positive skew = crash protection demand, higher risk

        uint256 ivScore = min(iv * 100 / 0.8e18, 100); // 0-100, maxed at 80% IV
        uint256 vrpScore = iv > rv ? min((iv - rv) * 100 / 0.3e18, 100) : 0; // 0-100
        uint256 skewScore = skew > 0 ? min(uint256(uint128(skew)) * 100 / 0.1e18, 100) : 0; // 0-100

        // Weighted average
        uint256 score = (ivScore * 40 + vrpScore * 35 + skewScore * 25) / 100;

        return uint128(score * PRECISION / 100);
    }

    // ============ Utility Functions ============

    function priceToTick(uint256 price) internal pure returns (int24) {
        // tick = log(price) / log(1.0001)
        // Simplified approximation for reasonable price ranges
        if (price >= PRECISION) {
            return int24(int256(log2(price / PRECISION) * 6932)); // log2 * ln(2)/ln(1.0001)
        } else {
            return -int24(int256(log2(PRECISION / price) * 6932));
        }
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function log2(uint256 x) internal pure returns (uint256) {
        uint256 result = 0;
        while (x >= 2) {
            x /= 2;
            result++;
        }
        return result;
    }

    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
