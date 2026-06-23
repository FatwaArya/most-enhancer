/**
 * control-panel.js — Per-container floating control panel.
 * Compact metrics bar with expandable feature toggles.
 * Cognitive ergonomics: minimal noise in default state, details on hover.
 * Loaded fourth via manifest.json. Exposes window.ObControlPanel.
 *
 * Emil Kowalski principles applied:
 * - Only animate transform and opacity (GPU)
 * - ease-out for all enter transitions
 * - 150-200ms for UI elements
 * - No animation on keyboard-triggered actions
 * - :active scale(0.97) on pressable elements
 */

/* global window, document */

(() => {
  'use strict';

  /** @type {WeakMap<HTMLElement, {panel: HTMLElement, metrics: Object}>} */
  const panels = new WeakMap();

  const PREFIX = 'ob-cp';

  const init = (container) => {
    try {
      if (panels.has(container)) return;

      const panel = buildPanel(container);
      container.style.position = container.style.position || 'relative';
      container.appendChild(panel);

      panels.set(container, { panel, metrics: {} });

      // Initialize toggle button states from storage
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
      if (!state) return;
      state.metrics = metrics;
      renderCompact(state.panel, metrics);
    } catch { /* silent */ }
  };

  // ─── Panel Construction ───

  const buildPanel = (container) => {
    const root = document.createElement('div');
    root.className = `${PREFIX}-root`;

    // Compact bar (always visible)
    const compact = document.createElement('div');
    compact.className = `${PREFIX}-compact`;

    // Metrics section
    const metricsEl = document.createElement('div');
    metricsEl.className = `${PREFIX}-metrics`;

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = `${PREFIX}-toggle`;
    toggleBtn.textContent = '\u2699';
    toggleBtn.title = 'Toggle overlays';

    compact.appendChild(metricsEl);
    compact.appendChild(toggleBtn);

    // Expanded panel (on hover)
    const expanded = document.createElement('div');
    expanded.className = `${PREFIX}-expanded`;

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
      btn.className = `${PREFIX}-feat-btn`;
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

    // Hover behavior: expand on hover with CSS, no JS animation needed
    // The CSS handles the expand/collapse via :hover

    return root;
  };

  // ─── Compact Metrics Rendering ───

  const renderCompact = (panel, metrics) => {
    const metricsEl = panel.querySelector(`.${PREFIX}-metrics`);
    if (!metricsEl) return;

    const { imbalance, spread, cumRatio, wallCount, spikeCount } = metrics;

    // Build compact metrics line
    let html = '';

    if (spread) {
      const spreadColor = spread.ticks > 3 ? '#f87171' : spread.ticks > 1 ? '#d29922' : '#484f58';
      html += `<span class="${PREFIX}-metric" style="color:${spreadColor}">${spread.ticks}sp</span>`;
    }

    if (imbalance) {
      const pct = Math.round(imbalance.lotRatio * 100);
      const imColor = pct > 60 ? '#4ade80' : pct < 40 ? '#f87171' : '#484f58';
      html += `<span class="${PREFIX}-metric" style="color:${imColor}">${pct}%B</span>`;
    }

    if (cumRatio !== undefined && cumRatio !== null) {
      const rColor = cumRatio > 1.1 ? '#4ade80' : cumRatio < 0.9 ? '#f87171' : '#484f58';
      html += `<span class="${PREFIX}-metric" style="color:${rColor}">${cumRatio.toFixed(2)}R</span>`;
    }

    if (wallCount > 0) {
      html += `<span class="${PREFIX}-metric ${PREFIX}-metric--alert">${wallCount}W</span>`;
    }

    if (spikeCount > 0) {
      html += `<span class="${PREFIX}-metric ${PREFIX}-metric--alert">${spikeCount}\u{1F525}</span>`;
    }

    if (!html) {
      html = `<span class="${PREFIX}-metric" style="color:#30363d">--</span>`;
    }

    metricsEl.innerHTML = html;
  };

  // ─── Feature Toggle ───

  const toggleFeature = (key, btn) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
        chrome.storage.sync.get({ [key]: true }, (result) => {
          const newVal = !result[key];
          chrome.storage.sync.set({ [key]: newVal }, () => {
            btn.classList.toggle(`${PREFIX}-feat-btn--off`, !newVal);
            // Notify content script
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

  // Initialize button states on first hover
  const initButtonStates = (panel) => {
    const btns = panel.querySelectorAll(`.${PREFIX}-feat-btn`);
    if (typeof chrome === 'undefined' || !chrome?.storage?.sync) return;

    const keys = Array.from(btns).map(b => b.getAttribute('data-key'));
    const defaults = {};
    for (const k of keys) defaults[k] = true;

    chrome.storage.sync.get(defaults, (result) => {
      for (const btn of btns) {
        const key = btn.getAttribute('data-key');
        if (!result[key]) {
          btn.classList.add(`${PREFIX}-feat-btn--off`);
        }
      }
    });
  };

  // Expose as globals
  window.ObControlPanel = {
    init,
    destroy,
    updateMetrics,
  };
})();
