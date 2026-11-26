import { createContext, createElement, useContext, useInsertionEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * Default styles. Colours, radius and spacing are CSS variables, so applications theme the UI (including the
 * context menu) by overriding `--mc-ui-*` on any ancestor. Layout uses logical properties (`inline-start`/
 * `inline-end`), so it mirrors correctly in RTL instead of relying on `direction` alone.
 */
export const UI_CSS = `
.mc-ui, .mc-ui-menu, .mc-ui-dialog-backdrop, .mc-ui-tooltip {
  --mc-ui-bg: #ffffff; --mc-ui-fg: #131722; --mc-ui-muted: #6a6d78; --mc-ui-border: #e0e3eb;
  --mc-ui-hover: #f0f3fa; --mc-ui-active: #e3effd; --mc-ui-accent: #2962ff; --mc-ui-danger: #f23645;
  --mc-ui-radius: 6px; --mc-ui-shadow: 0 6px 24px rgba(0,0,0,.18); --mc-ui-font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif;
  --mc-ui-item-h: 32px; --mc-ui-btn: 34px;
  font: var(--mc-ui-font); color: var(--mc-ui-fg); box-sizing: border-box;
}
[data-mc-theme="dark"].mc-ui, [data-mc-theme="dark"] .mc-ui, .mc-ui-menu[data-mc-theme="dark"], .mc-ui-dialog-backdrop[data-mc-theme="dark"], .mc-ui-tooltip[data-mc-theme="dark"] {
  --mc-ui-bg: #1e222d; --mc-ui-fg: #d1d4dc; --mc-ui-muted: #868993; --mc-ui-border: #363a45;
  --mc-ui-hover: #2a2e39; --mc-ui-active: #1d2a52; --mc-ui-shadow: 0 6px 24px rgba(0,0,0,.5);
}
.mc-ui[data-density="compact"], [data-density="compact"] .mc-ui-menu { --mc-ui-item-h: 26px; --mc-ui-btn: 28px; --mc-ui-font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
.mc-ui *, .mc-ui-menu *, .mc-ui-dialog-backdrop * { box-sizing: border-box; }
.mc-ui-interface { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--mc-ui-bg); border: 1px solid var(--mc-ui-border); border-radius: var(--mc-ui-radius); overflow: hidden; position: relative; }
.mc-ui-body { display: flex; flex: 1; min-height: 0; position: relative; }
.mc-ui-body[data-sidebar-position="end"] { flex-direction: row-reverse; }
.mc-ui-chart { flex: 1; min-width: 0; position: relative; }
.mc-ui-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mc-ui-icon[data-mirror="true"] { transform: scaleX(-1); }
.mc-ui-btn { display: inline-flex; align-items: center; gap: 6px; min-width: var(--mc-ui-btn); height: var(--mc-ui-btn); padding-inline: 8px; border: 0; border-radius: var(--mc-ui-radius); background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; justify-content: center; }
.mc-ui-btn:hover:not(:disabled) { background: var(--mc-ui-hover); }
.mc-ui-btn[aria-pressed="true"], .mc-ui-btn[data-active="true"] { background: var(--mc-ui-active); color: var(--mc-ui-accent); }
.mc-ui-btn:disabled { opacity: .45; cursor: default; }
.mc-ui-btn:focus-visible, .mc-ui-select:focus-visible, .mc-ui-menu-item:focus-visible, .mc-ui-field:focus-visible, .mc-ui-menu-search:focus-visible { outline: 2px solid var(--mc-ui-accent); outline-offset: 1px; }
.mc-ui-select { height: var(--mc-ui-btn); border: 1px solid transparent; border-radius: var(--mc-ui-radius); background: transparent; color: inherit; font: inherit; padding-inline: 6px; cursor: pointer; }
.mc-ui-select:hover { background: var(--mc-ui-hover); }
.mc-ui-select option { background: var(--mc-ui-bg); color: var(--mc-ui-fg); }
.mc-ui-header { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-block-end: 1px solid var(--mc-ui-border); min-height: calc(var(--mc-ui-btn) + 8px); }
.mc-ui-section { display: flex; align-items: center; gap: 2px; min-width: 0; }
.mc-ui-section[data-section="center"] { margin-inline: auto; }
.mc-ui-section[data-section="right"] { margin-inline-start: auto; }
.mc-ui-section[data-section="center"] + .mc-ui-section[data-section="right"] { margin-inline-start: 0; }
.mc-ui-sep { width: 1px; height: 20px; background: var(--mc-ui-border); margin-inline: 4px; flex: none; }
.mc-ui-sidebar { display: flex; flex-direction: column; gap: 2px; padding: 4px; border-inline-end: 1px solid var(--mc-ui-border); overflow-y: auto; flex: none; }
.mc-ui-body[data-sidebar-position="end"] .mc-ui-sidebar { border-inline-end: 0; border-inline-start: 1px solid var(--mc-ui-border); }
.mc-ui-sidebar[data-mode="expanded"] { width: 172px; }
.mc-ui-sidebar[data-mode="expanded"] .mc-ui-btn { justify-content: flex-start; width: 100%; }
.mc-ui-sidebar[data-mode="collapsed"] .mc-ui-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mc-ui-sidebar[data-mode="floating"] { position: absolute; z-index: 5; top: 8px; inset-inline-start: 8px; border: 1px solid var(--mc-ui-border); border-radius: var(--mc-ui-radius); background: var(--mc-ui-bg); box-shadow: var(--mc-ui-shadow); max-height: calc(100% - 16px); }
.mc-ui-sidebar[data-mode="floating"] .mc-ui-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.mc-ui-sidebar .mc-ui-sep { width: auto; height: 1px; margin: 3px 2px; }
.mc-ui-drag { cursor: grab; height: 10px; border-radius: 4px; background: repeating-linear-gradient(90deg, var(--mc-ui-border) 0 2px, transparent 2px 4px); margin: 2px 6px; }
.mc-ui-flyout { position: relative; display: flex; }
.mc-ui-flyout > .mc-ui-btn:first-child { flex: 1; }
.mc-ui-flyout-toggle { position: absolute; inset-block-end: 2px; inset-inline-end: 2px; width: 10px; height: 10px; min-width: 0; padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--mc-ui-muted); cursor: pointer; }
.mc-ui-flyout-toggle::after { content: ""; position: absolute; inset: 2px; border-inline-end: 2px solid currentColor; border-block-end: 2px solid currentColor; }
.mc-ui-flyout-toggle:hover { color: var(--mc-ui-accent); }
.mc-ui-menu { position: fixed; z-index: 10000; min-width: 200px; max-width: min(360px, calc(100vw - 8px)); background: var(--mc-ui-bg); border: 1px solid var(--mc-ui-border); border-radius: var(--mc-ui-radius); box-shadow: var(--mc-ui-shadow); padding: 4px; overflow-y: auto; outline: none; animation: mc-ui-in .12s ease-out; }
.mc-ui-menu[data-touch="true"] { --mc-ui-item-h: 44px; }
.mc-ui-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--mc-ui-item-h); padding-inline: 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.mc-ui-menu-item[data-active="true"] { background: var(--mc-ui-hover); }
.mc-ui-menu-item[aria-disabled="true"] { opacity: .45; cursor: default; }
.mc-ui-menu-item[data-info="true"] { cursor: default; color: var(--mc-ui-muted); font-variant-numeric: tabular-nums; }
.mc-ui-menu-item[data-danger="true"] { color: var(--mc-ui-danger); }
.mc-ui-menu-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-ui-menu-path { display: block; font-size: 11px; color: var(--mc-ui-muted); }
.mc-ui-menu-shortcut { color: var(--mc-ui-muted); font-size: 11px; direction: ltr; unicode-bidi: isolate; }
.mc-ui-menu-check { width: 16px; flex: none; color: var(--mc-ui-accent); }
.mc-ui-menu-sep { height: 1px; margin: 4px 2px; background: var(--mc-ui-border); }
.mc-ui-menu-search { width: 100%; height: 30px; margin-block-end: 4px; padding-inline: 8px; border: 1px solid var(--mc-ui-border); border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.mc-ui-menu-empty { padding: 8px; color: var(--mc-ui-muted); }
.mc-ui-confirm { padding: 8px; display: grid; gap: 8px; max-width: 280px; }
.mc-ui-confirm-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mc-ui-primary { background: var(--mc-ui-accent) !important; color: #fff !important; }
.mc-ui-tooltip { position: fixed; z-index: 10001; pointer-events: none; background: #131722; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; max-width: 260px; }
.mc-ui-tooltip kbd { font: inherit; opacity: .7; margin-inline-start: 8px; direction: ltr; unicode-bidi: isolate; }
.mc-ui-dialog-backdrop { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.4); display: grid; place-items: center; padding: 16px; animation: mc-ui-in .12s ease-out; }
.mc-ui-dialog { background: var(--mc-ui-bg); color: var(--mc-ui-fg); border-radius: 8px; box-shadow: var(--mc-ui-shadow); width: min(760px, 100%); max-height: min(640px, 100%); display: flex; flex-direction: column; overflow: hidden; outline: none; }
.mc-ui-dialog[data-size="small"] { width: min(420px, 100%); }
.mc-ui-dialog-head { display: flex; align-items: center; padding: 12px 16px; border-block-end: 1px solid var(--mc-ui-border); font-weight: 600; font-size: 15px; }
.mc-ui-dialog-head > :first-child { flex: 1; }
.mc-ui-dialog-body { display: flex; min-height: 0; flex: 1; }
.mc-ui-dialog-foot { display: flex; gap: 8px; padding: 10px 16px; border-block-start: 1px solid var(--mc-ui-border); align-items: center; flex-wrap: wrap; }
.mc-ui-dialog-foot > .mc-ui-grow { flex: 1; }
.mc-ui-tabs { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-inline-end: 1px solid var(--mc-ui-border); min-width: 170px; overflow-y: auto; }
.mc-ui-tab { text-align: start; justify-content: flex-start; width: 100%; }
.mc-ui-tab[aria-selected="true"] { background: var(--mc-ui-active); color: var(--mc-ui-accent); }
.mc-ui-panel { flex: 1; overflow-y: auto; padding: 12px 16px; display: grid; gap: 12px; align-content: start; }
.mc-ui-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mc-ui-row > label, .mc-ui-row > .mc-ui-row-label { flex: 1; min-width: 160px; }
.mc-ui-field { height: 30px; border: 1px solid var(--mc-ui-border); border-radius: 4px; background: transparent; color: inherit; font: inherit; padding-inline: 8px; }
.mc-ui-field option { background: var(--mc-ui-bg); color: var(--mc-ui-fg); }
.mc-ui-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.mc-ui-list-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border: 1px solid transparent; border-radius: 4px; }
.mc-ui-list-item:hover { background: var(--mc-ui-hover); }
.mc-ui-list-item[data-dragging="true"] { opacity: .5; }
.mc-ui-list-item[data-drop="true"] { border-color: var(--mc-ui-accent); }
.mc-ui-list-item > .mc-ui-menu-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-ui-list-item[data-hidden] > .mc-ui-menu-label { opacity: .55; }
.mc-ui-tree-value { color: var(--mc-ui-muted); font-variant-numeric: tabular-nums; white-space: nowrap; unicode-bidi: isolate; }
.mc-ui-hint { color: var(--mc-ui-muted); font-size: 12px; margin: 0; }
.mc-ui-legend { position: absolute; top: 4px; z-index: 3; max-width: calc(100% - 90px); display: grid; justify-items: start; gap: 1px; pointer-events: none; font: 12px/1.5 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: var(--mc-ui-fg); text-shadow: 0 0 3px var(--mc-ui-bg), 0 0 3px var(--mc-ui-bg); }
.mc-ui-legend-row { display: flex; align-items: center; flex-wrap: wrap; column-gap: 8px; row-gap: 0; min-height: 22px; padding-inline: 4px; border-radius: 4px; pointer-events: auto; background: color-mix(in srgb, var(--mc-ui-bg) 55%, transparent); }
.mc-ui-legend-row:hover, .mc-ui-legend-row:focus-within { background: color-mix(in srgb, var(--mc-ui-bg) 85%, transparent); }
.mc-ui-legend-row[data-hidden] { opacity: .55; }
.mc-ui-legend-title { font-weight: 600; font-size: 13px; }
.mc-ui-legend-name { color: var(--mc-ui-muted); }
.mc-ui-legend-value { display: inline-flex; gap: 3px; white-space: nowrap; }
.mc-ui-legend-key { color: var(--mc-ui-muted); }
.mc-ui-legend-num { font-variant-numeric: tabular-nums; unicode-bidi: isolate; }
.mc-ui-legend-num[data-trend="up"] { color: #089981; }
.mc-ui-legend-num[data-trend="down"] { color: #f23645; }
.mc-ui-legend-actions { display: inline-flex; gap: 2px; opacity: 0; transition: opacity .1s; }
.mc-ui-legend-row:hover .mc-ui-legend-actions, .mc-ui-legend-row:focus-within .mc-ui-legend-actions { opacity: 1; }
.mc-ui-legend-btn { --mc-ui-btn: 22px; min-width: 22px; height: 22px; padding: 0 3px; pointer-events: auto; }
.mc-ui-legend-toggle { gap: 2px; color: var(--mc-ui-muted); }
.mc-ui-legend-count { font-size: 11px; }
@media (hover: none) { .mc-ui-legend-actions { opacity: 1; } }
.mc-ui-h { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--mc-ui-muted); margin: 6px 0 0; font-weight: 600; }
.mc-ui-kbd { font: 12px ui-monospace, monospace; padding: 2px 6px; border: 1px solid var(--mc-ui-border); border-radius: 4px; min-width: 90px; text-align: center; direction: ltr; unicode-bidi: isolate; }
.mc-ui-side-panel { width: 260px; flex: none; border-inline-start: 1px solid var(--mc-ui-border); overflow-y: auto; padding: 8px; font-size: 12px; }
.mc-ui-body[data-sidebar-position="end"] .mc-ui-side-panel { border-inline-start: 0; border-inline-end: 1px solid var(--mc-ui-border); }
.mc-ui-side-panel table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.mc-ui-side-panel td, .mc-ui-side-panel th { padding: 3px 4px; text-align: start; }
.mc-ui-side-panel td:last-child { text-align: end; }
.mc-ui-toasts { position: absolute; inset-block-end: 12px; inset-inline-start: 50%; transform: translateX(-50%); display: grid; gap: 6px; z-index: 20; pointer-events: none; }
[dir="rtl"] .mc-ui-toasts { transform: translateX(50%); }
.mc-ui-toast { background: #131722; color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; box-shadow: var(--mc-ui-shadow); }
.mc-ui-toast[data-kind="error"] { background: var(--mc-ui-danger); }
.mc-ui-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mc-ui-dialog[data-size="search"] { width: min(560px, 100%); height: min(600px, 100%); }
.mc-ui-dialog[data-size="ticket"] { width: min(380px, 100%); }
.mc-ui-symbols { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.mc-ui-symbols-search { padding: 10px 12px 6px; display: flex; gap: 6px; align-items: center; }
.mc-ui-symbols-search .mc-ui-field { flex: 1; width: 100%; height: 36px; font-size: 14px; }
.mc-ui-symbols-groups { display: flex; gap: 2px; padding: 0 8px 6px; overflow-x: auto; border-block-end: 1px solid var(--mc-ui-border); flex: none; }
.mc-ui-symbols-groups .mc-ui-btn { height: 28px; }
.mc-ui-symbols-list { position: relative; flex: 1; overflow-y: auto; min-height: 120px; outline: none; }
.mc-ui-symbol { position: absolute; inset-inline: 0; display: flex; align-items: center; gap: 8px; padding-inline: 12px; cursor: pointer; }
.mc-ui-symbol[aria-selected="true"] { background: var(--mc-ui-hover); }
.mc-ui-symbol[data-current="true"] .mc-ui-symbol-code { color: var(--mc-ui-accent); }
.mc-ui-symbol[aria-disabled="true"] { opacity: .45; cursor: default; }
.mc-ui-symbol-main { flex: 1; min-width: 0; display: grid; }
.mc-ui-symbol-code { font-weight: 600; unicode-bidi: isolate; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-ui-symbol-name { color: var(--mc-ui-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-ui-symbol-meta { color: var(--mc-ui-muted); font-size: 11px; white-space: nowrap; unicode-bidi: isolate; }
.mc-ui-badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; background: var(--mc-ui-active); color: var(--mc-ui-accent); white-space: nowrap; }
.mc-ui-symbol-icon { width: 20px; height: 20px; border-radius: 50%; flex: none; object-fit: cover; }
.mc-ui-star { min-width: 28px; height: 28px; padding: 0; color: var(--mc-ui-muted); }
.mc-ui-star[aria-pressed="true"] { color: #f5a623; background: transparent; }
.mc-ui-star[aria-pressed="true"] .mc-ui-icon { fill: currentColor; }
.mc-ui-symbols-state { padding: 20px 16px; color: var(--mc-ui-muted); text-align: center; display: grid; gap: 8px; justify-items: center; }
.mc-ui-popover { position: fixed; z-index: 10000; width: min(380px, calc(100vw - 16px)); height: min(420px, calc(100vh - 16px)); background: var(--mc-ui-bg); color: var(--mc-ui-fg); border: 1px solid var(--mc-ui-border); border-radius: var(--mc-ui-radius); box-shadow: var(--mc-ui-shadow); display: flex; flex-direction: column; overflow: hidden; animation: mc-ui-in .12s ease-out; }
.mc-ui-symbol-btn { font-weight: 600; max-width: 220px; }
.mc-ui-symbol-btn > span { overflow: hidden; text-overflow: ellipsis; unicode-bidi: isolate; }
.mc-ui-price-btn { position: absolute; z-index: 4; width: 20px; height: 20px; min-width: 0; padding: 0; border-radius: 4px; background: var(--mc-ui-bg); border: 1px solid var(--mc-ui-border); color: var(--mc-ui-fg); transform: translateY(-50%); }
.mc-ui-price-btn:hover { background: var(--mc-ui-accent) !important; color: #fff; border-color: var(--mc-ui-accent); }
.mc-ui-price-btn .mc-ui-icon { width: 14px; height: 14px; }
.mc-ui-ticket { display: grid; gap: 10px; padding: 12px 16px; overflow-y: auto; }
.mc-ui-ticket-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.mc-ui-ticket-sides .mc-ui-btn { border: 1px solid var(--mc-ui-border); }
.mc-ui-side-btn[data-side="buy"][aria-pressed="true"] { background: #089981 !important; color: #fff !important; border-color: #089981 !important; }
.mc-ui-side-btn[data-side="sell"][aria-pressed="true"] { background: #f23645 !important; color: #fff !important; border-color: #f23645 !important; }
.mc-ui-ticket-field { display: grid; gap: 4px; }
.mc-ui-ticket-field > label { color: var(--mc-ui-muted); font-size: 12px; }
.mc-ui-stepper { display: flex; gap: 2px; align-items: center; }
.mc-ui-stepper .mc-ui-field { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
.mc-ui-error { color: var(--mc-ui-danger); font-size: 12px; }
.mc-ui-simulated { background: #ffb300; color: #131722; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 3px; letter-spacing: .04em; justify-self: start; }
.mc-ui-ticket-status { font-size: 13px; padding: 6px 8px; border-radius: 4px; background: var(--mc-ui-hover); }
.mc-ui-ticket-status[data-status="accepted"] { color: #089981; }
.mc-ui-ticket-status[data-status="rejected"] { color: var(--mc-ui-danger); }
.mc-ui-ticket-summary { font-weight: 600; unicode-bidi: plaintext; }
.mc-ui-tree-row { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 4px; }
.mc-ui-tree-row:focus-within, .mc-ui-tree-row[aria-selected="true"] { background: var(--mc-ui-hover); }
.mc-ui-tree-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
@media (max-width: 640px) {
  .mc-ui-dialog-backdrop:has(.mc-ui-dialog[data-size="search"]), .mc-ui-dialog-backdrop:has(.mc-ui-dialog[data-size="ticket"]) { padding: 0; }
  .mc-ui-dialog[data-size="search"], .mc-ui-dialog[data-size="ticket"] { width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
  .mc-ui-popover { inset: 0 !important; width: auto; height: auto; border-radius: 0; }
  .mc-ui-symbol, .mc-ui-symbols-groups .mc-ui-btn { min-height: 44px; }
}
@keyframes mc-ui-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mc-ui-menu, .mc-ui-dialog-backdrop { animation: none; } }
@media (forced-colors: active) {
  .mc-ui-menu, .mc-ui-dialog, .mc-ui-tooltip, .mc-ui-toast { border: 1px solid CanvasText; }
  .mc-ui-menu-item[data-active="true"], .mc-ui-btn[aria-pressed="true"], .mc-ui-tab[aria-selected="true"] { outline: 2px solid Highlight; }
  .mc-ui-icon { stroke: CanvasText; }
}
@media (max-width: 640px) {
  .mc-ui-body { flex-direction: column-reverse !important; }
  .mc-ui-sidebar[data-mode] { width: auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-inline-end: 0; border-block-start: 1px solid var(--mc-ui-border); position: static; box-shadow: none; }
  .mc-ui-sidebar .mc-ui-sep { width: 1px; height: auto; margin: 2px 3px; }
  .mc-ui-sidebar .mc-ui-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .mc-ui-side-panel { width: auto; max-height: 40%; border-inline-start: 0; border-block-start: 1px solid var(--mc-ui-border); }
  .mc-ui-tabs { flex-direction: row; min-width: 0; overflow-x: auto; border-inline-end: 0; border-block-end: 1px solid var(--mc-ui-border); }
  .mc-ui-dialog-body { flex-direction: column; }
}
`;

const STYLE_ID = 'market-chart-ui-styles';

/**
 * How the UI's stylesheet reaches the page. Under a strict Content-Security-Policy (`style-src` without
 * `'unsafe-inline'`), an injected `<style>` element is blocked unless it carries the page's nonce:
 * - pass `nonce` (the value of your CSP `'nonce-…'` source) and the injected element gets it; or
 * - set `inject: false` and ship `UI_CSS` yourself, e.g. written to a `.css` file at build time and linked
 *   from your own origin (`style-src 'self'`).
 */
export interface UiStylesConfig {
  /** Inject the default stylesheet (default true). */
  readonly inject?: boolean;
  /** CSP nonce for the injected `<style>` element. */
  readonly nonce?: string;
}

const UiStylesContext = createContext<UiStylesConfig>({});

/** Configures style injection (CSP nonce, or no injection) for every market-chart UI component below it. */
export function UiStylesProvider({
  children,
  ...config
}: UiStylesConfig & { readonly children?: ReactNode }) {
  const { inject, nonce } = config;
  const value = useMemo(
    () => ({
      ...(inject !== undefined ? { inject } : {}),
      ...(nonce !== undefined ? { nonce } : {}),
    }),
    [inject, nonce],
  );
  return createElement(UiStylesContext.Provider, { value }, children);
}

/**
 * Injects the default styles once per document (in an effect: never on the server or at import), honouring
 * the nearest `UiStylesProvider` (nonce, or `inject: false`).
 */
export function useUiStyles(enabled = true): void {
  const { inject = true, nonce } = useContext(UiStylesContext);
  const active = enabled && inject;
  useInsertionEffect(() => {
    if (!active) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    // Set before insertion: CSP checks the nonce when the element is connected.
    if (nonce) style.nonce = nonce;
    style.textContent = UI_CSS;
    doc.head.appendChild(style);
  }, [active, nonce]);
}
