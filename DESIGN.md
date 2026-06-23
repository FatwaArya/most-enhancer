# MOST Enhancer v4 — Cognitive Trading Aid

## Problem
Trader has ~30 data points to process in 2-5 seconds. Too many numbers, too much
serial processing. Decision flow takes 5+ steps.

## Principle
Replace numbers with pre-attentive visual signals (color, size, motion).
A buy/sell/wait decision should take ONE GLANCE.

## Architecture: 4 Layers

### Layer 1: Row Pressure Borders (zero extra DOM)
Every OB row gets a colored left border:
- Green = net buying at this price (buy freq > sell freq)
- Red = net selling
- Gray = neutral
- Border WIDTH = intensity of imbalance (2-6px)

### Layer 2: Signal Strip (replaces imbalance panel + spread bar)
Single bar above OB grid:
```
[======== green/red depth bar ========] BUY 72% · 3W · R:1.24
```
- Horizontal depth visualization (green fill = bid heavy, red = ask heavy)
- Signal word: BUY / SELL / ABSORB / BREAKOUT / NEUTRAL
- Wall count + cum ratio as compact text

### Layer 3: PVF Condensed (3 columns instead of 7)
| Column | Shows | Visual |
|--------|-------|--------|
| State | ACCUM/DIST/ABSORB/BREAKOUT | Colored pill |
| Mom | Momentum 0-100 | Horizontal bar |
| Signal | Buy/Sell/Strong/Iceberg | Emoji + word |

### Layer 4: Level Change Detection (tape reading)
Track lot changes at each price level between ticks:
- Lot INCREASED → brief green flash (300ms)
- Lot DECREASED (order pulled) → brief red flash (300ms)
- Detects when big players add/remove liquidity

## What was removed (noise reduction)
- Alert toast panel → replaced by row highlights
- Wall/Big tags → replaced by row pressure borders
- Spread bar → folded into signal strip
- Imbalance panel (3 rows) → folded into signal strip
- 4 of 7 PVF columns → keep only State, Mom, Signal

## Decision flow
Before: Read numbers → compute ratio → check alerts → read PVF → decide (5+ sec)
After:  Glance at signal strip → scan row colors → decide (1-2 sec)
