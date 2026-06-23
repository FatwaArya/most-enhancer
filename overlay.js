/**
 * overlay.js — Zero-injection overlay renderer.
 * NEVER modifies the original DOM (no appending to cells, no inline styles on rows).
 * All overlays are absolutely positioned in a single overlay div on top of the grid.
 * Layout: [ask depth ←] [price ladder] [→ bid depth]
 */

/* global window, document, requestAnimationFrame */

(() => {
  'use strict';

  const P = 'ob-ext';

  // ─── Per-Container State ───
  // container -> { overlay, rows: Map<rowEl, {depthBar, tagWall, tagBig, tagSpike, lotBar}>,
  //                imbalancePanel, spreadBar, cumBar, cumBidSegs, cumAskSegs, measureTick }
  const cState = new WeakMap();

  const getState = (container) => {
    let s = cState.get(container);
    if (!s) {
      s = { overlay: null, rows: new Map(), measureTick: 0 };
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

  // ─── Overlay Container ───

  const ensureOverlay = (container, state) => {
    if (state.overlay && container.contains(state.overlay)) return state.overlay;

    // Remove any stale overlays
    container.querySelectorAll(`.${P}-overlay`).forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = `${P}-overlay`;
    container.style.position = container.style.position || 'relative';
    container.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  };

  // ─── Row Position Measurement ───
  // Returns {top, height} relative to container for a given row element.

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

  // ─── Depth Bars (positioned in overlay, not in cells) ───

  const updateDepthBars = (rows, side, overlay, containerRect, state) => {
    const overlayRect = overlay.getBoundingClientRect();

    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;

      const rs = getRowState(state, row.rowElement);
      const pos = measureRow(row.rowElement, containerRect);

      // Bid bars extend from right edge of overlay inward
      // Ask bars extend from left edge of overlay inward
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
        bar.style.right = '0';
        bar.style.left = 'auto';
        bar.style.width = `${pct * 0.4}%`; // max 40% of overlay width
      } else {
        bar.style.left = '0';
        bar.style.right = 'auto';
        bar.style.width = `${pct * 0.4}%`;
      }
      bar.style.top = `${pos.top}px`;
      bar.style.height = `${pos.height}px`;
      bar.style.opacity = String(opacity);
    }
  };

  // ─── Lot Size Indicators (thin bar at edge of price cell) ───

  const updateLotIndicators = (rows, side, overlay, containerRect, state) => {
    const maxLot = Math.max(...rows.map(r => r.lot || 0));
    if (maxLot === 0) return;

    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const ratio = row.lot / maxLot;
      const rs = getRowState(state, row.rowElement);

      if (ratio < 0.6) {
        if (rs.lotBar) { rs.lotBar.style.display = 'none'; }
        continue;
      }

      if (!rs.lotBar) {
        rs.lotBar = document.createElement('div');
        rs.lotBar.className = `${P}-lot-bar`;
        overlay.appendChild(rs.lotBar);
      }

      const pos = measureRow(row.rowElement, containerRect);
      const h = Math.round(ratio * pos.height);
      const color = side === 'bid' ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)';

      rs.lotBar.style.display = '';
      rs.lotBar.style.top = `${pos.top + pos.height - h}px`;
      rs.lotBar.style.height = `${h}px`;
      rs.lotBar.style.background = color;

      if (side === 'bid') {
        // Right edge of the ask table (left side of grid)
        rs.lotBar.style.left = '48%';
      } else {
        // Left edge of the bid table (right side of grid)
        rs.lotBar.style.right = '48%';
      }
    }
  };

  // ─── Tags (freq spikes only — positioned at grid edges, not over data) ───

  const updateTags = (spikes, overlay, containerRect, state) => {
    const activeRows = new Set(spikes.map(s => s.rowElement));

    // Hide all tags first
    for (const [, rs] of state.rows) {
      if (rs.tagSpike) rs.tagSpike.style.display = 'none';
    }

    for (const s of spikes) {
      if (!s.rowElement) continue;
      const rs = getRowState(state, s.rowElement);
      const pos = measureRow(s.rowElement, containerRect);

      if (!rs.tagSpike) {
        rs.tagSpike = document.createElement('span');
        rs.tagSpike.className = `${P}-tag ${P}-tag--hot`;
        rs.tagSpike.textContent = '\uD83D\uDD25';
        overlay.appendChild(rs.tagSpike);
      }

      // Position at the outer edge so it doesn't cover price data
      rs.tagSpike.style.display = '';
      rs.tagSpike.style.top = `${pos.top + 1}px`;
      if (s.side === 'bid') {
        rs.tagSpike.style.left = `${pos.left - 18}px`;  // left of bid table
      } else {
        rs.tagSpike.style.left = `${pos.left + pos.width + 4}px`; // right of ask table
      }
    }
  };

  // ─── Row Highlighting (CSS class on original rows — safe, no layout impact) ───

  const updateRowHighlights = (container, walls, spikes) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;
    grid.querySelectorAll(`.${P}-row--wall, .${P}-row--spike`).forEach(el => {
      el.classList.remove(`${P}-row--wall`, `${P}-row--spike`);
    });
    for (const w of walls) {
      if (w.rowElement) w.rowElement.classList.add(`${P}-row--wall`);
    }
    for (const s of spikes) {
      if (s.rowElement) s.rowElement.classList.add(`${P}-row--spike`);
    }
  };

  // ─── Freq Coloring (CSS class on original cells — safe) ───

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

      const freq = row.freq || 0;
      const ratio = maxFreq > 0 ? freq / maxFreq : 0;
      const cls = row._isSpike ? `${P}-freq--spike`
        : ratio > 0.7 ? `${P}-freq--hot`
        : ratio > 0.3 ? `${P}-freq--warm`
        : `${P}-freq--cold`;

      const cold = `${P}-freq--cold`, warm = `${P}-freq--warm`,
            hot = `${P}-freq--hot`, spike = `${P}-freq--spike`;
      if (!freqCell.classList.contains(cls)) {
        freqCell.classList.remove(cold, warm, hot, spike);
        freqCell.classList.add(cls);
      }
    }
  };

  // ─── Imbalance Panel (container-level, cached) ───

  const updateImbalancePanel = (imbalance, container) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let s = cState.get(container);
    if (!s) { s = {}; cState.set(container, s); }

    if (!s.imbalancePanel || !container.contains(s.imbalancePanel)) {
      const panel = document.createElement('div');
      panel.className = `${P}-imbalance-panel`;

      const lotRow = buildMeterRow('LOT');
      const freqRow = buildMeterRow('FREQ');
      const totalsRow = document.createElement('div');
      totalsRow.className = `${P}-meter-row`;
      totalsRow.style.cssText = 'font-size:9px;color:#484f58;gap:6px;padding-top:3px;border-top:1px solid #21262d;margin-top:2px;';

      panel.appendChild(lotRow);
      panel.appendChild(freqRow);
      panel.appendChild(totalsRow);
      grid.parentElement.insertBefore(panel, grid);

      s.imbalancePanel = panel;
      s.lotRow = lotRow;
      s.freqRow = freqRow;
      s.totalsRow = totalsRow;
    }

    updateMeterRow(s.lotRow, imbalance.lotRatio, '#3fb950', '#f85149');
    updateMeterRow(s.freqRow, imbalance.freqRatio, '#58a6ff', '#a371f7');
    s.totalsRow.innerHTML =
      `<span>B: ${fmt(imbalance.bidLotTotal)}</span>` +
      `<span style="flex:1;text-align:center;color:#30363d">\u00B7</span>` +
      `<span>A: ${fmt(imbalance.askLotTotal)}</span>`;
  };

  const buildMeterRow = (label) => {
    const row = document.createElement('div');
    row.className = `${P}-meter-row`;
    const l = document.createElement('span');
    l.className = `${P}-meter-label`; l.textContent = label;
    const lv = document.createElement('span'); lv.className = `${P}-meter-value`;
    const bar = document.createElement('div'); bar.className = `${P}-meter-bar`;
    const lb = document.createElement('div'); lb.className = `${P}-meter-fill`;
    const rb = document.createElement('div'); rb.className = `${P}-meter-fill`;
    bar.appendChild(lb); bar.appendChild(rb);
    const rv = document.createElement('span'); rv.className = `${P}-meter-value`;
    row.appendChild(l); row.appendChild(lv); row.appendChild(bar); row.appendChild(rv);
    return row;
  };

  const updateMeterRow = (row, ratio, lc, rc) => {
    const lv = row.children[1], bar = row.children[2],
          lb = bar.children[0], rb = bar.children[1], rv = row.children[3];
    const lp = `${(ratio * 100).toFixed(0)}%`;
    const rp = `${((1 - ratio) * 100).toFixed(0)}%`;
    if (lv.textContent !== lp) lv.textContent = lp;
    if (rv.textContent !== rp) rv.textContent = rp;
    lv.style.color = lc; rv.style.color = rc;
    const lw = `${ratio * 100}%`, rw = `${(1 - ratio) * 100}%`;
    if (lb.style.width !== lw) lb.style.width = lw;
    if (rb.style.width !== rw) rb.style.width = rw;
    lb.style.background = lc; rb.style.background = rc;
  };

  // ─── Spread Bar (container-level, cached) ───

  const updateSpreadBar = (spread, cumRatio, levels, container) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let s = cState.get(container);
    if (!s) { s = {}; cState.set(container, s); }

    if (!s.spreadBar || !container.contains(s.spreadBar)) {
      const bar = document.createElement('div');
      bar.className = `${P}-spread-bar`;
      grid.parentElement.insertBefore(bar, grid.nextSibling);
      s.spreadBar = bar;
    }

    const rc = cumRatio > 1.1 ? '#3fb950' : cumRatio < 0.9 ? '#f85149' : '#484f58';
    s.spreadBar.innerHTML =
      `<span>Spread <b>${spread.ticks} pt</b> (${spread.pct}%)</span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>Ratio <b style="color:${rc}">${cumRatio.toFixed(2)}</b></span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>L${levels}</span>`;
  };

  // ─── Stale Row Cleanup ───

  const cleanupStaleRows = (state) => {
    for (const [rowEl, rs] of state.rows) {
      if (!document.contains(rowEl)) {
        // Row removed from DOM — remove its overlay elements
        for (const key of Object.keys(rs)) {
          if (rs[key] && rs[key].remove) rs[key].remove();
        }
        state.rows.delete(rowEl);
      }
    }
  };

  // ─── Main Render ───

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

      // Clean up orphaned row elements
      cleanupStaleRows(state);

      // Row highlights + freq classes (safe — only CSS classes on original rows)
      updateRowHighlights(container, walls, spikes);
      updateFreqClasses(bidRows, askRows);

      // Per-row overlays (depth bars, lot indicators, tags — all in overlay div)
      if (settings.depthBarEnabled !== false) {
        updateDepthBars(bidRows, 'bid', overlay, containerRect, state);
        updateDepthBars(askRows, 'ask', overlay, containerRect, state);
      }

      updateLotIndicators(bidRows, 'bid', overlay, containerRect, state);
      updateLotIndicators(askRows, 'ask', overlay, containerRect, state);
      updateTags(spikes, overlay, containerRect, state);

      // Container-level overlays
      if (settings.imbalanceEnabled !== false) {
        updateImbalancePanel(imbalance, container);
      }
      if (settings.spreadBarEnabled !== false) {
        updateSpreadBar(spread, cumRatio, settings.levels || 10, container);
      }
    } catch { /* silent */ }
  };

  // ─── Cleanup ───

  const clearOverlay = (container) => {
    if (!container) return;
    try {
      container.querySelectorAll(`.${P}-overlay`).forEach(el => el.remove());
      container.querySelectorAll(`[class*="${P}-freq--"]`).forEach(el => {
        el.classList.remove(`${P}-freq--cold`, `${P}-freq--warm`, `${P}-freq--hot`, `${P}-freq--spike`);
      });
      container.querySelectorAll(`[class*="${P}-row--"]`).forEach(el => {
        el.classList.remove(`${P}-row--wall`, `${P}-row--spike`);
      });
      cState.delete(container);
    } catch { /* silent */ }
  };

  window.ObOverlay = { renderOverlay, clearOverlay };
})();
