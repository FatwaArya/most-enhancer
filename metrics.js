/**
 * metrics.js — Pure calculation module for order book analysis.
 * All functions are stateless. Loaded first via manifest.json.
 */

/* global window */

(() => {
  'use strict';

  /**
   * Enrich each row with depthPct (0-100) representing that row's lot
   * as a percentage of the maximum lot on that side.
   * @param {Array<Object>} rows - Parsed row objects for one side
   * @param {'bid'|'ask'} side
   * @returns {Array<Object>} rows with `depthPct` added
   */
  const calcDepthBars = (rows, side) => {
    try {
      if (!rows || rows.length === 0) return rows;
      const maxLot = Math.max(...rows.map(r => r.lot || 0));
      if (maxLot === 0) return rows;
      return rows.map(r => ({
        ...r,
        depthPct: Math.min(100, ((r.lot || 0) / maxLot) * 100),
      }));
    } catch {
      return rows;
    }
  };

  /**
   * Enrich each row with heatAlpha (0.05-0.55) for heatmap opacity.
   * @param {Array<Object>} rows
   * @param {'bid'|'ask'} side
   * @returns {Array<Object>} rows with `heatAlpha` added
   */
  const calcHeatmapIntensity = (rows, side) => {
    try {
      if (!rows || rows.length === 0) return rows;
      const maxLot = Math.max(...rows.map(r => r.lot || 0));
      if (maxLot === 0) return rows;
      return rows.map(r => ({
        ...r,
        heatAlpha: Math.min(0.55, ((r.lot || 0) / maxLot) * 0.6),
      }));
    } catch {
      return rows;
    }
  };

  /**
   * Calculate bid/ask imbalance ratios.
   * @param {Array<Object>} bidRows
   * @param {Array<Object>} askRows
   * @returns {Object} { lotRatio, freqRatio, bidLotTotal, askLotTotal, bidFreqTotal, askFreqTotal }
   */
  const calcImbalance = (bidRows, askRows) => {
    try {
      const bidLotTotal = (bidRows || []).reduce((s, r) => s + (r.lot || 0), 0);
      const askLotTotal = (askRows || []).reduce((s, r) => s + (r.lot || 0), 0);
      const bidFreqTotal = (bidRows || []).reduce((s, r) => s + (r.freq || 0), 0);
      const askFreqTotal = (askRows || []).reduce((s, r) => s + (r.freq || 0), 0);
      const totalLot = bidLotTotal + askLotTotal;
      const totalFreq = bidFreqTotal + askFreqTotal;
      return {
        lotRatio: totalLot > 0 ? bidLotTotal / totalLot : 0.5,
        freqRatio: totalFreq > 0 ? bidFreqTotal / totalFreq : 0.5,
        bidLotTotal,
        askLotTotal,
        bidFreqTotal,
        askFreqTotal,
      };
    } catch {
      return {
        lotRatio: 0.5, freqRatio: 0.5,
        bidLotTotal: 0, askLotTotal: 0,
        bidFreqTotal: 0, askFreqTotal: 0,
      };
    }
  };

  /**
   * Calculate spread between best bid and best ask.
   * @param {Object} bestBid - { price, lot, freq }
   * @param {Object} bestAsk - { price, lot, freq }
   * @returns {Object} { ticks, pct }
   */
  const calcSpread = (bestBid, bestAsk) => {
    try {
      if (!bestBid || !bestAsk || !bestBid.price || !bestAsk.price) {
        return { ticks: 0, pct: '0.00' };
      }
      const ticks = bestAsk.price - bestBid.price;
      const pct = bestBid.price > 0
        ? ((ticks / bestBid.price) * 100).toFixed(2)
        : '0.00';
      return { ticks, pct };
    } catch {
      return { ticks: 0, pct: '0.00' };
    }
  };

  /**
   * Detect wall levels — single levels whose lot exceeds a threshold % of total side lot.
   * @param {Array<Object>} rows
   * @param {'bid'|'ask'} side
   * @param {Object} options
   * @param {number} [options.wallThresholdPct=0.08]
   * @returns {Array<Object>} wall objects: { price, lot, pct, rowElement }
   */
  const detectWalls = (rows, side, options = {}) => {
    try {
      const threshold = options.wallThresholdPct || 0.08;
      if (!rows || rows.length === 0) return [];
      const totalLot = rows.reduce((s, r) => s + (r.lot || 0), 0);
      if (totalLot === 0) return [];
      return rows
        .filter(r => (r.lot || 0) > totalLot * threshold)
        .map(r => ({
          price: r.price,
          lot: r.lot,
          pct: ((r.lot / totalLot) * 100).toFixed(1),
          rowElement: r.rowElement,
        }));
    } catch {
      return [];
    }
  };

  /**
   * Detect frequency spikes — rows whose freq exceeds avg * multiplier.
   * @param {Array<Object>} rows
   * @param {'bid'|'ask'} side
   * @param {Object} options
   * @param {number} [options.freqSpikeMultiplier=2.5]
   * @returns {Array<Object>} spike rows
   */
  const detectFreqSpikes = (rows, side, options = {}) => {
    try {
      const multiplier = options.freqSpikeMultiplier || 2.5;
      if (!rows || rows.length === 0) return [];
      const freqs = rows.map(r => r.freq || 0).filter(f => f > 0);
      if (freqs.length === 0) return [];
      const avgFreq = freqs.reduce((s, f) => s + f, 0) / freqs.length;
      return rows.filter(r => (r.freq || 0) > avgFreq * multiplier);
    } catch {
      return [];
    }
  };

  /**
   * Calculate cumulative depth ratio (bid / ask) for top N levels.
   * @param {Array<Object>} bidRows
   * @param {Array<Object>} askRows
   * @param {number} [levels=10]
   * @returns {number} ratio — < 0.9 seller pressure, > 1.1 buyer pressure
   */
  const calcCumDepthRatio = (bidRows, askRows, levels = 10) => {
    try {
      const topBids = (bidRows || []).slice(0, levels);
      const topAsks = (askRows || []).slice(0, levels);
      const cumBid = topBids.reduce((s, r) => s + (r.lot || 0), 0);
      const cumAsk = topAsks.reduce((s, r) => s + (r.lot || 0), 0);
      if (cumAsk === 0) return cumBid > 0 ? 99 : 1;
      return cumBid / cumAsk;
    } catch {
      return 1;
    }
  };

  // Expose as globals for content.js and overlay.js (no ES modules in content scripts)
  window.ObMetrics = {
    calcDepthBars,
    calcHeatmapIntensity,
    calcImbalance,
    calcSpread,
    detectWalls,
    detectFreqSpikes,
    calcCumDepthRatio,
  };
})();
