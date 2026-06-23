/**
 * control-panel.js — Per-container floating control panel (bottom).
 * Compact metrics bar with expandable feature toggles.
 * Uses reconciliation — no innerHTML rebuilds on every tick.
 */

/* global window, document */

(() => {
  'use strict';

  /** @type {WeakMap<HTMLElement, {panel, metricsEl, cached: Object}>} */
  const panels = new WeakMap();

  const P = 'ob-cp';

  const init = (container) => {
    try {
      if (panels.has(container)) return;

      const panel = buildPanel(container);
      container.style.position = container.style.position || 'relative';
      container.appendChild(panel);

      panels.set(container, { panel, metricsEl: panel.querySelector(`.${P}-metrics`), cached: {} });
      initButtonStates(panel);
    } catch { /* silent */ }
  };

  const destroy = (container) => {
    try {
      const state = panels.get(container);
      if (state?.panel) state.panel.remove();
      panels.delete(container);
    } catch { /* silent */ }
  };

  const updateMetrics = (container, metrics) => {
    try {
      const state = panels.get(container);
      if (!state || !state.metricsEl) return;
      renderCompact(state.metricsEl, metrics, state.cached);
    } catch { /* silent */ }
  };

  // ─── Panel Construction ───

  const buildPanel = (container) => {
    const root = document.createElement('div');
    root.className = `${P}-root`;

    const compact = document.createElement('div');
    compact.className = `${P}-compact`;

    const metricsEl = document.createElement('div');
    metricsEl.className = `${P}-metrics`;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = `${P}-toggle`;
    toggleBtn.textContent = '\u2699';
    toggleBtn.title = 'Toggle overlays';

    compact.appendChild(metricsEl);
    compact.appendChild(toggleBtn);

    const expanded = document.createElement('div');
    expanded.className = `${P}-expanded`;

    const toggles = [
      { key: 'depthBarEnabled', label: 'Depth' },
      { key: 'heatmapEnabled', label: 'Heat' },
      { key: 'imbalanceEnabled', label: 'Imbal' },
      { key: 'spreadBarEnabled', label: 'Spread' },
      { key: 'alertsEnabled', label: 'Alerts' },
      { key: 'pvfEnabled', label: 'PVF' },
    ];

    for (const t of toggles) {
      const btn = document.createElement('button');
      btn.className = `${P}-feat-btn`;
      btn.setAttribute('data-key', t.key);
      btn.textContent = t.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFeature(t.key, btn);
      });
      expanded.appendChild(btn);
    }

    root.appendChild(compact);
    root.appendChild(expanded);
    return root;
  };

  // ─── Compact Metrics (update-in-place, no innerHTML) ───

  const renderCompact = (metricsEl, metrics, cached) => {
    const { imbalance, spread, cumRatio, wallCount, spikeCount } = metrics;

    // Build a simple key to detect changes
    const key = [
      spread?.ticks, spread?.pct,
      imbalance?.lotRatio != null ? Math.round(imbalance.lotRatio * 100) : null,
      cumRatio?.toFixed?.(2),
      wallCount, spikeCount,
    ].join('|');

    if (cached.lastKey === key) return; // skip if nothing changed
    cached.lastKey = key;

    // Rebuild children (metrics are lightweight — max 5 spans)
    metricsEl.innerHTML = '';

    if (spread) {
      const c = spread.ticks > 3 ? '#f85149' : spread.ticks > 1 ? '#d29922' : '#484f58';
      appendMetric(metricsEl, `${spread.ticks}sp`, c);
    }

    if (imbalance) {
      const pct = Math.round(imbalance.lotRatio * 100);
      const c = pct > 60 ? '#3fb950' : pct < 40 ? '#f85149' : '#484f58';
      appendMetric(metricsEl, `${pct}%B`, c);
    }

    if (cumRatio != null) {
      const c = cumRatio > 1.1 ? '#3fb950' : cumRatio < 0.9 ? '#f85149' : '#484f58';
      appendMetric(metricsEl, cumRatio.toFixed(2) + 'R', c);
    }

    if (wallCount > 0) {
      appendMetric(metricsEl, `${wallCount}W`, '#d29922', true);
    }

    if (spikeCount > 0) {
      appendMetric(metricsEl, `${spikeCount}\u{1F525}`, '#e3b341', true);
    }

    if (metricsEl.children.length === 0) {
      appendMetric(metricsEl, '--', '#30363d');
    }
  };

  const appendMetric = (parent, text, color, pulse = false) => {
    const span = document.createElement('span');
    span.className = `${P}-metric` + (pulse ? ` ${P}-metric--alert` : '');
    span.style.color = color;
    span.textContent = text;
    parent.appendChild(span);
  };

  // ─── Feature Toggle ───

  const toggleFeature = (key, btn) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
        chrome.storage.sync.get({ [key]: true }, (result) => {
          const newVal = !result[key];
          chrome.storage.sync.set({ [key]: newVal }, () => {
            btn.classList.toggle(`${P}-feat-btn--off`, !newVal);
            chrome.storage.sync.get({}, (allSettings) => {
              chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'SETTINGS_UPDATED',
                    settings: allSettings,
                  }).catch(() => {});
                }
              });
            });
          });
        });
      }
    } catch { /* silent */ }
  };

  const initButtonStates = (panel) => {
    const btns = panel.querySelectorAll(`.${P}-feat-btn`);
    if (typeof chrome === 'undefined' || !chrome?.storage?.sync) return;

    const keys = Array.from(btns).map(b => b.getAttribute('data-key'));
    const defaults = {};
    for (const k of keys) defaults[k] = true;

    chrome.storage.sync.get(defaults, (result) => {
      for (const btn of btns) {
        const key = btn.getAttribute('data-key');
        if (!result[key]) {
          btn.classList.add(`${P}-feat-btn--off`);
        }
      }
    });
  };

  window.ObControlPanel = { init, destroy, updateMetrics };
})();
