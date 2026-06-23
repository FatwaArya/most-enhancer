/**
 * alerts.js — Per-container alert system.
 * Each OB container gets its own alert panel and alert state.
 * Loaded second via manifest.json. Exposes window.ObAlerts.
 */

/* global window, crypto */

(() => {
  'use strict';

  const ALERT_TYPES = {
    WALL_BID: 'WALL_BID',
    WALL_ASK: 'WALL_ASK',
    BIG_LOT_BID: 'BIG_LOT_BID',
    BIG_LOT_ASK: 'BIG_LOT_ASK',
    FREQ_SPIKE: 'FREQ_SPIKE',
    IMBALANCE_SHIFT: 'IMBALANCE_SHIFT',
    SPREAD_WIDE: 'SPREAD_WIDE',
  };

  const ALERT_COLORS = {
    WALL_BID: '#fb923c',
    WALL_ASK: '#f87171',
    BIG_LOT_BID: '#4ade80',
    BIG_LOT_ASK: '#f87171',
    FREQ_SPIKE: '#facc15',
    IMBALANCE_SHIFT: '#e2e8f0',
    SPREAD_WIDE: '#a78bfa',
  };

  const MAX_VISIBLE_ALERTS = 6;
  const AUTO_DISMISS_MS = 8000;
  const DEDUP_TTL_MS = 5000;

  /** @type {Map<string, number>} type-price → timestamp */
  const lastAlertMap = new Map();

  /** @type {Map<HTMLElement, {panel: HTMLElement, alerts: Array}>} per-container state */
  const containerState = new Map();

  const uuid = () => {
    try { return crypto.randomUUID(); }
    catch { return 'a' + Math.random().toString(36).slice(2, 11); }
  };

  /**
   * Initialize the alert panel inside the given container.
   */
  const initAlertPanel = (container) => {
    try {
      const existing = containerState.get(container);
      if (existing && document.contains(existing.panel)) return;

      const panel = document.createElement('div');
      panel.className = 'ob-ext-alert-panel';
      container.style.position = container.style.position || 'relative';
      container.appendChild(panel);

      containerState.set(container, { panel, alerts: [] });
    } catch { /* silent */ }
  };

  const isDuplicate = (type, price) => {
    const key = `${type}-${price}`;
    const last = lastAlertMap.get(key);
    if (last && Date.now() - last < DEDUP_TTL_MS) return true;
    lastAlertMap.set(key, Date.now());
    return false;
  };

  /**
   * Fire an alert for a specific container.
   */
  const fireAlert = (container, alert) => {
    try {
      const state = containerState.get(container);
      if (!state || !document.contains(state.panel)) return;
      if (isDuplicate(alert.type, alert.price)) return;

      const entry = {
        id: uuid(),
        type: alert.type,
        message: alert.message,
        price: alert.price,
        lot: alert.lot,
        side: alert.side,
        timestamp: new Date(),
        dismissed: false,
      };

      state.alerts.unshift(entry);
      if (state.alerts.length > MAX_VISIBLE_ALERTS) {
        state.alerts = state.alerts.slice(0, MAX_VISIBLE_ALERTS);
      }

      renderAlerts(container);

      setTimeout(() => dismissAlert(container, entry.id), AUTO_DISMISS_MS);
    } catch { /* silent */ }
  };

  const dismissAlert = (container, id) => {
    try {
      const state = containerState.get(container);
      if (!state) return;
      state.alerts = state.alerts.filter(a => a.id !== id);
      renderAlerts(container);
    } catch { /* silent */ }
  };

  const clearAlerts = (container) => {
    try {
      const state = containerState.get(container);
      if (!state) return;
      state.alerts = [];
      state.panel.innerHTML = '';
    } catch { /* silent */ }
  };

  const renderAlerts = (container) => {
    try {
      const state = containerState.get(container);
      if (!state || !document.contains(state.panel)) return;
      state.panel.innerHTML = '';

      for (const alert of state.alerts) {
        if (alert.dismissed) continue;
        const item = document.createElement('div');
        item.className = 'ob-ext-alert-item';
        item.style.color = ALERT_COLORS[alert.type] || '#c9d1d9';

        const icon = document.createElement('span');
        icon.className = 'ob-ext-alert-icon';
        icon.textContent = getAlertIcon(alert.type);

        const msg = document.createElement('span');
        msg.className = 'ob-ext-alert-msg';
        msg.textContent = alert.message;

        const time = document.createElement('span');
        time.className = 'ob-ext-alert-time';
        time.textContent = formatTime(alert.timestamp);

        item.appendChild(icon);
        item.appendChild(msg);
        item.appendChild(time);
        state.panel.appendChild(item);

        requestAnimationFrame(() => {
          item.setAttribute('data-visible', '');
        });
      }
    } catch { /* silent */ }
  };

  const getAlertIcon = (type) => {
    const icons = {
      WALL_BID: '\u{1F7E2}',
      WALL_ASK: '\u{1F534}',
      BIG_LOT_BID: '\u{1F4A1}',
      BIG_LOT_ASK: '\u{1F4A1}',
      FREQ_SPIKE: '\u{1F525}',
      IMBALANCE_SHIFT: '\u2696\uFE0F',
      SPREAD_WIDE: '\u{1F504}',
    };
    return icons[type] || '\u{1F514}';
  };

  const formatTime = (date) => {
    try {
      return date.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return ''; }
  };

  const formatLot = (lot) => {
    if (lot >= 1000000) return (lot / 1000000).toFixed(1) + 'M';
    if (lot >= 1000) return (lot / 1000).toFixed(0) + 'K';
    return String(lot);
  };

  /**
   * Process all detection results and fire new alerts for a container.
   */
  const processAlerts = (container, walls, spikes, imbalance, spread, settings) => {
    try {
      if (!settings || !settings.alertsEnabled) return;

      for (const w of walls) {
        const type = w.side === 'bid' ? ALERT_TYPES.WALL_BID : ALERT_TYPES.WALL_ASK;
        fireAlert(container, {
          type,
          message: `WALL ${w.side.toUpperCase()} @${w.price} \u2014 ${formatLot(w.lot)} lot (${w.pct}%)`,
          price: w.price, lot: w.lot, side: w.side,
        });
      }

      for (const s of spikes) {
        fireAlert(container, {
          type: ALERT_TYPES.FREQ_SPIKE,
          message: `FREQ SPIKE ${s.side.toUpperCase()} @${s.price} \u2014 ${s.freq} trades`,
          price: s.price, lot: s.lot, side: s.side,
        });
      }

      const bigLotThreshold = settings.bigLotThreshold || 500000;
      for (const w of walls) {
        if (w.lot >= bigLotThreshold) {
          const type = w.side === 'bid' ? ALERT_TYPES.BIG_LOT_BID : ALERT_TYPES.BIG_LOT_ASK;
          fireAlert(container, {
            type,
            message: `BIG ${w.side.toUpperCase()} @${w.price} \u2014 ${formatLot(w.lot)} lot`,
            price: w.price, lot: w.lot, side: w.side,
          });
        }
      }

      if (spread && spread.ticks > 3) {
        fireAlert(container, {
          type: ALERT_TYPES.SPREAD_WIDE,
          message: `SPREAD WIDE \u2014 ${spread.ticks} ticks (${spread.pct}%)`,
          price: 0, lot: 0, side: 'bid',
        });
      }
    } catch { /* silent */ }
  };

  // Expose as globals
  window.ObAlerts = {
    ALERT_TYPES,
    initAlertPanel,
    fireAlert,
    dismissAlert,
    clearAlerts,
    processAlerts,
  };
})();
