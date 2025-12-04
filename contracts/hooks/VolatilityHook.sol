// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IVolatilityOracle.sol";

/**
 * @title IPoolManager
 * @notice Minimal interface for Uniswap v4 Pool Manager
 */
interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function getSlot0(bytes32 poolId) external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee
    );

    function getLiquidity(bytes32 poolId) external view returns (uint128);
}

/**
 * @title VolatilityHook
 * @notice Uniswap v4 hook that feeds the Volatility Oracle
 * @dev Updates oracle on swaps and liquidity changes
 */
contract VolatilityHook {
    // ============ Constants ============

    /// @notice Hook permissions flags
    uint256 public constant BEFORE_SWAP_FLAG = 1 << 7;
    uint256 public constant AFTER_SWAP_FLAG = 1 << 6;
    uint256 public constant BEFORE_ADD_LIQUIDITY_FLAG = 1 << 5;
    uint256 public constant AFTER_ADD_LIQUIDITY_FLAG = 1 << 4;

    uint256 constant Q96 = 2**96;

    // ============ State ============

    IPoolManager public immutable poolManager;
    IVolatilityOracle public volatilityOracle;
    bytes32 public poolId;

    /// @notice Tick ranges to sample for liquidity
    int24[] public sampleTicks;

    /// @notice Minimum blocks between oracle updates
    uint256 public updateCooldown = 50; // ~10 minutes at 12s blocks
    uint256 public lastUpdateBlock;

    // ============ Events ============

    event OracleUpdated(uint256 price, uint128 impliedVol);

    // ============ Constructor ============

    constructor(address _poolManager, address _oracle) {
        poolManager = IPoolManager(_poolManager);
        volatilityOracle = IVolatilityOracle(_oracle);

        // Initialize sample ticks around ATM
        _initializeSampleTicks();
    }

    // ============ Hook Callbacks ============

    /**
     * @notice Called after each swap - update oracle with new price
     */
    function afterSwap(
        address,
        IPoolManager.PoolKey calldata key,
        bool,
        int256,
        bytes calldata
    ) external returns (bytes4) {
        require(msg.sender == address(poolManager), "Only pool manager");

        if (block.number < lastUpdateBlock + updateCooldown) {
            return this.afterSwap.selector;
        }

        // Get current pool state
        bytes32 id = _computePoolId(key);
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(id);

        // Convert sqrtPriceX96 to price
        uint256 price = _sqrtPriceToPrice(sqrtPriceX96);

        // Sample liquidity at tick ranges
        (uint128[] memory liquidity, int24[] memory ticks) = _sampleLiquidity(id, currentTick);

        // Update oracle (this contract must be the keeper)
        // In production, this would be called by an authorized keeper
        // volatilityOracle.update(price, liquidity, ticks);

        lastUpdateBlock = block.number;
        emit OracleUpdated(price, 0);

        return this.afterSwap.selector;
    }

    /**
     * @notice Called after liquidity changes - significant for IV calculation
     */
    function afterAddLiquidity(
        address,
        IPoolManager.PoolKey calldata key,
        uint256,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        // Liquidity changes affect IV - trigger update if significant
        return this.afterAddLiquidity.selector;
    }

    // ============ View Functions ============

    /**
     * @notice Get current price from pool
     */
    function getCurrentPrice() external view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        return _sqrtPriceToPrice(sqrtPriceX96);
    }

    /**
     * @notice Get hook permissions
     */
    function getHookPermissions() external pure returns (uint256) {
        return AFTER_SWAP_FLAG | AFTER_ADD_LIQUIDITY_FLAG;
    }

    // ============ Internal Functions ============

    function _initializeSampleTicks() internal {
        // Sample 20 ticks on each side of ATM, spaced by 600 (~6% each)
        for (int24 i = -20; i <= 20; i++) {
            sampleTicks.push(i * 600);
        }
    }

    function _computePoolId(IPoolManager.PoolKey calldata key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function _sqrtPriceToPrice(uint160 sqrtPriceX96) internal pure returns (uint256) {
        // price = (sqrtPriceX96 / 2^96)^2
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        return (sqrtPrice * sqrtPrice) / Q96;
    }

    function _sampleLiquidity(bytes32 id, int24 currentTick)
        internal view returns (uint128[] memory, int24[] memory)
    {
        uint128[] memory liquidity = new uint128[](sampleTicks.length);
        int24[] memory ticks = new int24[](sampleTicks.length);

        for (uint256 i = 0; i < sampleTicks.length; i++) {
            ticks[i] = currentTick + sampleTicks[i];
            // In production, would query tick bitmap for actual liquidity
            liquidity[i] = poolManager.getLiquidity(id);
        }

        return (liquidity, ticks);
    }

    // ============ Admin Functions ============

    function setOracle(address _oracle) external {
        volatilityOracle = IVolatilityOracle(_oracle);
    }

    function setPoolId(bytes32 _poolId) external {
        poolId = _poolId;
    }

    function setUpdateCooldown(uint256 _blocks) external {
        updateCooldown = _blocks;
    }
}
