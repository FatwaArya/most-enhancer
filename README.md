# MOST Enhancer

Chrome extension that enhances the order book and Price Vol Freq tables on Mandiri Sekuritas (MOST) / Growin trading platforms with real-time overlays, anomaly detection, and flow analysis.

## Features

### Order Book Enhancement

- **Depth Bars** — visual bars showing relative lot size per price level (green = bid, red = ask)
- **Heatmap** — background intensity proportional to lot size
- **Wall Detection** — highlights price levels where a single order exceeds a configurable % of total visible lot
- **Big Lot Alerts** — flags orders above a configurable lot threshold
- **Frequency Spikes** — detects price levels with unusually high trade frequency relative to neighbors
- **Imbalance Meters** — real-time lot ratio and cumulative depth ratio (bid vs ask)
- **Spread Bar** — visual spread indicator between best bid and best ask
- **Alert Panel** — auto-dismissing toast notifications for walls, spikes, imbalance shifts, and wide spreads

### Price Vol Freq (PVF) Enhancement

Injects 7 derived columns into the Price Vol Freq table:

| Column | Description |
|--------|-------------|
| **Lot** | Buy Lot - Sell Lot (net directional pressure) |
| **Buy %** | Buy Lot as % of total visible lot |
| **Freq** | Buy Freq - Sell Freq (net trade activity) |
| **Flow** | Change in net lot vs previous snapshot |
| **Mom** | Composite momentum score (0-100) from flow, buy%, freq delta, and price direction |
| **State** | ACCUM / DIST / ABSORB / BREAKOUT / NEUTRAL |
| **Signal** | Breakout, Strong Buy, Buy, Sell, Iceberg, Absorb, or Neutral |

State detection uses snapshot history (up to 120 ticks) to identify accumulation, distribution, absorption (hidden liquidity at a stable price), and breakout conditions. Iceberg detection triggers when volume consistently exceeds visible buy+sell lot at a stable price.

### Multi-Panel Aware

Supports pages with multiple order book panels simultaneously (e.g. stock comparison views). Each container gets its own overlays, alerts, and control panel.

## Installation

1. Clone this repo or download as ZIP
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the extension directory
5. Navigate to [pro.growin.id](https://pro.growin.id) or [most.co.id](https://most.co.id)

## Configuration

Click the extension icon in the toolbar to open settings:

**Detection**
- Wall Threshold (%) — minimum % of total lot to flag as a wall (default: 8%)
- Big Lot Threshold — minimum lot count for big lot alerts (default: 500,000)
- Freq Spike Multiplier — how much above average a frequency must be to flag (default: 2.5x)
- Cumulative Levels — number of top levels for cumulative depth ratio (default: 10)

**Order Book Toggles**
- Depth Bars, Heatmap, Imbalance Meters, Spread Bar, Alerts, Sound

**PVF Toggle**
- Enable/disable the injected Price Vol Freq columns

All settings sync via `chrome.storage.sync` and apply in real-time without page reload.

## File Structure

```
manifest.json        — MV3 manifest
content.js           — Orchestrator: finds OB containers, attaches observers, routes updates
metrics.js           — Pure calculation: depth bars, heatmap, walls, spikes, imbalance, spread
overlay.js           — DOM rendering: depth bars, tags, row highlights, freq coloring
alerts.js            — Per-container alert panel with auto-dismiss and dedup
control-panel.js     — Floating metrics bar with feature toggles (bottom-anchored)
pvf-injector.js      — PVF table column injection, snapshot history, flow/momentum computation
styles.css           — Design system (CSS custom properties, all animations use transform/opacity)
popup/               — Settings UI (popup.html, popup.css, popup.js)
icons/               — Extension icons (16, 48, 128px)
```

## Architecture

```
content.js (orchestrator)
  |
  +-- findAllOrderBooks() -> MutationObserver per container
  |
  +-- onObUpdate(container)
  |     |-- parseOrderBook(container) -> {bidRows, askRows, bestBid, bestAsk}
  |     |-- ObMetrics.calcDepthBars / calcHeatmapIntensity
  |     |-- ObMetrics.calcImbalance / calcSpread / calcCumDepthRatio
  |     |-- ObMetrics.detectWalls / detectFreqSpikes
  |     |-- ObOverlay.renderOverlay(...)
  |     |-- ObAlerts.processAlerts(...)
  |     +-- ObControlPanel.updateMetrics(...)
  |
  +-- onPvfUpdate()
        +-- PvfInjector.update() -> inject/compute/update PVF columns
```

All modules are stateless or use WeakMaps keyed on DOM containers. No global mutation. Each OB container is independently observed, rendered, and cleaned up on removal.

## Permissions

- `activeTab` — access the current tab to inject content scripts
- `storage` — persist user settings via `chrome.storage.sync`

## License

MIT
