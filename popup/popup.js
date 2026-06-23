/**
 * popup.js — Settings logic for the extension popup.
 * Reads/writes chrome.storage.sync, sends SETTINGS_UPDATED messages.
 */

/* global document, chrome */

(() => {
  'use strict';

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

  const fields = Object.keys(DEFAULT_SETTINGS);

  // ─── Load settings and populate form ───

  const loadSettings = () => {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
        for (const key of fields) {
          const el = document.getElementById(key);
          if (!el) continue;
          if (el.type === 'checkbox') {
            el.checked = !!result[key];
          } else {
            el.value = result[key];
          }
        }
      });
    } catch {
      // Fallback: use defaults
      for (const key of fields) {
        const el = document.getElementById(key);
        if (!el) continue;
        if (el.type === 'checkbox') {
          el.checked = !!DEFAULT_SETTINGS[key];
        } else {
          el.value = DEFAULT_SETTINGS[key];
        }
      }
    }
  };

  // ─── Save a single setting ───

  const saveSetting = (key, value) => {
    try {
      chrome.storage.sync.set({ [key]: value }, () => {
        notifyContentScript();
      });
    } catch {
      // Silently fail
    }
  };

  // ─── Notify content script to re-render ───

  const notifyContentScript = () => {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SETTINGS_UPDATED',
              settings,
            }).catch(() => {
              // Content script may not be loaded on this tab
            });
          }
        });
      });
    } catch {
      // Silently fail
    }
  };

  // ─── Check connection status ───

  const checkStatus = () => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
            const dot = document.getElementById('status');
            if (!dot) return;
            if (response && response.connected) {
              dot.className = 'status-dot status-on';
            } else {
              dot.className = 'status-dot status-off';
            }
          }).catch(() => {
            const dot = document.getElementById('status');
            if (dot) dot.className = 'status-dot status-off';
          });
        }
      });
    } catch {
      const dot = document.getElementById('status');
      if (dot) dot.className = 'status-dot status-off';
    }
  };

  // ─── Reset to defaults ───

  const resetDefaults = () => {
    try {
      chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
        loadSettings();
        notifyContentScript();
      });
    } catch {
      // Silently fail
    }
  };

  // ─── Event bindings ───

  const bindEvents = () => {
    for (const key of fields) {
      const el = document.getElementById(key);
      if (!el) continue;

      if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          saveSetting(key, el.checked);
        });
      } else {
        el.addEventListener('change', () => {
          const num = parseFloat(el.value);
          if (!isNaN(num)) saveSetting(key, num);
        });
      }
    }

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetDefaults);
    }
  };

  // ─── Init ───

  const init = () => {
    loadSettings();
    bindEvents();
    checkStatus();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
