/**
 * alerts.js — Per-container alert system.
 * Renders alert toasts with reconciliation (add/remove, no full rebuild).
 */

/* global window, crypto */

(() => {
  'use strict';

  const ALERT_COLORS = {
    WALL_BID: '#d29922',
    WALL_ASK: '#f85149',
    BIG_LOT_BID: '#3fb950',
    BIG_LOT_ASK: '#f85149',
    FREQ_SPIKE: '#e3b341',
    IMBALANCE_SHIFT: '#c9d1d9',
    SPREAD_WIDE: '#a371f7',
  };

  const MAX_VISIBLE = 5;
  const AUTO_DISMISS_MS = 7000;
  const DEDUP_TTL_MS = 5000;

  const lastAlertMap = new Map();

  /** @type {Map<HTMLElement, {panel: HTMLElement, alerts: Array, domMap: Map}>} */
  const containerState = new Map();

  const uuid = () => {
    try { return crypto.randomUUID(); }
    catch { return 'a' + Math.random().toString(36).slice(2, 11); }
  };

  const initAlertPanel = (container) => {
    try {
      const existing = containerState.get(container);
      if (existing && document.contains(existing.panel)) return;

      const panel = document.createElement('div');
      panel.className = 'ob-ext-alert-panel';
      container.style.position = container.style.position || 'relative';
      container.appendChild(panel);

      containerState.set(container, { panel, alerts: [], domMap: new Map() });
    } catch { /* silent */ }
  };

  const isDuplicate = (type, price) => {
    const key = `${type}-${price}`;
    const last = lastAlertMap.get(key);
    if (last && Date.now() - last < DEDUP_TTL_MS) return true;
    lastAlertMap.set(key, Date.now());
    return false;
  };

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
      };

      state.alerts.unshift(entry);
      if (state.alerts.length > MAX_VISIBLE) {
        // Remove oldest from DOM
        const removed = state.alerts.splice(MAX_VISIBLE);
        for (const r of removed) {
          const dom = state.domMap.get(r.id);
          if (dom) { dom.remove(); state.domMap.delete(r.id); }
        }
      }

      // Add new entry to DOM (prepend)
      const item = buildAlertItem(entry);
      state.domMap.set(entry.id, item);
      state.panel.prepend(item);
      requestAnimationFrame(() => item.setAttribute('data-visible', ''));

      setTimeout(() => dismissAlert(container, entry.id), AUTO_DISMISS_MS);
    } catch { /* silent */ }
  };

  const dismissAlert = (container, id) => {
    try {
      const state = containerState.get(container);
      if (!state) return;

      const dom = state.domMap.get(id);
      if (dom) {
        dom.removeAttribute('data-visible');
        setTimeout(() => {
          dom.remove();
          state.domMap.delete(id);
        }, 160); // match CSS transition
      }

      state.alerts = state.alerts.filter(a => a.id !== id);
    } catch { /* silent */ }
  };

  const clearAlerts = (container) => {
    try {
      const state = containerState.get(container);
      if (!state) return;
      state.alerts = [];
      state.panel.innerHTML = '';
      state.domMap.clear();
    } catch { /* silent */ }
  };

  const buildAlertItem = (alert) => {
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
    return item;
  };

  const getAlertIcon = (type) => {
    const icons = {
      WALL_BID: '\u{1F7E2}', WALL_ASK: '\u{1F534}',
      BIG_LOT_BID: '\u{1F4A1}', BIG_LOT_ASK: '\u{1F4A1}',
      FREQ_SPIKE: '\u{1F525}', IMBALANCE_SHIFT: '\u2696\uFE0F',
      SPREAD_WIDE: '\u{1F504}',
    };
    return icons[type] || '\u{1F514}';
  };

  const formatTime = (date) => {
    try {
      return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  };

  const formatLot = (lot) => {
    if (lot >= 1e6) return (lot / 1e6).toFixed(1) + 'M';
    if (lot >= 1e3) return (lot / 1e3).toFixed(0) + 'K';
    return String(lot);
  };

  const processAlerts = (container, walls, spikes, imbalance, spread, settings) => {
    try {
      if (!settings || !settings.alertsEnabled) return;

      for (const w of walls) {
        const type = w.side === 'bid' ? 'WALL_BID' : 'WALL_ASK';
        fireAlert(container, {
          type,
          message: `WALL ${w.side.toUpperCase()} @${w.price} \u2014 ${formatLot(w.lot)} lot (${w.pct}%)`,
          price: w.price, lot: w.lot, side: w.side,
        });
      }

      for (const s of spikes) {
        fireAlert(container, {
          type: 'FREQ_SPIKE',
          message: `FREQ SPIKE ${s.side.toUpperCase()} @${s.price} \u2014 ${s.freq} trades`,
          price: s.price, lot: s.lot, side: s.side,
        });
      }

      const bigLotThreshold = settings.bigLotThreshold || 500000;
      for (const w of walls) {
        if (w.lot >= bigLotThreshold) {
          const type = w.side === 'bid' ? 'BIG_LOT_BID' : 'BIG_LOT_ASK';
          fireAlert(container, {
            type,
            message: `BIG ${w.side.toUpperCase()} @${w.price} \u2014 ${formatLot(w.lot)} lot`,
            price: w.price, lot: w.lot, side: w.side,
          });
        }
      }

      if (spread && spread.ticks > 3) {
        fireAlert(container, {
          type: 'SPREAD_WIDE',
          message: `SPREAD WIDE \u2014 ${spread.ticks} ticks (${spread.pct}%)`,
          price: 0, lot: 0, side: 'bid',
        });
      }
    } catch { /* silent */ }
  };

  window.ObAlerts = {
    initAlertPanel, fireAlert, dismissAlert, clearAlerts, processAlerts,
  };
})();
