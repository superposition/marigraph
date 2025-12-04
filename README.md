# Marigraph

Terminal-based volatility surface visualization and risk oracle, built with Bun and Ink.

> **mari-** (Latin: sea) + **-graph** (Greek: drawing) = "sea drawing" - visualizing the waves and surfaces of volatility

## Features

- **7-Column Risk Oracle** - 3D surface cube with risk inference panels
- **Binary IPC Protocol** - Efficient stdin/stdout communication between columns
- **Unix Socket Server** - External program integration via JSON-RPC
- **Volatility Surface Models** - SVI calibration, interpolation, arbitrage detection
- **Streaming Statistics** - Welford's algorithm for real-time metrics
- **YAML/JSON Templates** - Configurable layouts and event wiring

## Installation

```bash
bun install
```

## Usage

```bash
# Run TUI with demo data (hot reload)
bun run dev

# Run TUI
bun run start

# Run CLI
bun run cli --help

# Run with custom template
bun run cli --template my-config.yaml

# Generate example template
bun run cli --generate > template.yaml
```

## Risk Oracle Layout

```
┌─────────────┬─────────────────────────┬─────────────┐
│ Term        │                         │ Smile       │
│ Structure   │     3D SURFACE CUBE     │ Skew        │
├─────────────┤       (center)          ├─────────────┤
│ Slope       │                         │ Arbitrage   │
│ Analysis    │                         │ Detection   │
├─────────────┼─────────────────────────┼─────────────┤
│ Risk Score  │      Status / Log       │ Alerts      │
└─────────────┴─────────────────────────┴─────────────┘
```

## Architecture

```mermaid
flowchart TB
    subgraph Main["Main Process (Bun)"]
        CLI[CLI Entry]
        Config[Config Loader]
        Router[IPC Router]
    end

    subgraph IPC["IPC Layer"]
        Bus[Message Bus]
        Sockets[Unix Sockets]
    end

    subgraph Columns["Column Workers"]
        subgraph Col1["Term Structure"]
            C1[Chart Widget]
        end
        subgraph Col2["3D Surface"]
            C2[Surface Widget]
        end
        subgraph Col3["Smile/Skew"]
            C3[Chart Widget]
        end
        subgraph Col4["Risk Score"]
            C4[Gauge Widget]
        end
        subgraph Col5["Arbitrage"]
            C5[List Widget]
        end
        subgraph Col6["Alerts"]
            C6[Log Widget]
        end
    end

    subgraph External["External Programs"]
        Ext1[Python Script]
        Ext2[Shell Command]
        Ext3[WebSocket Feed]
    end

    CLI --> Config
    Config --> Router
    Router <-->|Binary Frames| Bus
    Bus <-->|stdin/stdout| Col1
    Bus <-->|stdin/stdout| Col2
    Bus <-->|stdin/stdout| Col3
    Bus <-->|stdin/stdout| Col4
    Bus <-->|stdin/stdout| Col5
    Bus <-->|stdin/stdout| Col6
    Sockets <-->|JSON-RPC| External
```

### Event Flow

```mermaid
sequenceDiagram
    participant Main as Main Process
    participant Bus as IPC Bus
    participant Surface as Surface Widget
    participant Risk as Risk Score
    participant Alerts as Alerts Log

    Main->>Bus: spawn columns
    Bus->>Surface: INIT
    Surface-->>Bus: READY

    Note over Surface: User rotates view
    Surface->>Bus: SURFACE_UPDATE
    Bus->>Risk: RISK_METRICS

    Risk->>Risk: compute score
    Risk-->>Bus: RISK_THRESHOLD
    Bus->>Alerts: APPEND alert
```

### Risk Oracle Data Flow

```mermaid
flowchart LR
    Surface[3D Surface] -->|SURFACE_UPDATE| Term[Term Structure]
    Surface -->|SURFACE_UPDATE| Smile[Smile Skew]
    Surface -->|SURFACE_UPDATE| Slope[Slope Analysis]
    Surface -->|SURFACE_UPDATE| Arb[Arb Detection]
    Surface -->|RISK_METRICS| Score[Risk Score]
    Arb -->|ARBITRAGE_FOUND| Alerts[Alerts]
    Score -->|RISK_THRESHOLD| Alerts
```

### On-Chain Oracle Architecture

```mermaid
flowchart TB
    subgraph OffChain["Off-Chain (Marigraph TUI)"]
        TUI[Terminal UI]
        Surface[Volatility Surface]
        Metrics[Risk Metrics Engine]
    end

    subgraph Uniswap["Uniswap v4"]
        PM[PoolManager]
        Hook[VolatilityHook]
    end

    subgraph Oracle["Volatility Oracle System"]
        VO[VolatilityOracle.sol]
        VM[VolatilityMath.sol]
        VK[VolatilityKeeper.sol]
    end

    subgraph Chainlink["Chainlink Automation"]
        CK[ChainlinkVolatilityKeeper]
        Registry[Keeper Registry]
        Nodes[Automation Nodes]
    end

    subgraph Consumers["On-Chain Consumers"]
        Vaults[Vault Strategies]
        Options[Options Protocols]
        Risk[Risk Managers]
    end

    TUI --> Surface
    Surface --> Metrics
    Metrics -->|Display| TUI

    PM -->|Pool State| Hook
    PM -->|sqrtPriceX96, liquidity| VK

    Hook -->|beforeSwap/afterSwap| VO
    VK -->|update()| VO
    VO --> VM

    CK -->|checkUpkeep| Nodes
    Nodes -->|performUpkeep| CK
    CK -->|update()| VO
    Registry -->|LINK| CK

    VO -->|getLatestSnapshot()| Consumers
    VO -->|getRiskScore()| Consumers
    VO -->|getVolSmile()| Consumers
```

