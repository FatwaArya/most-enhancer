/**
 * content.js — Orchestrator for multi-panel order book enhancement.
 * Each OB container gets its own observer, overlays, and control panel.
 * No global clear — all operations scoped per-container.
 */

/* global window, document, MutationObserver, requestAnimationFrame, chrome */

(() => {
  'use strict';

  // ─── State ───

  /** @type {Map<HTMLElement, {observer: MutationObserver, rafPending: boolean}>} */
  const obState = new Map();
  const prevImbalances = new Map();
  let pvfObserver = null;
  let settings = {};
  let connectionFound = false;
  let rescanTimer = null;

  const DEFAULT_SETTINGS = {
    wallThresholdPct: 8,
    bigLotThreshold: 500000,
    freqSpikeMultiplier: 2.5,
    depthBarEnabled: true,
    heatmapEnabled: true,
    alertsEnabled: true,
    soundEnabled: false,
    imbalanceEnabled: true,
    spreadBarEnabled: true,
    levels: 10,
    pvfEnabled: true,
  };

  // ─── Settings ───

  const loadSettings = () => {
    try {
      if (chrome?.storage?.sync) {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
          settings = { ...DEFAULT_SETTINGS, ...result };
        });
      } else {
        settings = { ...DEFAULT_SETTINGS };
      }
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  };

  // ═══════════════════════════════════════════
  // FEATURE 1: Order Book Enhancement (multi-panel)
  // ═══════════════════════════════════════════

  const findAllOrderBooks = () => {
    const results = [];
    const grids = document.querySelectorAll('.grid.grid-cols-2');
    for (const grid of grids) {
      const tables = grid.querySelectorAll('table');
      if (tables.length === 2) {
        const headers = tables[0].querySelectorAll('th');
        const texts = Array.from(headers).map(h => (h.textContent || '').trim().toLowerCase());
        if (texts.some(t => t.includes('bid')) || texts.some(t => t.includes('freq'))) {
          const container = grid.closest('[class*="relative"]') || grid.parentElement;
          if (container) results.push(container);
        }
      }
    }
    return results;
  };

  const parseNum = (text) => {
    try {
      if (!text) return 0;
      let cleaned = text.trim();
      if (!cleaned || cleaned === '-' || cleaned === 'TOTAL') return 0;
      const suffixMatch = cleaned.match(/([\d.,]+)\s*([MBTKmbtk])$/);
      if (suffixMatch) {
        const num = parseFloat(suffixMatch[1].replace(/,/g, ''));
        const s = suffixMatch[2].toUpperCase();
        if (s === 'M') return num * 1e6;
        if (s === 'B') return num * 1e9;
        if (s === 'K') return num * 1e3;
        if (s === 'T') return num * 1e12;
        return num;
      }
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned) || 0;
    } catch {
      return 0;
    }
  };

  const parseOrderBook = (container) => {
    const bidRows = [];
    const askRows = [];
    let bestBid = null;
    let bestAsk = null;

    try {
      const tables = container.querySelectorAll('table');
      if (tables.length < 2) return { bidRows, askRows, bestBid, bestAsk };

      const bidBody = tables[0].querySelector('tbody');
      if (bidBody) {
        for (const row of bidBody.querySelectorAll('tr')) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) continue;
          const freq = parseNum(cells[0].textContent);
          const lot = parseNum(cells[1].textContent);
          const price = parseNum(cells[2].textContent);
          if (price === 0) continue;
          const entry = { side: 'bid', price, lot, freq, rowElement: row };
          bidRows.push(entry);
          if (!bestBid || price > bestBid.price) bestBid = entry;
        }
      }

      const askBody = tables[1].querySelector('tbody');
      if (askBody) {
        for (const row of askBody.querySelectorAll('tr')) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) continue;
          const price = parseNum(cells[0].textContent);
          const lot = parseNum(cells[1].textContent);
          const freq = parseNum(cells[2].textContent);
          if (price === 0) continue;
          const entry = { side: 'ask', price, lot, freq, rowElement: row };
          askRows.push(entry);
          if (!bestAsk || price < bestAsk.price) bestAsk = entry;
        }
      }

      return { bidRows, askRows, bestBid, bestAsk };
    } catch {
      return { bidRows, askRows, bestBid, bestAsk };
    }
  };

  const onObUpdate = (container) => {
    try {
      if (!window.ObMetrics || !window.ObOverlay) return;

      const { bidRows, askRows, bestBid, bestAsk } = parseOrderBook(container);
      if (bidRows.length === 0 && askRows.length === 0) return;

      const enrichedBids = window.ObMetrics.calcDepthBars(bidRows, 'bid');
      window.ObMetrics.calcHeatmapIntensity(enrichedBids, 'bid');
      const enrichedAsks = window.ObMetrics.calcDepthBars(askRows, 'ask');
      window.ObMetrics.calcHeatmapIntensity(enrichedAsks, 'ask');

      const imbalance = window.ObMetrics.calcImbalance(enrichedBids, enrichedAsks);
      const spread = window.ObMetrics.calcSpread(bestBid, bestAsk);
      const cumRatio = window.ObMetrics.calcCumDepthRatio(enrichedBids, enrichedAsks, settings.levels || 10);

      const wallOpts = { wallThresholdPct: (settings.wallThresholdPct || 8) / 100 };
      const freqOpts = { freqSpikeMultiplier: settings.freqSpikeMultiplier || 2.5 };

      const bidWalls = window.ObMetrics.detectWalls(enrichedBids, 'bid', wallOpts);
      const askWalls = window.ObMetrics.detectWalls(enrichedAsks, 'ask', wallOpts);
      const allWalls = [
        ...bidWalls.map(w => ({ ...w, side: 'bid' })),
        ...askWalls.map(w => ({ ...w, side: 'ask' })),
      ];

      const bidSpikes = window.ObMetrics.detectFreqSpikes(enrichedBids, 'bid', freqOpts);
      const askSpikes = window.ObMetrics.detectFreqSpikes(enrichedAsks, 'ask', freqOpts);
      const allSpikes = [
        ...bidSpikes.map(s => ({ ...s, side: 'bid', _isSpike: true })),
        ...askSpikes.map(s => ({ ...s, side: 'ask', _isSpike: true })),
      ];

      for (const spike of allSpikes) {
        if (spike.rowElement) {
          const match = [...enrichedBids, ...enrichedAsks].find(r => r.rowElement === spike.rowElement);
          if (match) match._isSpike = true;
        }
      }

      // Per-container imbalance shift detection
      const prevImbalance = prevImbalances.get(container);
      if (prevImbalance !== null && prevImbalance !== undefined) {
        const shift = Math.abs(imbalance.lotRatio - prevImbalance);
        if (shift > 0.05 && window.ObAlerts) {
          window.ObAlerts.fireAlert(container, {
            type: 'IMBALANCE_SHIFT',
            message: `IMBALANCE SHIFT \u2014 ${(imbalance.lotRatio * 100).toFixed(0)}% bid`,
            price: 0, lot: 0,
            side: imbalance.lotRatio > 0.5 ? 'bid' : 'ask',
          });
        }
      }
      prevImbalances.set(container, imbalance.lotRatio);

      // Per-container render (scoped — no global clear)
      window.ObOverlay.renderOverlay({
        bidRows: enrichedBids, askRows: enrichedAsks,
        imbalance, spread, cumRatio,
        walls: allWalls, spikes: allSpikes,
        settings, container,
      });

      if (window.ObAlerts) {
        window.ObAlerts.processAlerts(container, allWalls, allSpikes, imbalance, spread, settings);
      }

      // Update control panel metrics
      if (window.ObControlPanel) {
        window.ObControlPanel.updateMetrics(container, {
          imbalance, spread, cumRatio,
          wallCount: allWalls.length,
          spikeCount: allSpikes.length,
        });
      }
    } catch { /* silently fail */ }
  };

  const attachObObserver = (container) => {
    try {
      const existing = obState.get(container);
      if (existing) existing.observer.disconnect();

      const state = { rafPending: false };
      state.observer = new MutationObserver(() => {
        if (state.rafPending) return;
        state.rafPending = true;
        requestAnimationFrame(() => {
          state.rafPending = false;
          onObUpdate(container);
        });
      });
      state.observer.observe(container, { childList: true, subtree: true, characterData: true });
      obState.set(container, state);
    } catch { /* silently fail */ }
  };

  // ═══════════════════════════════════════════
  // FEATURE 2: Price Vol Freq Enhancement
  // ═══════════════════════════════════════════

  const onPvfUpdate = () => {
    try {
      if (settings.pvfEnabled === false) return;
      window.PvfInjector.update();
    } catch { /* silently fail */ }
  };

  const attachPvfObserver = () => {
    try {
      if (pvfObserver) pvfObserver.disconnect();
      let pvfRaf = false;
      pvfObserver = new MutationObserver(() => {
        if (pvfRaf) return;
        pvfRaf = true;
        requestAnimationFrame(() => {
          pvfRaf = false;
          onPvfUpdate();
        });
      });
      pvfObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch { /* silently fail */ }
  };

  // ═══════════════════════════════════════════
  // Message Handling
  // ═══════════════════════════════════════════

  const setupMessages = () => {
    try {
      if (!chrome?.runtime?.onMessage) return;
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === 'SETTINGS_UPDATED') {
          settings = { ...DEFAULT_SETTINGS, ...message.settings };
          for (const container of obState.keys()) {
            onObUpdate(container);
          }
          onPvfUpdate();
        }
        if (message?.type === 'GET_STATUS') {
          sendResponse({ connected: connectionFound });
        }
      });
    } catch { /* silently fail */ }
  };

  // ═══════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════

  const scanAndUpdate = () => {
    const containers = findAllOrderBooks();

    for (const container of containers) {
      if (!obState.has(container)) {
        attachObObserver(container);
        if (window.ObAlerts) window.ObAlerts.initAlertPanel(container);
        if (window.ObControlPanel) window.ObControlPanel.init(container);
        connectionFound = true;
      }
      onObUpdate(container);
    }

    // Clean up removed containers
    for (const [container, state] of obState) {
      if (!document.contains(container)) {
        state.observer.disconnect();
        prevImbalances.delete(container);
        obState.delete(container);
        if (window.ObOverlay) window.ObOverlay.clearOverlay(container);
        if (window.ObControlPanel) window.ObControlPanel.destroy(container);
        if (window.ObAlerts) window.ObAlerts.clearAlerts(container);
      }
    }

    onPvfUpdate();
  };

  const init = () => {
    loadSettings();
    setupMessages();
    attachPvfObserver();
    scanAndUpdate();

    // Periodic rescan for late-loading panels (SPA navigation, dynamic tabs)
    rescanTimer = setInterval(scanAndUpdate, 3000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
