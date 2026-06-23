/**
 * overlay.js — Per-container visual rendering engine.
 * All DOM operations scoped to the target container via data-ob-cid.
 * Loaded third via manifest.json. Exposes window.ObOverlay.
 */

/* global window, document */

(() => {
  'use strict';

  const PREFIX = 'ob-ext';
  let containerCounter = 0;
  const containerIds = new WeakMap();

  const getCid = (container) => {
    let cid = containerIds.get(container);
    if (!cid) {
      cid = `${PREFIX}-c${++containerCounter}`;
      containerIds.set(container, cid);
      container.setAttribute('data-ob-cid', cid);
    }
    return cid;
  };

  const qs = (container, sel) => container.querySelectorAll(sel);

  // ─── Per-Container Cleanup ───

  const clearOverlay = (container) => {
    if (!container) return;
    try {
      const cid = getCid(container);
      const selector = `[data-ob-cid="${cid}"]`;
      qs(container, selector).forEach(el => {
        if (el.hasAttribute('data-ob-cid') && el.getAttribute('data-ob-cid') === cid) {
          // Only remove overlay elements, not the container itself
          if (el !== container) el.remove();
        }
      });

      // Clean classes within this container
      qs(container, `[class*="${PREFIX}-freq--"]`).forEach(el => {
        el.classList.remove(
          `${PREFIX}-freq--cold`, `${PREFIX}-freq--warm`,
          `${PREFIX}-freq--hot`, `${PREFIX}-freq--spike`
        );
      });
      qs(container, `[class*="${PREFIX}-row--"]`).forEach(el => {
        el.classList.remove(
          `${PREFIX}-row--wall`, `${PREFIX}-row--spike`,
          `${PREFIX}-row--hot`
        );
      });
    } catch { /* silent */ }
  };

  // ─── Overlay Element Factory ───

  const createOverlayEl = (tag, className, cid) => {
    const el = document.createElement(tag);
    el.className = className;
    el.setAttribute('data-ob-cid', cid);
    return el;
  };

  // ─── Main Render ───

  const renderOverlay = (params) => {
    try {
      const {
        bidRows, askRows, imbalance, spread, cumRatio,
        walls, spikes, settings, container,
      } = params;

      if (!settings || !container) return;
      const cid = getCid(container);

      // Clear only this container's overlays
      clearOverlay(container);

      if (settings.depthBarEnabled !== false) {
        renderDepthBars(bidRows, 'bid', cid);
        renderDepthBars(askRows, 'ask', cid);
      }

      renderLotIndicators(bidRows, 'bid', cid);
      renderLotIndicators(askRows, 'ask', cid);

      renderTags(walls, spikes, settings, cid);
      highlightRows(walls, spikes, cid);
      applyFreqClasses(bidRows, askRows, cid);

      // Container-level overlays (imbalance, spread, cum bars)
      renderCumDepthBars(bidRows, askRows, container, cid);

      if (settings.imbalanceEnabled !== false) {
        renderImbalancePanel(imbalance, container, cid);
      }

      if (settings.spreadBarEnabled !== false) {
        renderSpreadBar(spread, cumRatio, settings.levels || 10, container, cid);
      }
    } catch { /* silent */ }
  };

  // ─── Depth Bars ───

  const renderDepthBars = (rows, side, cid) => {
    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const lotCell = row.rowElement.children[1];
      if (!lotCell) continue;

      lotCell.style.position = 'relative';
      lotCell.style.overflow = 'hidden';

      const bar = createOverlayEl('div',
        `${PREFIX}-depth-bar ${side === 'bid' ? PREFIX + '-bid' : PREFIX + '-ask'}`,
        cid
      );
      bar.style.width = `${row.depthPct || 0}%`;
      bar.style.opacity = String(row.heatAlpha || 0.15);
      lotCell.appendChild(bar);
    }
  };

  // ─── Lot Size Indicators ───

  const renderLotIndicators = (rows, side, cid) => {
    const maxLot = Math.max(...rows.map(r => r.lot || 0));
    if (maxLot === 0) return;

    for (const row of rows) {
      if (!row.rowElement || !row.lot) continue;
      const ratio = row.lot / maxLot;
      if (ratio < 0.6) continue;

      const priceCellIdx = side === 'bid' ? 2 : 0;
      const priceCell = row.rowElement.children[priceCellIdx];
      if (!priceCell) continue;

      const indicator = createOverlayEl('div', `${PREFIX}-lot-indicator`, cid);
      const barHeight = Math.round(ratio * 16);
      indicator.style.cssText =
        `position:absolute;top:${16 - barHeight}px;` +
        `${side === 'bid' ? 'right' : 'left'}:1px;` +
        `width:2px;height:${barHeight}px;` +
        `background:${side === 'bid' ? 'rgba(74,222,128,0.6)' : 'rgba(248,113,113,0.6)'};` +
        `border-radius:1px;pointer-events:none;z-index:2;`;

      priceCell.style.position = 'relative';
      priceCell.appendChild(indicator);
    }
  };

  // ─── Tags ───

  const renderTags = (walls, spikes, settings, cid) => {
    for (const w of walls) {
      if (!w.rowElement) continue;
      const priceCellIdx = w.side === 'bid' ? 2 : 0;
      const priceCell = w.rowElement.children[priceCellIdx];
      if (!priceCell) continue;

      const tag = createOverlayEl('span', `${PREFIX}-tag ${PREFIX}-tag--wall`, cid);
      tag.textContent = 'WALL';
      priceCell.appendChild(tag);

      if (w.lot >= (settings.bigLotThreshold || 500000)) {
        const bigTag = createOverlayEl('span', `${PREFIX}-tag ${PREFIX}-tag--big`, cid);
        bigTag.textContent = 'BIG';
        priceCell.appendChild(bigTag);
      }
    }

    for (const s of spikes) {
      if (!s.rowElement) continue;
      const freqCellIdx = s.side === 'bid' ? 0 : 2;
      const freqCell = s.rowElement.children[freqCellIdx];
      if (!freqCell) continue;

      const tag = createOverlayEl('span', `${PREFIX}-tag ${PREFIX}-tag--hot`, cid);
      tag.textContent = '\uD83D\uDD25';
      freqCell.appendChild(tag);
    }
  };

  // ─── Row Highlighting ───

  const highlightRows = (walls, spikes, cid) => {
    for (const w of walls) {
      if (!w.rowElement) continue;
      w.rowElement.classList.add(`${PREFIX}-row--wall`);
    }
    for (const s of spikes) {
      if (!s.rowElement) continue;
      s.rowElement.classList.add(`${PREFIX}-row--spike`);
    }
  };

  // ─── Freq Coloring ───

  const applyFreqClasses = (bidRows, askRows, cid) => {
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

      freqCell.classList.remove(
        `${PREFIX}-freq--cold`, `${PREFIX}-freq--warm`,
        `${PREFIX}-freq--hot`, `${PREFIX}-freq--spike`
      );

      if (row._isSpike) {
        freqCell.classList.add(`${PREFIX}-freq--spike`);
      } else if (ratio > 0.7) {
        freqCell.classList.add(`${PREFIX}-freq--hot`);
      } else if (ratio > 0.3) {
        freqCell.classList.add(`${PREFIX}-freq--warm`);
      } else {
        freqCell.classList.add(`${PREFIX}-freq--cold`);
      }
    }
  };

  // ─── Cumulative Depth Bars ───

  const renderCumDepthBars = (bidRows, askRows, container, cid) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    const maxBidLot = Math.max(...bidRows.map(r => r.lot || 0));
    const maxAskLot = Math.max(...askRows.map(r => r.lot || 0));
    const maxLot = Math.max(maxBidLot, maxAskLot);
    if (maxLot === 0) return;

    const cumBar = createOverlayEl('div', `${PREFIX}-cum-bar`, cid);
    cumBar.style.cssText =
      'display:flex;height:4px;gap:1px;margin:0 8px 4px 8px;pointer-events:none;';

    const bidSide = document.createElement('div');
    bidSide.style.cssText = 'flex:1;display:flex;justify-content:flex-end;gap:1px;';
    for (let i = 0; i < Math.min(bidRows.length, 10); i++) {
      const seg = document.createElement('div');
      const pct = (bidRows[i].lot / maxLot) * 100;
      seg.style.cssText =
        `height:3px;width:${Math.max(pct * 0.8, 2)}%;` +
        `background:rgba(74,222,128,${0.15 + (bidRows[i].lot / maxLot) * 0.4});` +
        `border-radius:1px;`;
      bidSide.appendChild(seg);
    }

    const askSide = document.createElement('div');
    askSide.style.cssText = 'flex:1;display:flex;gap:1px;';
    for (let i = 0; i < Math.min(askRows.length, 10); i++) {
      const seg = document.createElement('div');
      const pct = (askRows[i].lot / maxLot) * 100;
      seg.style.cssText =
        `height:3px;width:${Math.max(pct * 0.8, 2)}%;` +
        `background:rgba(248,113,113,${0.15 + (askRows[i].lot / maxLot) * 0.4});` +
        `border-radius:1px;`;
      askSide.appendChild(seg);
    }

    cumBar.appendChild(bidSide);
    cumBar.appendChild(askSide);
    grid.insertBefore(cumBar, grid.firstChild);
  };

  // ─── Imbalance Panel ───

  const renderImbalancePanel = (imbalance, container, cid) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    const panel = createOverlayEl('div', `${PREFIX}-imbalance-panel`, cid);

    const lotRow = createMeterRow(
      'LOT', imbalance.lotRatio,
      `${(imbalance.lotRatio * 100).toFixed(0)}%`,
      `${((1 - imbalance.lotRatio) * 100).toFixed(0)}%`,
      '#4ade80', '#f87171', cid
    );

    const freqRow = createMeterRow(
      'FREQ', imbalance.freqRatio,
      `${(imbalance.freqRatio * 100).toFixed(0)}%`,
      `${((1 - imbalance.freqRatio) * 100).toFixed(0)}%`,
      '#60a5fa', '#c084fc', cid
    );

    const totalsRow = createOverlayEl('div', `${PREFIX}-meter-row`, cid);
    totalsRow.style.cssText = 'font-size:9px;color:#484f58;gap:4px;';
    totalsRow.innerHTML =
      `<span>B: ${formatNum(imbalance.bidLotTotal)}</span>` +
      `<span style="flex:1;text-align:center">|</span>` +
      `<span>A: ${formatNum(imbalance.askLotTotal)}</span>`;

    panel.appendChild(lotRow);
    panel.appendChild(freqRow);
    panel.appendChild(totalsRow);

    grid.parentElement.insertBefore(panel, grid);
  };

  const createMeterRow = (label, ratio, leftLabel, rightLabel, leftColor, rightColor, cid) => {
    const row = createOverlayEl('div', `${PREFIX}-meter-row`, cid);

    const labelEl = createOverlayEl('span', `${PREFIX}-meter-label`, cid);
    labelEl.textContent = label;

    const leftVal = createOverlayEl('span', `${PREFIX}-meter-value`, cid);
    leftVal.style.color = leftColor;
    leftVal.textContent = leftLabel;

    const barContainer = createOverlayEl('div', `${PREFIX}-meter-bar`, cid);

    const bidBar = createOverlayEl('div', `${PREFIX}-meter-fill`, cid);
    bidBar.style.width = `${ratio * 100}%`;
    bidBar.style.background = leftColor;

    const askBar = createOverlayEl('div', `${PREFIX}-meter-fill`, cid);
    askBar.style.width = `${(1 - ratio) * 100}%`;
    askBar.style.background = rightColor;

    barContainer.appendChild(bidBar);
    barContainer.appendChild(askBar);

    const rightVal = createOverlayEl('span', `${PREFIX}-meter-value`, cid);
    rightVal.style.color = rightColor;
    rightVal.textContent = rightLabel;

    row.appendChild(labelEl);
    row.appendChild(leftVal);
    row.appendChild(barContainer);
    row.appendChild(rightVal);

    return row;
  };

  // ─── Spread Bar ───

  const renderSpreadBar = (spread, cumRatio, levels, container, cid) => {
    const grid = container.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    const bar = createOverlayEl('div', `${PREFIX}-spread-bar`, cid);
    const ratioColor = cumRatio > 1.1 ? '#4ade80' : cumRatio < 0.9 ? '#f87171' : '#484f58';

    bar.innerHTML =
      `<span>Spread <b>${spread.ticks} pt</b> (${spread.pct}%)</span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>Ratio <b style="color:${ratioColor}">${cumRatio.toFixed(2)}</b></span>` +
      ` <span style="color:#30363d">\u00B7</span> ` +
      `<span>L${levels}</span>`;

    const totalRow = container.querySelector('[class*="absolute bottom-12"]');
    if (totalRow) {
      totalRow.parentElement.insertBefore(bar, totalRow);
    } else {
      grid.parentElement.insertBefore(bar, grid.nextSibling);
    }
  };

  // ─── Helpers ───

  const formatNum = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return String(num);
  };

  // Expose as globals
  window.ObOverlay = {
    renderOverlay,
    clearOverlay,
    getCid,
  };
})();