### Oracle Data Payload

```mermaid
flowchart LR
    subgraph Input["Pool Data"]
        Price[sqrtPriceX96]
        Liq[Tick Liquidity<br/>21 samples]
        Tick[Current Tick]
    end

    subgraph Computed["Computed Metrics"]
        RV[Realized Vol<br/>uint128]
        IV[Implied Vol<br/>uint128]
        VRP[Vol Risk Premium<br/>int128]
        Skew[25Δ Skew<br/>int128]
        Term[Term Structure<br/>int128]
        Risk[Risk Score<br/>uint128]
    end

    subgraph Snapshot["VolatilitySnapshot"]
        S[timestamp<br/>blockNumber<br/>realizedVol<br/>impliedVol<br/>volRiskPremium<br/>skew25Delta<br/>termStructure<br/>atmIV<br/>riskScore]
    end

    Price --> RV
    Price --> IV
    Liq --> IV
    Liq --> Skew
    Tick --> Term

    RV --> VRP
    IV --> VRP

    RV --> Risk
    IV --> Risk
    Skew --> Risk
    Term --> Risk

    RV --> S
    IV --> S
    VRP --> S
    Skew --> S
    Term --> S
    Risk --> S
```

### Chainlink Automation Flow

```mermaid
sequenceDiagram
    participant Nodes as Chainlink Nodes
    participant Keeper as ChainlinkVolatilityKeeper
    participant Pool as Uniswap v4 Pool
    participant Oracle as VolatilityOracle

    loop Every Block
        Nodes->>Keeper: checkUpkeep()
        Keeper->>Keeper: Check time elapsed
        alt 5 minutes passed
            Keeper-->>Nodes: (true, performData)
        else Too soon
            Keeper-->>Nodes: (false, "")
        end
    end

    Nodes->>Keeper: performUpkeep(performData)
    Keeper->>Pool: getSlot0(poolId)
    Pool-->>Keeper: sqrtPriceX96, tick
    Keeper->>Pool: getLiquidity(poolId)
    Pool-->>Keeper: liquidity samples
    Keeper->>Oracle: update(price, liquidity, ticks)
    Oracle->>Oracle: Compute RV, IV, Skew, Risk
    Oracle-->>Oracle: Store Snapshot
    Oracle->>Oracle: Emit SnapshotUpdated

    alt Risk > 70%
        Oracle->>Oracle: Emit RiskAlert
    end
```

### Binary Frame Protocol

```mermaid
packet-beta
    0-31: "Length (u32)"
    32-39: "Type (u8)"
    40-47: "Flags (u8)"
    48-63: "Sequence (u16)"
    64-95: "Payload..."
```

### IPC Protocol

8-byte frame header:
- `length: u32` - payload length
- `type: u8` - message type
- `flags: u8` - compression, request flag
- `seq: u16` - sequence number

### Message Types

| Type | Value | Description |
|------|-------|-------------|
| INIT | 0x00 | Initialize column |
| READY | 0x01 | Column ready |
| SHUTDOWN | 0x02 | Graceful shutdown |
| SURFACE_FULL | 0x10 | Full surface data |
| SET_DATA | 0x20 | Set widget data |
| SELECTED | 0x30 | Item selected event |

## Modules

### Data Types (`src/data/`)
- `vec.ts` - Vec64/Vec32 TypedArray wrappers
- `surface.ts` - 3D surface with slope computation

### IPC (`src/ipc/`)
- `protocol.ts` - Message types and constants
- `frame.ts` - Binary frame encode/decode
- `serialize.ts` - Surface serialization

### Render (`src/render/`)
- `project.ts` - 3D to 2D projection
- `cube.ts` - Wireframe cube rendering
- `rasterize.ts` - ASCII/braille rasterization
- `gradient.ts` - Slope-based color mapping

### Statistics (`src/stats/`)
- `welford.ts` - Streaming mean/variance/skewness/kurtosis
- `dispersion.ts` - Full dispersion metrics
- `quantile.ts` - Percentile calculations

### Surface Models (`src/surface/`)
- `interpolate.ts` - Bilinear/bicubic interpolation
- `svi.ts` - SVI volatility model
- `arbitrage.ts` - Calendar/butterfly arbitrage detection

### Widgets (`src/column/widgets/`)
- `Surface.tsx` - 3D surface visualization
- `List.tsx` - Scrollable list
- `Table.tsx` - Data table
- `Chart.tsx` - Sparklines, bar charts
- `Log.tsx` - Append-only log

## Template Configuration

```yaml
name: my-dashboard
layout:
  rows: 2
  cols: 3

columns:
  - id: surface
    type: surface
    title: 3D View
    position:
      row: 0
      col: 1
      colSpan: 2

  - id: list
    type: list
    title: Items

wiring:
  - on:
      column: list
      event: SELECTED
    do:
      column: surface
      action: SET_DATA
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/stats/stats.test.ts
```

## External Program Integration

Connect via Unix socket:
```bash
nc -U /tmp/sixcol-{id}/col1.sock
```

Send JSON-RPC:
```json
{"method": "setData", "params": {"data": [1, 2, 3]}}
{"method": "getData", "id": 1}
```

## License

MIT
