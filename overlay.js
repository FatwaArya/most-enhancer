/**
 * overlay.js — Cognitive trading overlay renderer.
 * 4 layers: row pressure, signal strip, depth bars, level change detection.
 * Zero-injection: all visuals in overlay div or CSS classes.
 */

/* global window, document */

(() => {
  'use strict';

  const P = 'ob-ext';

  // ─── State ───
  const cState = new WeakMap();  // container -> { overlay, rows, signalStrip, prevLots }
  const rowCache = new WeakMap(); // rowEl -> { depthBar, lotBar, tagSpike }

  const getState = (container) => {
    let s = cState.get(container);
    if (!s) {
      s = { overlay: null, rows: new Map(), signalStrip: null, prevLots: new Map() };
      cState.set(container, s);
    }
    return s;
  };

  const getRowState = (state, rowEl) => {
    let r = state.rows.get(rowEl);
    if (!r) { r = {}; state.rows.set(rowEl, r); }
    return r;
  };

  // ─── Helpers ───

  const fmt = (num) => {
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(0) + 'K';
    return String(num);
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ─── Overlay Container ───

  const ensureOverlay = (container, state) => {
    if (state.overlay && container.contains(state.overlay)) return state.overlay;
    container.querySelectorAll(`.${P}-overlay`).forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = `${P}-overlay`;
    container.style.position = container.style.position || 'relative';
    container.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  };

  // ═══════════════════════════════════════════
  // LAYER 1: Row Pressure Borders
  // ═══════════════════════════════════════════

  const updateRowPressure = (bidRows, askRows) => {
    const allRows = [...(bidRows || []), ...(askRows || [])];
    for (const row of allRows) {
      if (!row.rowElement) continue;
      const el = row.rowElement;
      const buyF = row.side === 'bid' ? (row.freq || 0) : 0;
      const sellF = row.side === 'ask' ? (row.freq || 0) : 0;
      // For bid rows, freq IS buy-side freq. For ask rows, freq IS sell-side freq.
      // We don't have cross-side freq per row, so use lot ratio as proxy.
      const totalLot = (bidRows || []).reduce((s, r) => s + (r.lot || 0), 0) +
                       (askRows || []).reduce((s, r) => s + (r.lot || 0), 0);
      const sideLot = row.lot || 0;
      const ratio = totalLot > 0 ? sideLot / totalLot : 0;
      const intensity = clamp(ratio * 3, 0.15, 0.6);

      if (row.side === 'bid') {
        el.style.borderLeft = `3px solid rgba(63,185,80,${intensity.toFixed(2)})`;
      } else {
        el.style.borderLeft = `3px solid rgba(248,81,73,${intensity.toFixed(2)})`;
      }
    }
  };

  // ═══════════════════════════════════════════
  // LAYER 2: Signal Strip
  // ═══════════════════════════════════════════

  const computeSignal = (imbalance, cumRatio, walls, spikes, bidRows, askRows) => {
    const totalLot = (bidRows || []).reduce((s, r) => s + (r.lot || 0), 0) +
                     (askRows || []).reduce((s, r) => s + (r.lot || 0), 0);

    // No data — market closed or empty OB
    if (totalLot === 0) {
      return { signal: 'NO DATA', color: '#30363d', buyPct: 50, wallCount: 0, spikeCount: 0 };
    }

    const buyPct = imbalance ? Math.round(imbalance.lotRatio * 100) : 50;
    const wallCount = walls?.length || 0;
    const spikeCount = spikes?.length || 0;

    let signal = 'NEUTRAL';
    let color = '#484f58';

    if (cumRatio > 1.3 && buyPct > 65) {
      signal = 'STRONG BUY'; color = '#3fb950';
    } else if (cumRatio > 1.1 && buyPct > 58) {
      signal = 'BUY'; color = '#3fb950';
    } else if (cumRatio < 0.7 && buyPct < 35) {
      signal = 'STRONG SELL'; color = '#f85149';
    } else if (cumRatio < 0.9 && buyPct < 42) {
      signal = 'SELL'; color = '#f85149';
    } else if (wallCount >= 3) {
      signal = 'WALLS'; color = '#d29922';
    } else if (spikeCount >= 2) {
      signal = 'SPIKES'; color = '#e3b341';
    }

    return { signal, color, buyPct, wallCount, spikeCount };
  };

  const updateSignalStrip = (imbalance, spread, cumRatio, walls, spikes, container, bidRows, askRows) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let s = cState.get(container);
    if (!s) { s = getState(container); }

    if (!s.signalStrip || !container.contains(s.signalStrip)) {
      const strip = document.createElement('div');
      strip.className = `${P}-signal-strip`;
      grid.parentElement.insertBefore(strip, grid);
      s.signalStrip = strip;
    }

    const sig = computeSignal(imbalance, cumRatio, walls, spikes, bidRows, askRows);
    const ratio = imbalance ? imbalance.lotRatio : 0.5;

    // Build the bar fill
    const bidWidth = Math.round(ratio * 100);
    const askWidth = 100 - bidWidth;

    s.signalStrip.innerHTML =
      `<div class="${P}-signal-bar">` +
        `<div class="${P}-signal-fill ${P}-signal-bid" style="width:${bidWidth}%"></div>` +
        `<div class="${P}-signal-fill ${P}-signal-ask" style="width:${askWidth}%"></div>` +
      `</div>` +
      `<span class="${P}-signal-word" style="color:${sig.color}">${sig.signal}</span>` +
      `<span class="${P}-signal-pct" style="color:${ratio > 0.55 ? '#3fb950' : ratio < 0.45 ? '#f85149' : '#484f58'}">${sig.buyPct}%B</span>` +
      (sig.wallCount > 0 ? `<span class="${P}-signal-badge">${sig.wallCount}W</span>` : '') +
      (sig.spikeCount > 0 ? `<span class="${P}-signal-badge">${sig.spikeCount}\u{1F525}</span>` : '') +
      `<span class="${P}-signal-ratio" style="color:${cumRatio > 1.1 ? '#3fb950' : cumRatio < 0.9 ? '#f85149' : '#484f58'}">R:${cumRatio.toFixed(2)}</span>`;
  };

  // ═══════════════════════════════════════════
  // LAYER 4: Level Change Detection
  // ═══════════════════════════════════════════

  const detectLevelChanges = (bidRows, askRows, container, state) => {
    const prevLots = state.prevLots;
    const newLots = new Map();

    const allRows = [...(bidRows || []), ...(askRows || [])];

    for (const row of allRows) {
      if (!row.rowElement || !row.price) continue;
      const key = `${row.side}-${row.price}`;
      const currentLot = row.lot || 0;
      newLots.set(key, currentLot);

      const prevLot = prevLots.get(key);
      if (prevLot !== undefined && prevLot !== currentLot) {
        const el = row.rowElement;
        const diff = currentLot - prevLot;

        // Flash effect
        if (diff > 0) {
          // Lot increased — green flash
          el.style.transition = 'background 100ms ease-out';
          el.style.background = 'rgba(63,185,80,0.12)';
          setTimeout(() => { el.style.background = ''; }, 300);
        } else if (diff < 0) {
          // Lot decreased (order pulled) — red flash
          el.style.transition = 'background 100ms ease-out';
          el.style.background = 'rgba(248,81,73,0.12)';
          setTimeout(() => { el.style.background = ''; }, 300);
        }
      }
    }

    state.prevLots = newLots;
  };

  // ═══════════════════════════════════════════
  // Existing: Depth Bars, Lot Indicators, Freq
  // ═══════════════════════════════════════════

  const updateDepthBars = (rows, side, overlay, containerRect, state) => {
    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const rs = getRowState(state, row.rowElement);
      const pos = measureRow(row.rowElement, containerRect);

      let bar = rs.depthBar;
      if (!bar) {
        bar = document.createElement('div');
        bar.className = `${P}-depth-bar ${side === 'bid' ? P + '-bid' : P + '-ask'}`;
        overlay.appendChild(bar);
        rs.depthBar = bar;
      }

      const pct = row.depthPct || 0;
      const opacity = 0.08 + (row.heatAlpha || 0.15) * 0.6;

      if (side === 'bid') {
        bar.style.right = '0'; bar.style.left = 'auto';
        bar.style.width = `${pct * 0.4}%`;
      } else {
        bar.style.left = '0'; bar.style.right = 'auto';
        bar.style.width = `${pct * 0.4}%`;
      }
      bar.style.top = `${pos.top}px`;
      bar.style.height = `${pos.height}px`;
      bar.style.opacity = String(opacity);
    }
  };

  const updateLotIndicators = (rows, side, overlay, containerRect, state) => {
    const maxLot = Math.max(...rows.map(r => r.lot || 0));
    if (maxLot === 0) return;

    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const ratio = row.lot / maxLot;
      const rs = getRowState(state, row.rowElement);

      if (ratio < 0.6) {
        if (rs.lotBar) rs.lotBar.style.display = 'none';
        continue;
      }

      if (!rs.lotBar) {
        rs.lotBar = document.createElement('div');
        rs.lotBar.className = `${P}-lot-bar`;
        overlay.appendChild(rs.lotBar);
      }

      const pos = measureRow(row.rowElement, containerRect);
      const h = Math.round(ratio * pos.height);
      const color = side === 'bid' ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)';

      rs.lotBar.style.display = '';
      rs.lotBar.style.top = `${pos.top + pos.height - h}px`;
      rs.lotBar.style.height = `${h}px`;
      rs.lotBar.style.background = color;
      rs.lotBar.style.left = side === 'bid' ? '48%' : 'auto';
      rs.lotBar.style.right = side === 'bid' ? 'auto' : '48%';
    }
  };

  const updateFreqClasses = (bidRows, askRows) => {
    const allRows = [...(bidRows || []), ...(askRows || [])];
    const allFreqs = allRows.map(r => r.freq || 0).filter(f => f > 0);
    if (allFreqs.length === 0) return;
    const maxFreq = Math.max(...allFreqs);

    for (const row of allRows) {
      if (!row.rowElement) continue;
      const freqCellIdx = row.side === 'bid' ? 0 : 2;
      const freqCell = row.rowElement.children[freqCellIdx];
      if (!freqCell) continue;

      const ratio = maxFreq > 0 ? (row.freq || 0) / maxFreq : 0;
      const cls = row._isSpike ? `${P}-freq--spike`
        : ratio > 0.7 ? `${P}-freq--hot`
        : ratio > 0.3 ? `${P}-freq--warm`
        : `${P}-freq--cold`;

      if (!freqCell.classList.contains(cls)) {
        freqCell.classList.remove(`${P}-freq--cold`, `${P}-freq--warm`, `${P}-freq--hot`, `${P}-freq--spike`);
        freqCell.classList.add(cls);
      }
    }
  };

  const measureRow = (rowEl, containerRect) => {
    const r = rowEl.getBoundingClientRect();
    return {
      top: r.top - containerRect.top,
      height: r.height,
      left: r.left - containerRect.left,
      right: containerRect.right - r.right,
      width: r.width,
    };
  };

  const cleanupStaleRows = (state) => {
    for (const [rowEl, rs] of state.rows) {
      if (!document.contains(rowEl)) {
        for (const key of Object.keys(rs)) {
          if (rs[key] && rs[key].remove) rs[key].remove();
        }
        state.rows.delete(rowEl);
      }
    }
  };

  // ═══════════════════════════════════════════
  // Main Render
  // ═══════════════════════════════════════════

  const renderOverlay = (params) => {
    try {
      const {
        bidRows, askRows, imbalance, spread, cumRatio,
        walls, spikes, settings, container,
      } = params;

      if (!settings || !container) return;

      const state = getState(container);
      const overlay = ensureOverlay(container, state);
      const containerRect = container.getBoundingClientRect();

      cleanupStaleRows(state);

      // Layer 1: Row pressure borders
      updateRowPressure(bidRows, askRows);

      // Layer 2: Signal strip
      updateSignalStrip(imbalance, spread, cumRatio, walls, spikes, container, bidRows, askRows);

      // Layer 4: Level change detection
      detectLevelChanges(bidRows, askRows, container, state);

      // Depth bars + lot indicators
      if (settings.depthBarEnabled !== false) {
        updateDepthBars(bidRows, 'bid', overlay, containerRect, state);
        updateDepthBars(askRows, 'ask', overlay, containerRect, state);
      }
      updateLotIndicators(bidRows, 'bid', overlay, containerRect, state);
      updateLotIndicators(askRows, 'ask', overlay, containerRect, state);

      // Freq coloring
      updateFreqClasses(bidRows, askRows);
    } catch { /* silent */ }
  };

  // ═══════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════

  const clearOverlay = (container) => {
    if (!container) return;
    try {
      container.querySelectorAll(`.${P}-overlay, .${P}-signal-strip`).forEach(el => el.remove());
      container.querySelectorAll(`[class*="${P}-freq--"]`).forEach(el => {
        el.classList.remove(`${P}-freq--cold`, `${P}-freq--warm`, `${P}-freq--hot`, `${P}-freq--spike`);
      });
      // Remove row pressure borders
      const grid = container.querySelector('.grid.grid-cols-2');
      if (grid) {
        grid.querySelectorAll('tr').forEach(el => {
          el.style.borderLeft = '';
          el.style.background = '';
          el.style.transition = '';
        });
      }
      cState.delete(container);
    } catch { /* silent */ }
  };

  window.ObOverlay = { renderOverlay, clearOverlay };
})();
