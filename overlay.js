/**
 * overlay.js — Per-container visual rendering engine.
 * Uses reconciliation: create once, update in place. No destroy+recreate.
 * Eliminates flicker/glitch on every tick.
 */

/* global window, document */

(() => {
  'use strict';

  const P = 'ob-ext';

  // ─── Per-Container Cache ───
  // container -> { imbalancePanel, spreadBar, cumBar, cumBidSegs, cumAskSegs }
  const containerCache = new WeakMap();

  // ─── Per-Row Cache ───
  // rowElement -> { depthBar, tagWall, tagBig, tagSpike, lotIndicator }
  const rowCache = new WeakMap();

  const getCached = (row, key) => {
    let c = rowCache.get(row);
    if (!c) { c = {}; rowCache.set(row, c); }
    return c[key];
  };

  const setCached = (row, key, el) => {
    let c = rowCache.get(row);
    if (!c) { c = {}; rowCache.set(row, c); }
    c[key] = el;
  };

  // ─── Helpers ───

  const fmt = (num) => {
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(0) + 'K';
    return String(num);
  };

  const pctColor = (ratio, c1, c2) => ratio > 0.5 ? c1 : c2;

  // ─── Depth Bars (per-row, cached) ───

  const updateDepthBars = (rows, side) => {
    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const lotCell = row.rowElement.children[1];
      if (!lotCell) continue;

      lotCell.style.position = 'relative';
      lotCell.style.overflow = 'hidden';

      let bar = getCached(row.rowElement, 'depthBar');
      if (!bar || !lotCell.contains(bar)) {
        bar = document.createElement('div');
        bar.className = `${P}-depth-bar ${side === 'bid' ? P + '-bid' : P + '-ask'}`;
        lotCell.appendChild(bar);
        setCached(row.rowElement, 'depthBar', bar);
      }

      // Only update if values changed
      const w = `${row.depthPct || 0}%`;
      const o = String(row.heatAlpha || 0.15);
      if (bar.style.width !== w) bar.style.width = w;
      if (bar.style.opacity !== o) bar.style.opacity = o;
    }
  };

  // ─── Lot Indicators (per-row, cached) ───

  const updateLotIndicators = (rows, side) => {
    const maxLot = Math.max(...rows.map(r => r.lot || 0));
    if (maxLot === 0) return;

    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const ratio = row.lot / maxLot;

      if (ratio < 0.6) {
        // Remove indicator if it exists and ratio dropped
        const existing = getCached(row.rowElement, 'lotIndicator');
        if (existing) { existing.remove(); setCached(row.rowElement, 'lotIndicator', null); }
        continue;
      }

      const priceCellIdx = side === 'bid' ? 2 : 0;
      const priceCell = row.rowElement.children[priceCellIdx];
      if (!priceCell) continue;

      let ind = getCached(row.rowElement, 'lotIndicator');
      if (!ind || !priceCell.contains(ind)) {
        ind = document.createElement('div');
        ind.className = `${P}-lot-indicator`;
        priceCell.style.position = 'relative';
        priceCell.appendChild(ind);
        setCached(row.rowElement, 'lotIndicator', ind);
      }

      const h = Math.round(ratio * 16);
      const bg = side === 'bid' ? 'rgba(74,222,128,0.6)' : 'rgba(248,113,113,0.6)';
      const pos = side === 'bid' ? 'right' : 'left';
      ind.style.cssText =
        `position:absolute;top:${16 - h}px;${pos}:1px;width:2px;height:${h}px;` +
        `background:${bg};border-radius:1px;pointer-events:none;z-index:2;`;
    }
  };

  // ─── Tags (per-row, cached) ───

  const ensureTag = (row, key, className, text) => {
    let tag = getCached(row, key);
    const parent = row.children[row.side === 'bid' ? 2 : 0] || row.children[2];
    if (!parent) return;

    if (!tag || !parent.contains(tag)) {
      tag = document.createElement('span');
      tag.className = className;
      parent.appendChild(tag);
      setCached(row, key, tag);
    }
    if (tag.textContent !== text) tag.textContent = text;
    return tag;
  };

  const removeTag = (row, key) => {
    const tag = getCached(row, key);
    if (tag) { tag.remove(); setCached(row, key, null); }
  };

  const updateTags = (walls, spikes, settings) => {
    // Track which rows currently have tags (for cleanup)
    const wallRows = new Set();
    const spikeRows = new Set();

    for (const w of walls) {
      if (!w.rowElement) continue;
      wallRows.add(w.rowElement);
      w.rowElement.side = w.side; // stash for ensureTag
      ensureTag(w.rowElement, 'tagWall', `${P}-tag ${P}-tag--wall`, 'WALL');

      if (w.lot >= (settings.bigLotThreshold || 500000)) {
        ensureTag(w.rowElement, 'tagBig', `${P}-tag ${P}-tag--big`, 'BIG');
      } else {
        removeTag(w.rowElement, 'tagBig');
      }
    }

    for (const s of spikes) {
      if (!s.rowElement) continue;
      spikeRows.add(s.rowElement);
      s.rowElement.side = s.side;
      ensureTag(s.rowElement, 'tagSpike', `${P}-tag ${P}-tag--hot`, '\uD83D\uDD25');
    }

    // Note: stale tag cleanup is handled implicitly — when the OB data changes,
    // old rowElements are gone, so cached tags are orphaned harmlessly.
  };

  // ─── Row Highlighting ───

  const updateRowHighlights = (walls, spikes) => {
    // We don't need to remove old classes — if the row is still in the DOM,
    // it'll get updated next tick. If it's gone, the class is gone too.
    for (const w of walls) {
      if (w.rowElement) w.rowElement.classList.add(`${P}-row--wall`);
    }
    for (const s of spikes) {
      if (s.rowElement) s.rowElement.classList.add(`${P}-row--spike`);
    }
  };

  // ─── Freq Coloring ───

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

      // Only update class if changed
      const cold = `${P}-freq--cold`, warm = `${P}-freq--warm`,
            hot = `${P}-freq--hot`, spike = `${P}-freq--spike`;

      if (!freqCell.classList.contains(cls)) {
        freqCell.classList.remove(cold, warm, hot, spike);
        freqCell.classList.add(cls);
      }
    }
  };

  // ─── Cumulative Depth Bar (container-level, cached) ───

  const updateCumDepthBars = (bidRows, askRows, container) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let cache = containerCache.get(container);
    if (!cache) { cache = {}; containerCache.set(container, cache); }

    const maxBidLot = Math.max(...bidRows.map(r => r.lot || 0));
    const maxAskLot = Math.max(...askRows.map(r => r.lot || 0));
    const maxLot = Math.max(maxBidLot, maxAskLot);
    if (maxLot === 0) return;

    if (!cache.cumBar || !grid.contains(cache.cumBar)) {
      const bar = document.createElement('div');
      bar.className = `${P}-cum-bar`;
      bar.style.cssText = 'display:flex;height:4px;gap:1px;margin:0 8px 4px 8px;pointer-events:none;';

      const bidSide = document.createElement('div');
      bidSide.style.cssText = 'flex:1;display:flex;justify-content:flex-end;gap:1px;';
      const askSide = document.createElement('div');
      askSide.style.cssText = 'flex:1;display:flex;gap:1px;';

      bar.appendChild(bidSide);
      bar.appendChild(askSide);
      grid.insertBefore(bar, grid.firstChild);

      cache.cumBar = bar;
      cache.cumBidSegs = [];
      cache.cumAskSegs = [];
    }

    // Rebuild segments if count changed
    const bidSide = cache.cumBar.children[0];
    const askSide = cache.cumBar.children[1];
    const nBid = Math.min(bidRows.length, 10);
    const nAsk = Math.min(askRows.length, 10);

    if (cache.cumBidSegs.length !== nBid) {
      bidSide.innerHTML = '';
      cache.cumBidSegs = [];
      for (let i = 0; i < nBid; i++) {
        const seg = document.createElement('div');
        seg.style.cssText = 'height:3px;border-radius:1px;';
        bidSide.appendChild(seg);
        cache.cumBidSegs.push(seg);
      }
    }
    if (cache.cumAskSegs.length !== nAsk) {
      askSide.innerHTML = '';
      cache.cumAskSegs = [];
      for (let i = 0; i < nAsk; i++) {
        const seg = document.createElement('div');
        seg.style.cssText = 'height:3px;border-radius:1px;';
        askSide.appendChild(seg);
        cache.cumAskSegs.push(seg);
      }
    }

    // Update segment widths/opacities
    for (let i = 0; i < cache.cumBidSegs.length; i++) {
      const pct = (bidRows[i].lot / maxLot) * 100;
      const a = 0.15 + (bidRows[i].lot / maxLot) * 0.4;
      const seg = cache.cumBidSegs[i];
      const w = `${Math.max(pct * 0.8, 2)}%`;
      if (seg.style.width !== w) seg.style.width = w;
      const bg = `rgba(74,222,128,${a.toFixed(2)})`;
      if (seg.style.background !== bg) seg.style.background = bg;
    }
    for (let i = 0; i < cache.cumAskSegs.length; i++) {
      const pct = (askRows[i].lot / maxLot) * 100;
      const a = 0.15 + (askRows[i].lot / maxLot) * 0.4;
      const seg = cache.cumAskSegs[i];
      const w = `${Math.max(pct * 0.8, 2)}%`;
      if (seg.style.width !== w) seg.style.width = w;
      const bg = `rgba(248,113,113,${a.toFixed(2)})`;
      if (seg.style.background !== bg) seg.style.background = bg;
    }
  };

  // ─── Imbalance Panel (container-level, cached) ───

  const updateImbalancePanel = (imbalance, container) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let cache = containerCache.get(container);
    if (!cache) { cache = {}; containerCache.set(container, cache); }

    if (!cache.imbalancePanel || !container.contains(cache.imbalancePanel)) {
      const panel = document.createElement('div');
      panel.className = `${P}-imbalance-panel`;

      // Lot meter
      const lotRow = buildMeterRow('LOT');
      // Freq meter
      const freqRow = buildMeterRow('FREQ');
      // Totals
      const totalsRow = document.createElement('div');
      totalsRow.className = `${P}-meter-row`;
      totalsRow.style.cssText = 'font-size:9px;color:#484f58;gap:6px;padding-top:2px;border-top:1px solid #21262d;margin-top:2px;';

      panel.appendChild(lotRow);
      panel.appendChild(freqRow);
      panel.appendChild(totalsRow);

      grid.parentElement.insertBefore(panel, grid);

      cache.imbalancePanel = panel;
      cache.lotRow = lotRow;
      cache.freqRow = freqRow;
      cache.totalsRow = totalsRow;
    }

    // Update lot meter
    updateMeterRow(cache.lotRow, imbalance.lotRatio, '#4ade80', '#f87171');
    // Update freq meter
    updateMeterRow(cache.freqRow, imbalance.freqRatio, '#60a5fa', '#c084fc');
    // Update totals
    cache.totalsRow.innerHTML =
      `<span>B: ${fmt(imbalance.bidLotTotal)}</span>` +
      `<span style="flex:1;text-align:center;color:#30363d">\u00B7</span>` +
      `<span>A: ${fmt(imbalance.askLotTotal)}</span>`;
  };

  const buildMeterRow = (label) => {
    const row = document.createElement('div');
    row.className = `${P}-meter-row`;

    const labelEl = document.createElement('span');
    labelEl.className = `${P}-meter-label`;
    labelEl.textContent = label;

    const leftVal = document.createElement('span');
    leftVal.className = `${P}-meter-value`;

    const barContainer = document.createElement('div');
    barContainer.className = `${P}-meter-bar`;

    const leftBar = document.createElement('div');
    leftBar.className = `${P}-meter-fill`;
    const rightBar = document.createElement('div');
    rightBar.className = `${P}-meter-fill`;

    barContainer.appendChild(leftBar);
    barContainer.appendChild(rightBar);

    const rightVal = document.createElement('span');
    rightVal.className = `${P}-meter-value`;

    row.appendChild(labelEl);
    row.appendChild(leftVal);
    row.appendChild(barContainer);
    row.appendChild(rightVal);

    return row;
  };

  const updateMeterRow = (row, ratio, leftColor, rightColor) => {
    const leftVal = row.children[1];
    const barContainer = row.children[2];
    const leftBar = barContainer.children[0];
    const rightBar = barContainer.children[1];
    const rightVal = row.children[3];

    const lpct = `${(ratio * 100).toFixed(0)}%`;
    const rpct = `${((1 - ratio) * 100).toFixed(0)}%`;

    if (leftVal.textContent !== lpct) leftVal.textContent = lpct;
    if (rightVal.textContent !== rpct) rightVal.textContent = rpct;
    leftVal.style.color = leftColor;
    rightVal.style.color = rightColor;

    const lw = `${ratio * 100}%`;
    const rw = `${(1 - ratio) * 100}%`;
    if (leftBar.style.width !== lw) leftBar.style.width = lw;
    if (rightBar.style.width !== rw) rightBar.style.width = rw;
    leftBar.style.background = leftColor;
    rightBar.style.background = rightColor;
  };

  // ─── Spread Bar (container-level, cached) ───

  const updateSpreadBar = (spread, cumRatio, levels, container) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    let cache = containerCache.get(container);
    if (!cache) { cache = {}; containerCache.set(container, cache); }

    if (!cache.spreadBar || !container.contains(cache.spreadBar)) {
      const bar = document.createElement('div');
      bar.className = `${P}-spread-bar`;

      const totalRow = container.querySelector('[class*="absolute bottom-12"]');
      if (totalRow) {
        totalRow.parentElement.insertBefore(bar, totalRow);
      } else {
        grid.parentElement.insertBefore(bar, grid.nextSibling);
      }
      cache.spreadBar = bar;
    }

    const ratioColor = cumRatio > 1.1 ? '#4ade80' : cumRatio < 0.9 ? '#f87171' : '#484f58';
    cache.spreadBar.innerHTML =
      `<span>Spread <b>${spread.ticks} pt</b> (${spread.pct}%)</span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>Ratio <b style="color:${ratioColor}">${cumRatio.toFixed(2)}</b></span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>L${levels}</span>`;
  };

  // ─── Main Render (reconciliation — no destroy) ───

  const renderOverlay = (params) => {
    try {
      const {
        bidRows, askRows, imbalance, spread, cumRatio,
        walls, spikes, settings, container,
      } = params;

      if (!settings || !container) return;

      // Clean old row highlights (quick — just class removal)
      const grid = container.querySelector('.grid.grid-cols-2');
      if (grid) {
        grid.querySelectorAll(`.${P}-row--wall, .${P}-row--spike`).forEach(el => {
          el.classList.remove(`${P}-row--wall`, `${P}-row--spike`);
        });
      }

      // Per-row updates
      if (settings.depthBarEnabled !== false) {
        updateDepthBars(bidRows, 'bid');
        updateDepthBars(askRows, 'ask');
      }

      updateLotIndicators(bidRows, 'bid');
      updateLotIndicators(askRows, 'ask');
      updateTags(walls, spikes, settings);
      updateRowHighlights(walls, spikes);
      updateFreqClasses(bidRows, askRows);

      // Container-level updates (cached — no flicker)
      updateCumDepthBars(bidRows, askRows, container);

      if (settings.imbalanceEnabled !== false) {
        updateImbalancePanel(imbalance, container);
      }

      if (settings.spreadBarEnabled !== false) {
        updateSpreadBar(spread, cumRatio, settings.levels || 10, container);
      }
    } catch { /* silent */ }
  };

  // ─── Clear (only needed on container removal) ───

  const clearOverlay = (container) => {
    if (!container) return;
    try {
      container.querySelectorAll(`[${P}-cid]`).forEach(el => el.remove());
      container.querySelectorAll(`.${P}-depth-bar, .${P}-cum-bar, .${P}-lot-indicator, .${P}-tag`).forEach(el => el.remove());
      container.querySelectorAll(`[class*="${P}-freq--"]`).forEach(el => {
        el.classList.remove(`${P}-freq--cold`, `${P}-freq--warm`, `${P}-freq--hot`, `${P}-freq--spike`);
      });
      container.querySelectorAll(`[class*="${P}-row--"]`).forEach(el => {
        el.classList.remove(`${P}-row--wall`, `${P}-row--spike`);
      });
    } catch { /* silent */ }
  };

  window.ObOverlay = { renderOverlay, clearOverlay };
})();
