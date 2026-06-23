/**
 * pvf-injector.js — Price Vol Freq table column injection.
 * Finds tables by header structure (Price, Volume, Freq, Buy Lot, Sell Lot, Buy Freq, Sell Freq).
 * Each table gets its own snapshot history (supports multiple stocks simultaneously).
 * Exposes window.PvfInjector.
 */

/* global window, document */

(() => {
  'use strict';

  const MAX_SNAPSHOTS = 120;
  const INJECTED_ATTR = 'data-pvf';

  const tableSnapshots = new WeakMap();

  // ─── Clean up old injections first ───

  const cleanupOld = () => {
    document.querySelectorAll(`[${INJECTED_ATTR}]`).forEach(el => el.remove());
  };

  // ─── Detection: find tables by header structure ───

  const findPvfTables = () => {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const ths = table.querySelectorAll('thead th');
      if (ths.length < 7) continue;

      const headers = Array.from(ths).map(th => th.textContent.trim().toLowerCase());

      const hasPrice = headers.some(h => h === 'price');
      const hasVolume = headers.some(h => h === 'volume' || h === 'vol');
      const hasFreq = headers.some(h => h === 'freq');
      const hasBuyLot = headers.some(h => h.includes('buy') && h.includes('lot'));
      const hasSellLot = headers.some(h => h.includes('sell') && h.includes('lot'));
      const hasBuyFreq = headers.some(h => h.includes('buy') && h.includes('freq'));
      const hasSellFreq = headers.some(h => h.includes('sell') && h.includes('freq'));

      // Must have PVF columns but NOT already have our injected columns
      const hasInjected = headers.some(h => h === 'state' || h === 'mom');

      if (hasPrice && hasVolume && hasFreq && hasBuyLot && hasSellLot && hasBuyFreq && hasSellFreq && !hasInjected) {
        results.push(table);
      }
    }

    return results;
  };

  // ─── Table Parsing ───

  const parsePvfTable = (table) => {
    const ths = table.querySelectorAll('thead th');
    const headers = Array.from(ths).map(th => th.textContent.trim().toLowerCase());

    const colMap = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h === 'price' && colMap.price === undefined) colMap.price = i;
      if ((h === 'volume' || h === 'vol') && colMap.volume === undefined) colMap.volume = i;
      if (h === 'freq' && colMap.freq === undefined) colMap.freq = i;
      if (h.includes('buy') && h.includes('lot') && colMap.buyLot === undefined) colMap.buyLot = i;
      if (h.includes('sell') && h.includes('lot') && colMap.sellLot === undefined) colMap.sellLot = i;
      if (h.includes('buy') && h.includes('freq') && colMap.buyFreq === undefined) colMap.buyFreq = i;
      if (h.includes('sell') && h.includes('freq') && !h.includes('pre') && colMap.sellFreq === undefined) colMap.sellFreq = i;
    }

    const tbody = table.querySelector('tbody');
    if (!tbody) return { rows: [], priceKeys: [] };

    const rows = [];
    const priceKeys = [];

    for (const row of tbody.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) continue;

      const getVal = (key) => {
        const idx = colMap[key];
        if (idx === undefined || idx >= cells.length) return 0;
        return parseNum(cells[idx].textContent);
      };

      const price = getVal('price');
      if (price === 0) continue;
      const priceKey = String(price);

      rows.push({
        price,
        volume: getVal('volume'),
        freq: getVal('freq'),
        buyLot: getVal('buyLot'),
        sellLot: getVal('sellLot'),
        buyFreq: getVal('buyFreq'),
        sellFreq: getVal('sellFreq'),
        rowElement: row,
      });
      priceKeys.push(priceKey);
    }

    return { rows, priceKeys };
  };

  // ─── Column Injection ───

  const NEW_COLUMNS = [
    { key: 'state', label: 'State' },
    { key: 'momentum', label: 'Mom' },
    { key: 'signal', label: 'Signal' },
  ];

  const injectColumns = (table) => {
    const ths = Array.from(table.querySelectorAll('thead th'));
    const headers = ths.map(th => th.textContent.trim().toLowerCase());

    // Find Sell Freq column index
    let sellFreqIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].includes('sell') && headers[i].includes('freq') && !headers[i].includes('pre')) {
        sellFreqIdx = i;
        break;
      }
    }
    if (sellFreqIdx === -1) return;

    // Find Pre & Post Volume column (insert before this)
    let prePostIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].includes('pre') && headers[i].includes('vol')) {
        prePostIdx = i;
        break;
      }
    }
    // If no Pre & Post column, insert after Sell Freq
    const insertBeforeEl = prePostIdx !== -1 ? ths[prePostIdx] : (ths[sellFreqIdx + 1] || null);

    const headerRow = ths[0].parentElement;

    // Create header cells and insert in correct order
    // insertBefore with the same reference element in forward loop = correct order
    for (let i = 0; i < NEW_COLUMNS.length; i++) {
      const th = document.createElement('th');
      th.textContent = NEW_COLUMNS[i].label;
      th.setAttribute(INJECTED_ATTR, 'header');
      th.setAttribute('data-pvf-col', NEW_COLUMNS[i].key);
      th.style.cssText =
        'background:#161b22!important;color:#58a6ff!important;font-size:9px!important;' +
        'padding:2px 4px!important;text-align:center!important;white-space:nowrap!important;' +
        'border:1px solid #21262d!important;font-weight:600!important;';
      headerRow.insertBefore(th, insertBeforeEl);
    }

    // Insert data cells for each row
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    for (const row of tbody.querySelectorAll('tr')) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 7) continue;

      // Find the same reference cell in this row
      const rowInsertBefore = prePostIdx !== -1 && cells[prePostIdx] ? cells[prePostIdx] : null;

      for (let i = 0; i < NEW_COLUMNS.length; i++) {
        const td = document.createElement('td');
        td.setAttribute(INJECTED_ATTR, 'cell');
        td.setAttribute('data-pvf-col', NEW_COLUMNS[i].key);
        td.style.cssText =
          'text-align:center!important;font-size:9px!important;' +
          'padding:2px 4px!important;white-space:nowrap!important;' +
          'border:1px solid #21262d!important;font-variant-numeric:tabular-nums!important;';
        if (rowInsertBefore) {
          row.insertBefore(td, rowInsertBefore);
        } else {
          row.appendChild(td);
        }
      }
    }

    // Initialize snapshot history for this table
    if (!tableSnapshots.has(table)) {
      tableSnapshots.set(table, []);
    }
  };

  // ─── Computation ───

  const sigmoid = (x, scale) => 100 / (1 + Math.exp(-x / scale));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const computeRowMetrics = (current, previous, history, priceKey) => {
    const deltaLot = current.buyLot - current.sellLot;
    const totalLot = current.buyLot + current.sellLot;
    const buyPercent = totalLot > 0 ? (current.buyLot / totalLot) * 100 : 50;
    const deltaFreq = current.buyFreq - current.sellFreq;

    let flowDelta = 0;
    if (previous) {
      flowDelta = (current.buyLot - previous.buyLot) - (current.sellLot - previous.sellLot);
    }

    const momentum = clamp(
      0.30 * sigmoid(flowDelta, 5000) +
      0.25 * buyPercent +
      0.25 * sigmoid(deltaFreq, 200) +
      0.20 * (previous ? (current.price > previous.price ? 85 : current.price < previous.price ? 15 : 50) : 50),
      0, 100
    );

    const state = determineState(current, flowDelta, buyPercent, momentum, history, priceKey);
    const signal = determineSignal(current, previous, flowDelta, buyPercent, deltaFreq, momentum, state, history, priceKey);
    const rowOpacity = clamp(0.3 + (momentum / 100) * 0.7, 0.3, 1.0);

    return { deltaLot, buyPercent, deltaFreq, flowDelta, momentum, state, signal: signal.signal, signalLabel: signal.label, rowOpacity };
  };

  const determineState = (current, flowDelta, buyPercent, momentum, history, priceKey) => {
    if (momentum > 90) return 'BREAKOUT';
    if (history.length >= 5) {
      const recent = history.slice(-6);
      const prices = recent.map(s => s.rows[priceKey]?.price).filter(p => p !== undefined);
      if (prices.length >= 2 && prices.every(p => p === prices[0])) {
        const buyLots = recent.map(s => s.rows[priceKey]?.buyLot ?? 0);
        if (buyLots.length >= 2 && buyLots[buyLots.length - 1] > buyLots[0] && flowDelta > 0) return 'ABSORB';
        const sellLots = recent.map(s => s.rows[priceKey]?.sellLot ?? 0);
        if (sellLots.length >= 2 && sellLots[sellLots.length - 1] > sellLots[0] && flowDelta < 0) return 'ABSORB';
      }
    }
    if (buyPercent > 70 && flowDelta > 0) return 'ACCUM';
    if (current.sellLot > current.buyLot && flowDelta < 0) return 'DIST';
    return 'NEUTRAL';
  };

  const determineSignal = (current, previous, flowDelta, buyPercent, deltaFreq, momentum, state, history, priceKey) => {
    if (history.length >= 5) {
      const recent = history.slice(-6);
      const prices = recent.map(s => s.rows[priceKey]?.price).filter(p => p !== undefined);
      if (prices.length >= 2 && prices.every(p => p === prices[0])) {
        let exceedCount = 0;
        for (const snap of recent) {
          const row = snap.rows[priceKey];
          if (!row) continue;
          const visible = row.buyLot + row.sellLot;
          if (visible > 0 && row.volume > visible * 1.5) exceedCount++;
        }
        if (exceedCount >= 3) {
          const avgBuy = recent.reduce((s, snap) => s + (snap.rows[priceKey]?.buyLot ?? 0), 0) / recent.length;
          const avgSell = recent.reduce((s, snap) => s + (snap.rows[priceKey]?.sellLot ?? 0), 0) / recent.length;
          return avgSell > avgBuy
            ? { signal: 'ICEBERG_SELLER', label: '\uD83E\uDDCA Iceberg S' }
            : { signal: 'ICEBERG_BUYER', label: '\uD83E\uDDCA Iceberg B' };
        }
      }
    }
    if (flowDelta > 0 && buyPercent > 70 && deltaFreq > 0 && momentum > 80 && (!previous || current.price >= previous.price)) {
      return { signal: 'BREAKOUT', label: '\uD83D\uDE80 Breakout' };
    }
    if (state === 'ABSORB') {
      return flowDelta > 0
        ? { signal: 'SELLER_ABSORB', label: '\u26A0 Sell Absorb' }
        : { signal: 'BUYER_ABSORB', label: '\u26A0 Buy Absorb' };
    }
    if (buyPercent > 70 && flowDelta > 0 && momentum > 70) return { signal: 'STRONG_BUY', label: '\uD83D\uDD25 Strong' };
    if (buyPercent > 55 && flowDelta > 0) return { signal: 'BUY', label: '\uD83D\uDFE2 Buy' };
    if (buyPercent < 40 && flowDelta < 0) return { signal: 'SELL', label: '\uD83D\uDD34 Sell' };
    return { signal: 'NEUTRAL', label: '\uD83D\uDFE1 Neutral' };
  };

  // ─── Cell Update ───

  const updateCells = (table, computed, priceKeys) => {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    let rowIdx = 0;
    for (const row of tbody.querySelectorAll('tr')) {
      if (rowIdx >= priceKeys.length) break;
      const priceKey = priceKeys[rowIdx];
      const m = computed[priceKey];
      rowIdx++;

      if (!m) continue;

      const cells = row.querySelectorAll(`[${INJECTED_ATTR}="cell"]`);
      if (cells.length === 0) continue;

      row.style.background = getRowBg(m.state, m.rowOpacity);

      for (const cell of cells) {
        const col = cell.getAttribute('data-pvf-col');
        if (!col) continue;

        switch (col) {
          case 'state':
            cell.textContent = m.state;
            cell.style.cssText += getStateBadge(m.state);
            break;
          case 'momentum':
            // Visual bar + number
            const barWidth = Math.round(m.momentum);
            const barColor = m.momentum > 80 ? '#3fb950' : m.momentum > 60 ? '#e3b341' : m.momentum > 40 ? '#d29922' : '#f85149';
            cell.innerHTML =
              `<div style="display:flex;align-items:center;gap:3px">` +
                `<div style="flex:1;height:3px;background:#21262d;border-radius:2px;overflow:hidden">` +
                  `<div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:2px;transition:width 120ms ease-out"></div>` +
                `</div>` +
                `<span style="font-size:8px;color:${barColor};font-weight:700;min-width:20px;text-align:right">${Math.round(m.momentum)}</span>` +
              `</div>`;
            break;
          case 'signal':
            cell.textContent = m.signalLabel;
            cell.style.color = getSignalColor(m.signal);
            cell.style.fontWeight = m.signal !== 'NEUTRAL' ? '700' : '400';
            break;
        }
      }
    }
  };

  // ─── Main Update ───

  const update = () => {
    // Clean up any stale injections first
    cleanupOld();

    const tables = findPvfTables();
    for (const table of tables) {
      // Always inject fresh (cleanupOld removed old ones)
      injectColumns(table);

      const { rows, priceKeys } = parsePvfTable(table);
      if (rows.length === 0) continue;

      const snapshots = tableSnapshots.get(table) || [];

      const currentSnapshot = {
        timestamp: Date.now(),
        rows: Object.fromEntries(priceKeys.map((k, i) => [k, rows[i]])),
        priceOrder: priceKeys,
      };

      const prevSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

      const computed = {};
      for (let i = 0; i < rows.length; i++) {
        const pk = priceKeys[i];
        computed[pk] = computeRowMetrics(
          rows[i],
          prevSnapshot?.rows[pk],
          snapshots,
          pk
        );
      }

      snapshots.push(currentSnapshot);
      if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
      tableSnapshots.set(table, snapshots);

      updateCells(table, computed, priceKeys);
    }
  };

  // ─── Formatters ───

  const parseNum = (text) => {
    if (!text) return 0;
    const cleaned = text.trim().replace(/,/g, '');
    return parseFloat(cleaned) || 0;
  };

  const fmtDelta = (v) => {
    const sign = v >= 0 ? '+' : '';
    return Math.abs(v) >= 1000 ? `${sign}${(v / 1000).toFixed(1)}K` : `${sign}${Math.round(v)}`;
  };

  const fmtMomentum = (v) => {
    let e;
    if (v >= 90) e = '\uD83D\uDD25';
    else if (v >= 70) e = '\uD83D\uDFE2';
    else if (v >= 40) e = '\uD83D\uDFE1';
    else e = '\uD83D\uDD34';
    return `${e}${Math.round(v)}`;
  };

  const getRowBg = (state, opacity) => {
    const a = (0.12 * opacity).toFixed(3);
    switch (state) {
      case 'ACCUM': return `rgba(63,185,80,${a})`;
      case 'DIST': return `rgba(248,81,73,${a})`;
      case 'ABSORB': return `rgba(219,109,40,${(0.15 * opacity).toFixed(3)})`;
      case 'BREAKOUT': return `rgba(163,113,247,${(0.18 * opacity).toFixed(3)})`;
      default: return 'transparent';
    }
  };

  const getStateBadge = (state) => {
    const map = {
      ACCUM: 'background:rgba(63,185,80,0.2);color:#3fb950;border:1px solid rgba(63,185,80,0.3);border-radius:2px;',
      DIST: 'background:rgba(248,81,73,0.2);color:#f85149;border:1px solid rgba(248,81,73,0.3);border-radius:2px;',
      ABSORB: 'background:rgba(219,109,40,0.2);color:#db6d28;border:1px solid rgba(219,109,40,0.3);border-radius:2px;',
      BREAKOUT: 'background:rgba(163,113,247,0.2);color:#a371f7;border:1px solid rgba(163,113,247,0.3);border-radius:2px;',
      NEUTRAL: 'background:rgba(139,148,158,0.1);color:#484f58;border:1px solid rgba(139,148,158,0.2);border-radius:2px;',
    };
    return map[state] || map.NEUTRAL;
  };

  const getSignalColor = (signal) => {
    const map = {
      BREAKOUT: '#a371f7', STRONG_BUY: '#f0883e', BUY: '#3fb950', SELL: '#f85149',
      SELLER_ABSORB: '#db6d28', BUYER_ABSORB: '#db6d28',
      ICEBERG_SELLER: '#58a6ff', ICEBERG_BUYER: '#58a6ff', NEUTRAL: '#d29922',
    };
    return map[signal] || '#d29922';
  };

  window.PvfInjector = { update };
})();
