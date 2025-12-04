// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/IVolatilityOracle.sol";

/**
 * @title AutomationCompatibleInterface
 * @notice Chainlink Automation interface
 */
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata)
        external returns (bool upkeepNeeded, bytes memory performData);

    function performUpkeep(bytes calldata) external;
}

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
}

/**
 * @title LinkTokenInterface
 * @notice LINK token interface for funding
 */
interface LinkTokenInterface {
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
}

/**
 * @title KeeperRegistrarInterface
 * @notice Interface to register upkeeps programmatically
 */
interface KeeperRegistrarInterface {
    struct RegistrationParams {
        string name;
        bytes encryptedEmail;
        address upkeepContract;
        uint32 gasLimit;
        address adminAddress;
        uint8 triggerType;
        bytes checkData;
        bytes triggerConfig;
        bytes offchainConfig;
        uint96 amount;
    }

    function registerUpkeep(RegistrationParams calldata requestParams)
        external returns (uint256);
}

/**
 * @title ChainlinkVolatilityKeeper
 * @notice Chainlink Automation compatible keeper for the Volatility Oracle
 * @dev Implements checkUpkeep/performUpkeep pattern for automated updates
 */
contract ChainlinkVolatilityKeeper is AutomationCompatibleInterface {
    // ============ Constants ============

    uint256 constant Q96 = 2**96;
    uint256 constant PRECISION = 1e18;
    int24 constant TICK_SPACING = 60;

    // Chainlink addresses (Ethereum mainnet)
    address public constant LINK_TOKEN = 0x514910771AF9Ca656af840dff83E8264EcF986CA;
    address public constant KEEPER_REGISTRAR = 0x6B0B234fB2f380309D47A7E9391E29E9a179395a;
    address public constant KEEPER_REGISTRY = 0x6593c7De001fC8542bB1703532EE1E5aA0D458fD;

    // ============ State ============

    address public owner;
    IPoolManager public immutable poolManager;
    IVolatilityOracle public oracle;
    bytes32 public poolId;

    /// @notice Minimum interval between updates (seconds)
    uint256 public updateInterval = 5 minutes;

    /// @notice Last update timestamp
    uint256 public lastUpdateTime;

    /// @notice Chainlink upkeep ID (set after registration)
    uint256 public upkeepId;

    /// @notice Tick sample configuration
    int24 public tickSampleSpacing = 600;
    uint256 public tickSampleCount = 21;

    // ============ Events ============

    event UpkeepRegistered(uint256 indexed upkeepId, uint96 amount);
    event OracleUpdated(uint256 timestamp, uint256 price, uint128 riskScore);

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
    }

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // ============ Chainlink Automation Interface ============

    /**
     * @notice Check if upkeep is needed
     * @dev Called off-chain by Chainlink nodes
     * @return upkeepNeeded True if update is needed
     * @return performData Encoded data for performUpkeep (price + liquidity)
     */
    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Check time interval
        upkeepNeeded = (block.timestamp - lastUpdateTime) >= updateInterval;

        if (upkeepNeeded) {
            // Get current pool state for performData
            (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolId);
            uint256 price = _sqrtPriceToPrice(sqrtPriceX96);

            // Sample liquidity
            (uint128[] memory liquidity, int24[] memory ticks) = _sampleLiquidity(currentTick);

            // Encode for performUpkeep
            performData = abi.encode(price, liquidity, ticks);
        }

        return (upkeepNeeded, performData);
    }

    /**
     * @notice Perform the upkeep (update oracle)
     * @dev Called by Chainlink Automation nodes
     * @param performData Encoded price and liquidity data from checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external override {
        // Validate timing (re-check on-chain)
        if ((block.timestamp - lastUpdateTime) < updateInterval) {
            revert("Too soon");
        }

        // Decode data
        (
            uint256 price,
            uint128[] memory liquidity,
            int24[] memory ticks
        ) = abi.decode(performData, (uint256, uint128[], int24[]));

        // Update oracle
        oracle.update(price, liquidity, ticks);

        lastUpdateTime = block.timestamp;

        // Get risk score for event
        IVolatilityOracle.VolatilitySnapshot memory snapshot = oracle.getLatestSnapshot();

        emit OracleUpdated(block.timestamp, price, snapshot.riskScore);
    }

    // ============ Registration Functions ============

    /**
     * @notice Register this contract with Chainlink Automation
     * @param linkAmount Amount of LINK to fund the upkeep
     * @param gasLimit Gas limit for performUpkeep calls
     */
    function registerUpkeep(uint96 linkAmount, uint32 gasLimit) external onlyOwner {
        require(upkeepId == 0, "Already registered");

        LinkTokenInterface link = LinkTokenInterface(LINK_TOKEN);
        require(link.balanceOf(address(this)) >= linkAmount, "Insufficient LINK");

        // Approve registrar to spend LINK
        link.approve(KEEPER_REGISTRAR, linkAmount);

        // Build registration params
        KeeperRegistrarInterface.RegistrationParams memory params = KeeperRegistrarInterface.RegistrationParams({
            name: "Marigraph Volatility Oracle",
            encryptedEmail: "",
            upkeepContract: address(this),
            gasLimit: gasLimit,
            adminAddress: owner,
            triggerType: 0, // Conditional trigger
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: linkAmount
        });

        // Register
        upkeepId = KeeperRegistrarInterface(KEEPER_REGISTRAR).registerUpkeep(params);

        emit UpkeepRegistered(upkeepId, linkAmount);
    }

    /**
     * @notice Fund existing upkeep with more LINK
     * @param amount Amount of LINK to add
     */
    function fundUpkeep(uint96 amount) external {
        require(upkeepId != 0, "Not registered");

        LinkTokenInterface link = LinkTokenInterface(LINK_TOKEN);
        require(link.balanceOf(address(this)) >= amount, "Insufficient LINK");

        // Transfer LINK to registry for this upkeep
        link.transferAndCall(
            KEEPER_REGISTRY,
            amount,
            abi.encode(upkeepId)
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get current pool price
     */
    function getCurrentPrice() external view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        return _sqrtPriceToPrice(sqrtPriceX96);
    }

    /**
     * @notice Check if update is due
     */
    function isUpdateNeeded() external view returns (bool) {
        return (block.timestamp - lastUpdateTime) >= updateInterval;
    }

    /**
     * @notice Get time until next update
     */
    function timeUntilUpdate() external view returns (uint256) {
        uint256 nextUpdate = lastUpdateTime + updateInterval;
        if (block.timestamp >= nextUpdate) return 0;
        return nextUpdate - block.timestamp;
    }

    // ============ Internal Functions ============

    function _sqrtPriceToPrice(uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        return (sqrtPrice * sqrtPrice * PRECISION) >> 192;
    }

    function _sampleLiquidity(int24 currentTick)
        internal view returns (uint128[] memory, int24[] memory)
    {
        uint128[] memory liquidity = new uint128[](tickSampleCount);
        int24[] memory ticks = new int24[](tickSampleCount);

        int24 halfRange = int24(uint24(tickSampleCount / 2));

        for (uint256 i = 0; i < tickSampleCount; i++) {
            int24 offset = (int24(uint24(i)) - halfRange) * tickSampleSpacing;
            ticks[i] = ((currentTick + offset) / TICK_SPACING) * TICK_SPACING;
            liquidity[i] = poolManager.getLiquidity(poolId);
        }

        return (liquidity, ticks);
    }

    // ============ Admin Functions ============

    function setOracle(address _oracle) external onlyOwner {
        oracle = IVolatilityOracle(_oracle);
    }

    function setPoolId(bytes32 _poolId) external onlyOwner {
        poolId = _poolId;
    }

    function setUpdateInterval(uint256 _interval) external onlyOwner {
        require(_interval >= 1 minutes && _interval <= 1 hours, "Invalid interval");
        updateInterval = _interval;
    }

    function withdrawLink() external onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(LINK_TOKEN);
        uint256 balance = link.balanceOf(address(this));
        require(balance > 0, "No LINK");
        link.transferAndCall(owner, balance, "");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Receive LINK tokens
    receive() external payable {}
}
