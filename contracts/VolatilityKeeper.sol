// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/IVolatilityOracle.sol";

/**
 * @title IPoolManager
 * @notice Minimal Uniswap v4 Pool Manager interface
 */
interface IPoolManager {
    function getSlot0(bytes32 poolId) external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee
    );

    function getLiquidity(bytes32 poolId) external view returns (uint128);

    function getPosition(
        bytes32 poolId,
        address owner,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt
    ) external view returns (uint128 liquidity, uint256 feeGrowthInside0, uint256 feeGrowthInside1);
}

/**
 * @title VolatilityKeeper
 * @notice Keeper contract for updating the Volatility Oracle
 * @dev Fetches Uniswap v4 pool data and pushes to oracle
 */
contract VolatilityKeeper {
    // ============ Constants ============

    uint256 constant Q96 = 2**96;
    uint256 constant PRECISION = 1e18;
    int24 constant TICK_SPACING = 60; // 0.3% fee tier

    // ============ State ============

    address public owner;
    IPoolManager public immutable poolManager;
    IVolatilityOracle public oracle;
    bytes32 public poolId;

    /// @notice Authorized keepers
    mapping(address => bool) public keepers;

    /// @notice Tick sample configuration
    int24 public tickSampleSpacing = 600; // ~6% per sample
    uint256 public tickSampleCount = 21;  // 10 each side + ATM

    // ============ Events ============

    event KeeperUpdated(address keeper, bool authorized);
    event OracleUpdated(uint256 price, uint128 rv, uint128 iv, uint128 riskScore);

    // ============ Constructor ============

    constructor(
        address _poolManager,
        address _oracle,
        bytes32 _poolId
    ) {
        owner = msg.sender;
        poolManager = IPoolManager(_poolManager);
        oracle = IVolatilityOracle(_oracle);
        poolId = _poolId;
        keepers[msg.sender] = true;
    }

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyKeeper() {
        require(keepers[msg.sender], "Only keeper");
        _;
    }

    // ============ Keeper Functions ============

    /**
     * @notice Update the oracle with current pool state
     * @dev Called by authorized keepers (e.g., Chainlink Automation, Gelato)
     */
    function updateOracle() external onlyKeeper {
        // Get current pool state
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolId);
        uint256 price = _sqrtPriceToPrice(sqrtPriceX96);

        // Sample liquidity distribution
        (uint128[] memory liquidity, int24[] memory ticks) = sampleTickLiquidity(currentTick);

        // Push to oracle
        oracle.update(price, liquidity, ticks);

        // Get updated metrics for event
        IVolatilityOracle.VolatilitySnapshot memory snapshot = oracle.getLatestSnapshot();

        emit OracleUpdated(
            price,
            snapshot.realizedVol,
            snapshot.impliedVol,
            snapshot.riskScore
        );
    }

    /**
     * @notice Check if oracle should be updated
     * @return upkeepNeeded Whether update is needed
     * @return performData Empty bytes (not used)
     */
    function checkUpkeep(bytes calldata)
        external view returns (bool upkeepNeeded, bytes memory performData)
    {
        // Check if enough time has passed
        try oracle.getLatestSnapshot() returns (IVolatilityOracle.VolatilitySnapshot memory snapshot) {
            upkeepNeeded = block.timestamp >= snapshot.timestamp + 5 minutes;
        } catch {
            upkeepNeeded = true; // No snapshots yet
        }

        return (upkeepNeeded, "");
    }

    /**
     * @notice Perform the oracle update (Chainlink Automation compatible)
     */
    function performUpkeep(bytes calldata) external {
        require(keepers[msg.sender] || msg.sender == address(this), "Not authorized");
        this.updateOracle();
    }

    // ============ View Functions ============

    /**
     * @notice Sample liquidity at tick ranges around current price
     */
    function sampleTickLiquidity(int24 currentTick)
        public view returns (uint128[] memory, int24[] memory)
    {
        uint128[] memory liquidity = new uint128[](tickSampleCount);
        int24[] memory ticks = new int24[](tickSampleCount);

        int24 halfRange = int24(uint24(tickSampleCount / 2));

        for (uint256 i = 0; i < tickSampleCount; i++) {
            int24 offset = (int24(uint24(i)) - halfRange) * tickSampleSpacing;
            ticks[i] = currentTick + offset;

            // Round to tick spacing
            ticks[i] = (ticks[i] / TICK_SPACING) * TICK_SPACING;

            // Get liquidity at this tick (simplified - would need tick bitmap in production)
            liquidity[i] = poolManager.getLiquidity(poolId);
        }

        return (liquidity, ticks);
    }

    /**
     * @notice Get current pool price
     */
    function getPoolPrice() external view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        return _sqrtPriceToPrice(sqrtPriceX96);
    }

    /**
     * @notice Get current pool tick
     */
    function getPoolTick() external view returns (int24) {
        (, int24 tick,,) = poolManager.getSlot0(poolId);
        return tick;
    }

    // ============ Internal Functions ============

    function _sqrtPriceToPrice(uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        // price = (sqrtPriceX96)^2 / 2^192 * 10^18
        return (sqrtPrice * sqrtPrice * PRECISION) >> 192;
    }

    // ============ Admin Functions ============

    function setKeeper(address keeper, bool authorized) external onlyOwner {
        keepers[keeper] = authorized;
        emit KeeperUpdated(keeper, authorized);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = IVolatilityOracle(_oracle);
    }

    function setPoolId(bytes32 _poolId) external onlyOwner {
        poolId = _poolId;
    }

    function setTickSampling(int24 spacing, uint256 count) external onlyOwner {
        tickSampleSpacing = spacing;
        tickSampleCount = count;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
