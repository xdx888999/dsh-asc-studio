/**
 * Browser half of the App Store copy plugin.
 *
 * One surface: the `dsh-asc-studio` tab body of the native right Sidebar —
 * app picker, per-language listing fields with counters, a store-page
 * preview and a sticky sync button. Settings live in the same tab behind
 * a gear button. All App Store Connect traffic goes through the host
 * half's authenticated `/plugins/dsh-asc-studio/*` routes. Selected keys briefly
 * enter browser memory for upload; stored keys are never returned by the host.
 *
 * NOTE: `LIMITS` / `FIELD_DEFS` / `charCount` / `buildChanges` below preserve
 * the semantics of `lib/shared.js` (the client bundler cannot import it).
 * Keep both copies in sync — `test/diff.test.mjs` guards the host copy.
 *
 * @module dsh-asc-studio/client
 */

window.__ModuleLoader__.load({
	id: 'dsh-asc-studio',
	factory: (require) => {
		const React = require('react')
		/** Short alias for `React.createElement`. */
		const h = React.createElement

		const BASE = '/plugins/dsh-asc-studio'
		const SEAT = 'conversation.input.left'
		const ENTRY_ID = 'dsh-asc-studio-entry'
		const TAB_ID = 'dsh-asc-studio'
		const TAB_KIND = 'dsh-asc-studio'
		const STYLE_ID = 'dsh-asc-studio/panel.css'
		const PLUGIN_VERSION = '0.1.3'

		const CSS = `
.asc-root {
  --asc-primary:#3B5BDB;
  --asc-primary-weak:#EEF2FF;
  --asc-text:var(--dsw-alias-label-primary, #1C1C1E);
  --asc-text-2:var(--dsw-alias-label-secondary, #5B5B60);
  --asc-text-3:var(--dsw-alias-label-tertiary, #9A9AA0);
  --asc-bg:var(--dsw-alias-bg-l1, #F7F7F5);
  --asc-card:var(--dsw-alias-bg-l2, #FFFFFF);
  --asc-fill:var(--dsw-alias-bg-l3, #F3F3F1);
  --asc-line:rgba(0,0,0,0.06);
  --asc-ok:#3A8F5C; --asc-ok-bg:#EEF6F0;
  --asc-warn:#B07D1E; --asc-warn-bg:#FBF4E6;
  --asc-err:#C2463F; --asc-err-bg:#FBEEEC;
  display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--asc-bg); color:var(--asc-text);
  font-family:-apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
  font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
.asc-root[hidden] { display:none; }
.asc-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
.asc-card { background:var(--asc-card); border:1px solid var(--asc-line); border-radius:14px; padding:12px; }
.asc-card-flat { padding:0; overflow:hidden; }
.asc-section-title { font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:var(--asc-text-3); margin:0 2px 6px; }
.asc-head { flex:none; display:flex; align-items:center; gap:8px; padding:10px 12px 6px; }
.asc-head-title { font-size:17px; font-weight:600; letter-spacing:-0.01em; }
.asc-head-actions { margin-left:auto; display:flex; align-items:center; gap:6px; }
.asc-conn { display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--asc-text-3); }
.asc-conn-dot { width:7px; height:7px; border-radius:50%; background:var(--asc-text-3); }
.asc-conn-dot[data-on="true"] { background:var(--asc-ok); box-shadow:0 0 0 3px rgba(58,143,92,0.15); }
.asc-iconbtn {
  display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:9px; border:1px solid transparent;
  background:transparent; color:var(--asc-text-2); cursor:pointer; flex:none;
}
.asc-iconbtn:hover { background:var(--asc-fill); }
.asc-iconbtn:disabled { opacity:0.45; cursor:default; }
.asc-btn {
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  height:32px; padding:0 12px; border-radius:10px; border:1px solid var(--asc-line);
  background:var(--asc-card); color:var(--asc-text); font:inherit; font-size:12.5px;
  cursor:pointer; white-space:nowrap;
}
.asc-btn:hover { background:var(--asc-fill); }
.asc-btn:disabled { opacity:0.45; cursor:default; }
.asc-btn-primary {
  display:flex; align-items:center; justify-content:center; gap:8px;
  width:100%; height:44px; border-radius:10px; border:0;
  background:var(--asc-primary); color:#fff; font:inherit; font-size:14px; font-weight:600;
  cursor:pointer;
}
.asc-btn-primary:disabled { opacity:0.45; cursor:default; }
.asc-btn-ghost { border-color:transparent; background:transparent; color:var(--asc-primary); }
.asc-btn-ghost:hover { background:var(--asc-primary-weak); }
.asc-footer { flex:none; border-top:1px solid var(--asc-line); background:var(--asc-card); padding:10px 12px 12px; display:flex; flex-direction:column; gap:6px; }
.asc-chip { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:999px; font-size:11px; font-weight:600; background:var(--asc-primary-weak); color:var(--asc-primary); font-variant-numeric:tabular-nums; }
.asc-pill { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:999px; font-size:11px; font-weight:600; white-space:nowrap; }
.asc-pill[data-tone="ok"] { background:var(--asc-ok-bg); color:var(--asc-ok); }
.asc-pill[data-tone="warn"] { background:var(--asc-warn-bg); color:var(--asc-warn); }
.asc-pill[data-tone="err"] { background:var(--asc-err-bg); color:var(--asc-err); }
.asc-pill[data-tone="muted"] { background:var(--asc-fill); color:var(--asc-text-2); }
/* ── App 选择卡片 ─────────────────────────────────────────────── */
.asc-appcard { position:relative; }
.asc-approw { display:flex; align-items:center; gap:10px; width:100%; }
.asc-appbtn { display:flex; align-items:center; gap:10px; flex:1; min-width:0; background:transparent; border:0; padding:0; font:inherit; color:inherit; cursor:pointer; text-align:left; }
.asc-avatar { width:40px; height:40px; border-radius:10px; object-fit:cover; flex:none; background:var(--asc-fill); }
.asc-avatar-letter { display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:10px; flex:none; color:#fff; font-weight:700; font-size:17px; }
.asc-appmeta { min-width:0; flex:1; display:flex; flex-direction:column; gap:1px; }
.asc-appname { font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.asc-appsub { font-size:11px; color:var(--asc-text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
.asc-appmenu { position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:60; background:var(--asc-card); border:1px solid var(--asc-line); border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,0.14); max-height:260px; overflow-y:auto; padding:4px; }
.asc-appmenu-item { display:flex; align-items:center; gap:10px; width:100%; border:0; background:transparent; padding:7px 8px; border-radius:9px; font:inherit; color:inherit; cursor:pointer; text-align:left; }
.asc-appmenu-item:hover { background:var(--asc-fill); }
.asc-appmenu-item[aria-selected="true"] { background:var(--asc-primary-weak); }
.asc-appmenu-item .asc-appname { font-size:13px; }
.asc-backdrop { position:fixed; inset:0; z-index:50; background:transparent; }
/* ── 语言分段控件 ─────────────────────────────────────────────── */
.asc-seg { display:flex; gap:2px; background:var(--asc-fill); border-radius:10px; padding:2px; overflow-x:auto; scrollbar-width:none; }
.asc-seg::-webkit-scrollbar { display:none; }
.asc-seg-btn { flex:none; height:26px; padding:0 12px; border-radius:8px; border:0; background:transparent; color:var(--asc-text-2); font:inherit; font-size:12px; cursor:pointer; white-space:nowrap; }
.asc-seg-btn[aria-pressed="true"] { background:var(--asc-card); color:var(--asc-text); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,0.08); }
/* ── 字段 ──────────────────────────────────────────────────────── */
.asc-field { display:flex; flex-direction:column; gap:5px; padding:9px 0; }
.asc-field + .asc-field { border-top:1px solid var(--asc-line); }
.asc-field-head { display:flex; align-items:baseline; gap:8px; }
.asc-field-label { font-size:12px; font-weight:600; color:var(--asc-text-2); }
.asc-counter { margin-left:auto; font-size:11px; color:var(--asc-text-3); font-variant-numeric:tabular-nums; }
.asc-counter[data-over="true"] { color:var(--asc-err); font-weight:700; }
.asc-input, .asc-textarea {
  width:100%; box-sizing:border-box; background:var(--asc-fill); color:var(--asc-text);
  border:1px solid transparent; border-radius:10px; padding:7px 10px;
  font:inherit; font-size:13px;
}
.asc-textarea { resize:vertical; min-height:88px; line-height:1.55; }
.asc-input:focus, .asc-textarea:focus { outline:none; border-color:color-mix(in srgb, var(--asc-primary) 45%, transparent); background:var(--asc-card); }
.asc-input:disabled, .asc-textarea:disabled { opacity:0.55; cursor:not-allowed; }
.asc-input[data-over="true"], .asc-textarea[data-over="true"] { border-color:var(--asc-err); background:var(--asc-err-bg); color:var(--asc-err); }
.asc-ro-note { font-size:11px; color:var(--asc-text-3); }
/* ── 预览（自绘设备框 + 商店页布局） ─────────────────────────── */
.asc-preview-wrap { display:flex; justify-content:center; padding:22px 12px; border-radius:14px; background:#f5f5f7; border:1px solid rgba(0,0,0,.04); }
.asc-preview-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin:0 0 12px; }
.asc-preview-device { color:var(--asc-text-2); font-size:11px; display:flex; align-items:center; gap:6px; }
.asc-preview-caption { font-size:11px; color:var(--asc-text-3); text-align:center; margin:10px 0 0; line-height:1.6; }
/* 自行绘制的通用设备框，不依赖第三方产品图片。 */
.asc-phone { position:relative; width:min(100%,300px); aspect-ratio:1 / 2.04; margin:0 auto; container-type:inline-size; color:#1d1d1f; border-radius:14% / 7%; background:linear-gradient(120deg,#55565b,#202125 35%,#303136 75%,#66676b); box-shadow:0 12px 24px rgba(0,0,0,.13),inset 0 0 0 1px rgba(255,255,255,.2); }
.asc-phone-screen {
  position:absolute; z-index:1; overflow:hidden; background:#ffffff;
  top:1.8%; left:3.4%; right:3.4%; bottom:2%; border-radius:13% / 6%;
  display:flex; flex-direction:column; font-size:3.65cqw; text-align:left;
  /* 屏幕内固定浅色主题（模拟真机截图，不随 DSH 主题变化） */
  --asc-text:#1C1C1E; --asc-text-2:#6E6E73; --asc-text-3:#A1A1A6;
  --asc-fill:#F2F2F4; --asc-card:#FFFFFF; --asc-line:rgba(0,0,0,0.08);
  --asc-primary:#007AFF; --asc-primary-weak:#F1F2F6;
}
.asc-pv-safe-area { height:6cqw; flex:none; }
.asc-pv-symbol { width:1.5em; height:1.5em; display:block; flex:none; }
.asc-pv-body { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:none; padding:0 1.25em 1.4em; }
.asc-pv-body::-webkit-scrollbar,.asc-pv-shots::-webkit-scrollbar { display:none; }
.asc-pv-nav { display:flex; align-items:center; justify-content:space-between; color:var(--asc-primary); height:2.6em; margin-bottom:.4em; }
.asc-pv-nav span { display:flex; align-items:center; gap:.15em; }
.asc-pv-icon { flex:none; width:6.2em; height:6.2em; border-radius:1.4em; object-fit:cover; background:var(--asc-fill); box-shadow:inset 0 0 0 1px rgba(0,0,0,.05); }
span.asc-pv-icon { display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; }
.asc-pv-icon-sm { width:4.5em; height:4.5em; border-radius:1em; }
.asc-pv-asset { border-radius:1em; background:#f5f5f7; display:flex; align-items:center; justify-content:center; color:#86868b; font-size:1em; line-height:1.5; text-align:center; overflow:hidden; }
.asc-pv-head { aspect-ratio:16/9; margin-bottom:1.3em; }
.asc-pv-row { display:flex; align-items:center; gap:1em; }
.asc-pv-meta { flex:1; min-width:0; display:flex; flex-direction:column; gap:.25em; }
.asc-pv-name { font-size:1.65em; font-weight:700; letter-spacing:-.035em; line-height:1.18; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow-wrap:anywhere; }
.asc-pv-sub { font-size:1em; color:var(--asc-text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.asc-pv-get { align-self:flex-start; flex:none; height:2em; padding:0 1.65em; border-radius:2em; background:var(--asc-primary); color:#fff; font-size:1em; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:.45em; }
.asc-pv-get-ghost { align-self:center; margin:0; background:var(--asc-primary-weak); color:var(--asc-primary); padding:0 1.15em; }
.asc-pv-stats { display:flex; margin:1.6em 0; padding:1em 0; border-block:1px solid var(--asc-line); }
.asc-pv-stat { flex:1; min-width:0; text-align:center; font-size:.78em; color:var(--asc-text-3); display:flex; flex-direction:column; gap:.45em; padding:0 .4em; border-right:1px solid var(--asc-line); }
.asc-pv-stat:last-child { border:0; }
.asc-pv-stat b { font-size:1.3em; color:var(--asc-text-2); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.asc-pv-section-title { font-size:1.4em; font-weight:700; letter-spacing:-.025em; margin:1em 0 .65em; }
.asc-pv-shots { display:flex; gap:.65em; overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none; scroll-snap-type:x mandatory; padding:.1em 0 .5em; }
.asc-pv-shot { flex:none; width:56%; height:26em; margin:0; border-radius:1em; overflow:hidden; scroll-snap-align:start; background:var(--asc-fill); }
.asc-pv-shot img { display:block; width:100%; height:100%; object-fit:contain; }
.asc-pv-shots[data-compact="true"] .asc-pv-shot { width:calc((100% - 1.3em) / 3); height:13em; border-radius:.65em; }
.asc-pv-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.7em; min-height:10em; padding:1.5em; border-radius:1em; background:#f7f7f9; color:#86868b; text-align:center; font-size:1em; }
.asc-pv-copy { margin:1.1em 0; font-size:1.05em; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
.asc-pv-description { border-top:1px solid var(--asc-line); padding-top:1em; margin-top:1em; }
.asc-pv-description summary { color:var(--asc-primary); cursor:pointer; font-weight:600; }
.asc-pv-tabs { display:flex; justify-content:space-around; flex:none; border-top:1px solid var(--asc-line); background:rgba(250,250,252,.96); padding:.75em .5em .65em; font-size:.7em; color:#929298; }
.asc-pv-tabs span { display:flex; flex-direction:column; align-items:center; gap:.3em; min-width:3.8em; }
.asc-pv-tabs .asc-pv-symbol { width:2em; height:2em; }
.asc-pv-tabs [data-active="true"] { color:var(--asc-primary); }
.asc-pv-home { flex:none; height:1.1em; background:#fafafc; display:flex; justify-content:center; align-items:flex-start; }
.asc-pv-home::after { content:''; width:34%; height:.3em; border-radius:1em; background:#171719; margin-top:.2em; }
.asc-pv-search-title { font-size:2.2em; letter-spacing:-.045em; font-weight:750; margin:.45em 0 .5em; }
.asc-pv-searchbar { display:flex; align-items:center; gap:.5em; height:2.7em; border-radius:.8em; background:var(--asc-fill); padding:0 .8em; font-size:1.05em; color:#8e8e93; margin-bottom:1.4em; }
.asc-pv-search-row .asc-pv-name { font-size:1.25em; }
.asc-pv-asset-lg { aspect-ratio:16/9; margin:1.1em 0; }
.asc-pv-search-shots { margin-top:1.2em; }
.asc-preview-dialog { box-sizing:border-box; width:min(700px,94vw); max-height:94vh; padding:20px; border:1px solid var(--asc-line); border-radius:20px; background:var(--asc-card); color:var(--asc-text); box-shadow:0 24px 80px #0003; }
.asc-preview-dialog::backdrop { background:rgba(20,20,25,.45); backdrop-filter:blur(8px); }
.asc-preview-dialog .asc-phone { width:min(100%,380px,max(180px,calc((94vh - 210px) / 2.04))); }
.asc-preview-dialog .asc-preview-wrap { padding:16px; }
.asc-preview-dialog-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.asc-root button:focus-visible,.asc-pv-body:focus-visible,.asc-pv-shots:focus-visible { outline:2px solid #007aff; outline-offset:3px; }
/* ── 提交前检查 ────────────────────────────────────────────────── */
.asc-check-row { display:flex; gap:8px; align-items:flex-start; padding:3px 0; font-size:12px; overflow-wrap:anywhere; }
.asc-check-dot { flex:none; width:8px; height:8px; border-radius:50%; margin-top:5px; }
.asc-check-dot[data-level="err"] { background:var(--asc-err); }
.asc-check-dot[data-level="warn"] { background:var(--asc-warn); }
.asc-check-dot[data-level="ok"] { background:var(--asc-ok); }
/* ── 提示卡 ────────────────────────────────────────────────────── */
.asc-notice { display:flex; gap:9px; align-items:flex-start; border-radius:12px; padding:9px 11px; font-size:12px; }
.asc-notice[data-tone="err"] { background:var(--asc-err-bg); color:var(--asc-err); }
.asc-notice[data-tone="ok"] { background:var(--asc-ok-bg); color:var(--asc-ok); }
.asc-notice[data-tone="warn"] { background:var(--asc-warn-bg); color:var(--asc-warn); }
.asc-agent-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.asc-agent-review { border-top:1px solid var(--asc-line); margin-top:10px; padding-top:10px; }
.asc-agent-copy { white-space:pre-wrap; overflow-wrap:anywhere; max-height:180px; overflow:auto; padding:8px; border-radius:8px; background:var(--asc-fill); }
.asc-notice-body { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
.asc-update-notice { align-items:center; justify-content:space-between; flex-wrap:wrap; background:var(--asc-primary-weak); color:var(--asc-primary); }
.asc-update-actions { display:flex; flex-wrap:wrap; gap:8px; }
.asc-update-guide ol { padding-left:20px; }
.asc-update-guide li + li { margin-top:8px; }
.asc-coming { display:flex; align-items:center; gap:10px; color:var(--asc-text-3); }
.asc-coming-title { font-size:12.5px; font-weight:600; color:var(--asc-text-2); }
.asc-coming-sub { font-size:11px; }
/* ── 设置页 ────────────────────────────────────────────────────── */
.asc-steps { display:flex; flex-direction:column; gap:9px; margin:2px 0 0; padding:0; list-style:none; }
.asc-step { display:flex; gap:9px; font-size:12.5px; color:var(--asc-text-2); }
.asc-step-no { flex:none; width:20px; height:20px; border-radius:50%; background:var(--asc-primary-weak); color:var(--asc-primary); font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:1px; }
.asc-form { display:flex; flex-direction:column; gap:10px; }
.asc-form-row { display:flex; flex-direction:column; gap:5px; }
.asc-filebtn { display:flex; align-items:center; gap:8px; height:36px; padding:0 12px; border-radius:10px; border:1px dashed color-mix(in srgb, var(--asc-primary) 40%, transparent); background:var(--asc-primary-weak); color:var(--asc-primary); font-size:12.5px; cursor:pointer; justify-content:center; }
.asc-filehint { font-size:11px; color:var(--asc-text-3); overflow-wrap:anywhere; }
.asc-settings-footer { flex:none; padding:8px 12px calc(8px + env(safe-area-inset-bottom)); text-align:center; font-size:11px; color:var(--asc-text-3); font-variant-numeric:tabular-nums; }
.asc-storage-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:12px 0; }
.asc-storage-stat { padding:9px; border-radius:9px; background:var(--asc-fill); min-width:0; }
.asc-storage-stat strong { display:block; font-size:15px; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.asc-storage-stat span { font-size:11px; color:var(--asc-text-3); }
.asc-storage-path { display:block; margin:8px 0; padding:8px; border-radius:8px; background:var(--asc-fill); font-size:10px; overflow-wrap:anywhere; user-select:all; }
.asc-storage-actions { display:flex; flex-wrap:wrap; gap:7px; margin:10px 0; }
.asc-storage-manage { display:flex; align-items:center; gap:5px; padding:6px 0; border:0; background:none; color:var(--asc-primary); font:inherit; font-size:12px; cursor:pointer; }
.asc-storage-manage:disabled { opacity:.5; cursor:default; }
.asc-storage-app { display:flex; gap:8px; justify-content:space-between; align-items:center; border-top:1px solid var(--asc-line); padding:8px 0; font-size:12px; }
.asc-storage-app-name { min-width:0; overflow-wrap:anywhere; }
.asc-storage-app .asc-btn { flex:none; }
.asc-storage-app small { display:block; color:var(--asc-text-3); }
.asc-storage-section { border-top:1px solid var(--asc-line); margin-top:12px; padding-top:12px; }
.asc-storage-confirm { box-sizing:border-box; width:min(420px,92vw); max-height:85vh; padding:0; border:1px solid var(--asc-line); border-radius:16px; background:var(--asc-card); color:var(--asc-text); }
.asc-storage-confirm::backdrop { background:rgba(0,0,0,.4); }
.asc-storage-confirm .asc-modal-body { white-space:pre-line; font-size:12.5px; line-height:1.65; }
/* ── 对比弹窗 ──────────────────────────────────────────────────── */
.asc-overlay { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,0.38); display:flex; align-items:center; justify-content:center; padding:20px; }
.asc-modal { width:100%; max-width:420px; max-height:80%; display:flex; flex-direction:column; background:var(--asc-card); border-radius:16px; box-shadow:0 18px 50px rgba(0,0,0,0.25); overflow:hidden; }
.asc-modal-head { padding:14px 16px 8px; }
.asc-modal-title { font-size:15px; font-weight:600; }
.asc-modal-sub { font-size:12px; color:var(--asc-text-3); margin-top:2px; }
.asc-modal-body { flex:1; min-height:0; overflow-y:auto; padding:4px 16px; display:flex; flex-direction:column; gap:8px; }
.asc-modal-foot { flex:none; display:flex; gap:8px; padding:12px 16px 14px; }
.asc-diff { background:var(--asc-fill); border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; gap:4px; }
.asc-diff-head { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--asc-text-3); }
.asc-diff-field { font-size:12px; font-weight:600; color:var(--asc-text-2); }
.asc-diff-old { font-size:12px; color:var(--asc-text-3); overflow-wrap:anywhere; white-space:pre-wrap; max-height:160px; overflow:auto; }
.asc-diff-new { font-size:12.5px; color:var(--asc-text); overflow-wrap:anywhere; white-space:pre-wrap; max-height:96px; overflow:auto; }
.asc-diff-arrow { color:var(--asc-primary); font-weight:700; }
.asc-result-row { display:flex; flex-direction:column; gap:3px; border-radius:10px; padding:7px 10px; background:var(--asc-fill); font-size:12px; }
.asc-result-row[data-ok="false"] { background:var(--asc-err-bg); color:var(--asc-err); }
.asc-result-row[data-ok="true"] { color:var(--asc-ok); }
.asc-empty { padding:26px 12px; text-align:center; color:var(--asc-text-3); }
.asc-spin { width:12px; height:12px; border-radius:50%; border:1.5px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color:currentColor; animation:asc-spin 720ms linear infinite; flex:none; }
@keyframes asc-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .asc-spin { animation-duration: 2s; } }
`

		// ── 与 lib/shared.js 逐字一致的副本（client 打包环境无法 import ESM）──

		const LIMITS = Object.freeze({
			name: 30,
			subtitle: 30,
			keywords: 100,
			promotionalText: 170,
			description: 4000,
			whatsNew: 4000
		})

		const FIELD_DEFS = Object.freeze([
			{ key: 'name', target: 'appInfoLocalization', limit: LIMITS.name, multiline: false },
			{ key: 'subtitle', target: 'appInfoLocalization', limit: LIMITS.subtitle, multiline: false },
			{ key: 'keywords', target: 'appStoreVersionLocalization', limit: LIMITS.keywords, multiline: false },
			{ key: 'promotionalText', target: 'appStoreVersionLocalization', limit: LIMITS.promotionalText, multiline: false },
			{ key: 'description', target: 'appStoreVersionLocalization', limit: LIMITS.description, multiline: true },
			{ key: 'whatsNew', target: 'appStoreVersionLocalization', limit: LIMITS.whatsNew, multiline: true }
		])

		const EDITABLE_VERSION_STATES = Object.freeze(new Set([
			'PREPARE_FOR_SUBMISSION',
			'DEVELOPER_REJECTED',
			'REJECTED',
			'METADATA_REJECTED'
		]))

		/** @param {string} state - appStoreState。 @returns {boolean} 是否可编辑。 */
		function isVersionEditable(state) {
			return EDITABLE_VERSION_STATES.has(String(state ?? ''))
		}

		/** @param {string} value - 文本。 @returns {number} Unicode 码点数。 */
		function charCount(value) {
			if (value === undefined || value === null) return 0
			let count = 0
			for (const _ of String(value)) count += 1
			return count
		}

		/** @param {string} field - 字段名。 @param {string} value - 值。 @returns {boolean} 是否超限。 */
		function isOverLimit(field, value) {
			const limit = LIMITS[field]
			if (limit === undefined) return false
			return charCount(value) > limit
		}

		/**
		 * 面板草稿 → 改动清单（与 lib/shared.js 的 buildChanges 语义一致）。
		 * @param {object[]} locales - 详情里的语言数组。
		 * @param {Record<string, Record<string, string>>} drafts - 草稿。
		 * @returns {object[]} 改动列表。
		 */
		function buildChanges(locales, drafts) {
			const changes = []
			for (const entry of Array.isArray(locales) ? locales : []) {
				const draft = drafts?.[entry.locale]
				if (draft === undefined || draft === null) continue
				for (const def of FIELD_DEFS) {
					if (!(def.key in draft)) continue
					const targetId = def.target === 'appInfoLocalization' ? entry.appInfoLocId : entry.versionLocId
					if (typeof targetId !== 'string' || targetId === '') continue
					const newValue = String(draft[def.key] ?? '')
					const oldValue = String(entry[def.key] ?? '')
					if (newValue === oldValue) continue
					changes.push({ locale: entry.locale, field: def.key, target: def.target, id: targetId, oldValue, newValue })
				}
			}
			changes.sort((left, right) => left.locale.localeCompare(right.locale) || left.field.localeCompare(right.field))
			return changes
		}

		/** @param {object[]} changes - 改动列表。 @returns {boolean} 是否有超限项。 */
		function hasOverLimitChange(changes) {
			return changes.some((change) => isOverLimit(change.field, change.newValue))
		}

		// ── 文案与展示辅助 ─────────────────────────────────────────────

		// 保留原有语言偏好键，改包名后继续使用用户已选的界面语言。
		const LANGUAGE_STORAGE_KEY = 'dsh-asc.ui-language'
		const LANGUAGE_OPTIONS = ['auto', 'zh', 'en']
		const PREVIEW_CACHE_BUSTER = window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
		const languageListeners = new Set()
		let languageProfileId = ''
		let nativeLanguage = ''
		let nativeLanguageRevision = 0
		const languageStorageKey = (profileId = languageProfileId) => profileId ? `${LANGUAGE_STORAGE_KEY}:${profileId}` : LANGUAGE_STORAGE_KEY
		function readLanguagePreference() {
			try {
				const saved = window.localStorage.getItem(languageStorageKey())
				return LANGUAGE_OPTIONS.includes(saved) ? saved : 'auto'
			} catch { return 'auto' }
		}
		let languagePreference = readLanguagePreference()
		function resolvedLanguage() {
			if (languagePreference !== 'auto') return languagePreference
			const language = nativeLanguage || navigator.languages?.[0] || navigator.language || 'en'
			return String(language).toLowerCase().startsWith('zh') ? 'zh' : 'en'
		}
		const languageSnapshot = () => `${languagePreference}:${resolvedLanguage()}:${languageProfileId}`
		const notifyLanguage = () => languageListeners.forEach((listener) => listener())
		async function refreshNativeLanguage() {
			// 桌面内置 Chromium 的语言可能固定为英文；系统语言由 DSH 原生桥提供。
			const bridge = window.__DSH_LOCALE__
			if (typeof bridge?.read !== 'function') return
			const revision = ++nativeLanguageRevision
			try {
				const value = await bridge.read()
				const language = Array.isArray(value?.languages)
					? value.languages.find((item) => typeof item === 'string' && item.trim())?.trim() : ''
				if (revision !== nativeLanguageRevision || languageListeners.size === 0 || !language || language === nativeLanguage) return
				nativeLanguage = language
				notifyLanguage()
			} catch { /* 原生桥不可用时沿用已知语言；首次读取失败则使用浏览器语言。 */ }
		}
		function onSystemLanguageChange() {
			notifyLanguage()
			void refreshNativeLanguage()
		}
		function setLanguageScope(profileId) {
			const next = typeof profileId === 'string' ? profileId : ''
			if (next === languageProfileId) return
			languageProfileId = next
			languagePreference = readLanguagePreference()
			notifyLanguage()
		}
		function clearLanguagePreference(profileId) {
			try { window.localStorage.removeItem(languageStorageKey(profileId)) } catch { /* 浏览器禁止存储时仍重置当前会话。 */ }
			if (profileId !== languageProfileId) return
			languagePreference = 'auto'
			notifyLanguage()
		}
		function onLanguageStorage(event) {
			if (event.key !== languageStorageKey() && event.key !== null) return
			languagePreference = readLanguagePreference()
			notifyLanguage()
		}
		function subscribeLanguage(listener) {
			languageListeners.add(listener)
			if (languageListeners.size === 1) {
				window.addEventListener('storage', onLanguageStorage)
				window.addEventListener('languagechange', onSystemLanguageChange)
				window.addEventListener('focus', refreshNativeLanguage)
				void refreshNativeLanguage()
			}
			return () => {
				languageListeners.delete(listener)
				if (languageListeners.size === 0) {
					window.removeEventListener('storage', onLanguageStorage)
					window.removeEventListener('languagechange', onSystemLanguageChange)
					window.removeEventListener('focus', refreshNativeLanguage)
					nativeLanguageRevision += 1
				}
			}
		}
		function setLanguagePreference(value) {
			if (!LANGUAGE_OPTIONS.includes(value)) return false
			languagePreference = value
			let saved = true
			try { window.localStorage.setItem(languageStorageKey(), value) } catch { saved = false }
			notifyLanguage()
			return saved
		}

		const STR = {
			zh: {
				title: 'App Store Connect',
				connected: 'ASC 已连接',
				notConnected: '未连接',
				settings: '设置',
				updateTitle: '版本更新', updateCheck: '检查更新', updateChecking: '正在检查…', updateGuide: '更新指引',
				updateCurrent: (version) => `当前版本 v${version}`, updateAvailable: (version) => `发现新版本 v${version}`,
				updateLatest: '当前已是最新版本', updateFailed: '暂时无法检查更新，请稍后重试。',
				updateChecked: (time) => `上次检查：${time}`, updateHint: '打开面板时自动检查，检查结果缓存 6 小时。',
				updatePrivacy: '仅查询 npm 的公开版本信息，不发送 ASC 账号、文案或图片。',
				updateGuideSteps: ['先处理未同步的文案，并等待图片上传完成。', '在 DSH 的「插件」页面卸载 ASC Studio。', '选择「添加插件」，输入以下包名重新安装：'],
				updateKeepData: '从 DSH 插件管理页卸载会保留账号凭据和本机图片。',
				updateAvoidCleanup: '请勿使用 ASC Studio 内的「清理并卸载插件」，该操作会删除本机数据和凭据。',
				updateClose: '知道了',
				agentHint: '在当前 DSH 会话中，让 Agent 生成并填写文案；审核后再同步到 ASC。',
				agentNoSession: '请在项目会话中打开面板，以接收 Agent 草稿。', agentUnavailable: '当前宿主暂不支持 Agent 草稿。',
				agentWaiting: '等待当前会话的 Agent 草稿', agentRefresh: '刷新草稿', agentView: '查看 Agent 草稿',
				agentPending: (count) => `${count} 份 Agent 草稿待处理`, agentApplied: (count) => `已填入 ${count} 处建议，请审核后同步。`,
				agentKeep: '保留当前内容并忽略建议', agentAckFailed: '草稿已处理，但回执未保存；刷新时会重试，不会重复填入。',
				agentSwitchBlocked: '请先处理当前 App 的未同步草稿，再切换到建议的 App。',
				agentConflict: '以下建议未自动填入：', agentLocalConflict: '当前已有手动草稿', agentRemoteConflict: 'ASC 文案已变化',
				agentTargetConflict: 'App、版本或语言资源已变化', agentReadonly: '当前字段不可编辑', agentInvalid: '建议内容无效或超出长度限制',
				agentLoadFailed: '暂时无法核对 ASC 文案，请稍后点击「刷新草稿」重试。',

				interfaceLanguage: '界面语言', followSystem: '跟随系统',
				languageHint: '立即生效并保存在当前浏览器；不改变 App Store 文案的语言。',
				languageSaveError: '语言已切换，但浏览器未允许保存设置，下次打开时可能需要重新选择。',
				storageTitle: '本机存储', storageProfile: '当前环境', storageTotal: '总占用', storageImages: '预览图片', storageRecords: '同步记录',
				storageImageCount: (count) => `${count} 张图片`, storageRecordCount: (count) => `${count} 条记录`,
				storageRemoteSafe: '这些操作仅影响当前环境的本机数据，不会删除 ASC 后台素材。',
				storageOpen: '打开目录', storageClearAll: '清理预览图片', storageClearApp: '清理', storageManageApps: '按 App 管理',
				storageNoImages: '当前没有本机预览图片。', storageRetainRecords: '清理当前环境中所有 App 的本机预览图片，保留同步记录和账号凭据。',
				storageDisconnect: '断开 ASC 账号', storageDisconnected: '当前未连接 ASC 账号。',
				storageDisconnectHint: '删除当前环境保存的凭据及钥匙串项；保留预览图片和同步记录。',
				storageLegacy: '发现旧版共享数据', storageImport: '导入到当前环境', storageImportHint: '导入旧共享数据并保留源文件，不影响其他环境。',
				storageImportBlocked: '仅可导入到没有本机数据的环境。请先清理当前环境的数据并断开账号。',
				storageUninstall: '卸载前先清理', storagePrepare: '清理并准备卸载',
				storageUninstallNow: '清理并卸载插件',
				storageUninstallFailed: '本机数据可能已经清理，但插件尚未卸载。请在 DSH 的插件管理中完成卸载。',
				storageManualUninstall: '当前宿主未提供自动卸载清理。直接从 DSH 卸载不会清理本机数据与界面语言偏好，请先使用下方清理按钮。',
				storageAutoUninstall: '宿主支持卸载时清理当前环境的本机数据，也可在此提前清理。',
				storageConfirmTitle: '确认本机数据操作', storageConfirm: '确认执行', storageWorking: '正在处理…', storageDone: '本机数据操作已完成。',
				storageClearConfirm: (appLabel, count, bytes) => `将清理${appLabel ? `「${appLabel}」的` : '当前环境全部'}本机预览图片（${count} 张，${bytes}）。\n同步记录和账号凭据会保留。`,
				storageDisconnectConfirm: '将删除当前环境保存的 ASC 账号凭据及钥匙串项，并断开连接。\n预览图片和同步记录会保留。重新连接需要提供密钥。',
				storagePrepareConfirm: '将删除当前环境的本机预览图片、同步记录、界面语言偏好和账号凭据（含钥匙串项）。\n删除同步记录后，将失去当前环境的素材同步与失败恢复记录。此操作无法在插件内撤销。\n清理完成后，请在 DSH 的插件管理中卸载插件。',
				storageUninstallConfirm: '将删除当前环境的本机预览图片、同步记录、界面语言偏好和账号凭据（含钥匙串项），随后从 DSH 卸载此插件。\n删除同步记录后，将失去当前环境的素材同步与失败恢复记录。此操作无法在插件内撤销。\n卸载后插件面板将关闭。',
				fileReadError: '读取文件失败', appMismatch: '返回的 App 与当前选择不匹配，请刷新重试。',
				back: '返回',
				refresh: '刷新',
				loading: '加载中…',
				chooseApp: '选择 App',
				discardDraftTitle: '放弃未同步的修改？',
				discardDraftMessage: (name) => `当前 App 的修改尚未同步。切换到“${name}”会放弃这些修改。`,
				keepEditing: '继续编辑', discardAndSwitch: '放弃并切换',
				previousText: '原文（可滚动查看全文）', nextText: '修改后（可滚动查看全文）',
				noApps: '账号下没有可见的 App',
				language: '语言',
				fields: '上架信息',
				preview: '商店页预览',
				pvProduct: '产品页',
				pvSearch: '搜索结果',
				pvExpand: '设备浏览', pvClose: '关闭预览', pvVersion: '版本', pvLanguage: '语言',
				pvBrowseHint: '可在设备内滚动，横向浏览截图。预览仅供参考，以 App Store 实际展示为准。',
				pvAssetHint: '未添加创意素材时使用普通商店布局；可在下方上传头图或搜索素材。',
				pvNoShots: '暂无可预览的 iPhone 截图', pvShotsError: '截图暂时无法加载',
				pvShot: (n) => `App 截图 ${n}`, pvImageError: '图片暂时无法显示', pvDescription: 'App 简介',
				pvScreenshots: '预览', pvShotCount: '截图', pvWhatsNew: '新功能',
				pvSourceRemote: 'ASC 现有素材', pvSourceLocal: '本机素材', pvRemoteLoading: '正在读取 ASC 素材…',
				pvRemoteError: 'ASC 素材读取失败', pvRemoteImageError: 'ASC 素材图片加载失败，请刷新后重试。',
				get: '获取',
				pvSearchPlaceholder: '搜索',
				pvCategory: '分类｜开发者',
				pvHeaderPh: '产品页头图素材\n（尚未上传：点下方「上传素材」选择本地成图，仅存本机用于预览）',
				pvSearchPh: '搜索结果素材\n（尚未上传：点下方「上传素材」选择本地成图，仅存本机用于预览）',
				pvUpload: '上传素材',
				pvReplace: '更换素材',
				pvRemove: '移除本机素材',
				pvLoadError: '预览图片加载失败，本机素材仍保留，可刷新重试。',
				pvWithdraw: '从 ASC 撤回',
				shotsTitle: '截图',
				shotsUpload: '上传截图',
				shotsAuto: '设备规格：自动识别',
				shotsNoType: '无法从尺寸识别设备规格，请在右上角手动选择',
				shotsReadOnly: '当前版本不可编辑，截图仅可查看',
				shotsEmpty: '该语言还没有截图',
				shotsDelete: '删除截图',
				shotsReadErr: '无法读取图片尺寸',
				shotsDuoHint: '设备规格按像素尺寸自动识别（横竖屏都支持）：iPhone Duo、6.9"/6.5"/6.1"、iPad 13"/11" 等；无法识别时在右上角手动选择。',
				pvSync: '同步到 ASC',
				pvResync: '重新同步到 ASC',
				pvSyncing: '同步中…',
				pvAscState: 'ASC 状态',
				pvRefreshState: '刷新状态',
				pvStats: ['评分', '年龄分级', '开发者', '语言'],
				pvTabs: ['今天', '游戏', 'App', 'Arcade', '搜索'],
				screenshots: '截图状态',
				checks: '提交前检查',
				checksRun: '运行检查',
				checksRunning: '检查中…',
				checksHint: '点击「运行检查」：对当前版本的文案完整性与截图做只读规则检查。',
				comingSoon: '即将推出',
				sync: '同步到 App Store Connect',
				syncChanges: (n) => `${n} 处改动`,
				overLimitBlocked: '有字段超出字数上限，修改后再同步',
				noChanges: '暂无改动',
				fieldLabels: {
					name: '名称', subtitle: '副标题', keywords: '关键词（逗号分隔）',
					description: '描述', whatsNew: '更新说明（What’s New）', promotionalText: '推广文本'
				},
				stateNames: {
					PREPARE_FOR_SUBMISSION: '准备提交', DEVELOPER_REJECTED: '开发者已拒绝', REJECTED: '已被拒绝',
					METADATA_REJECTED: '元数据被拒', WAITING_FOR_REVIEW: '等待审核', IN_REVIEW: '审核中',
					PENDING_DEVELOPER_RELEASE: '待发布', PROCESSING_FOR_APP_STORE: '处理中', READY_FOR_SALE: '可供销售',
					REPLACED_WITH_NEW_VERSION: '已被新版本替换', DEVELOPER_REMOVED_FROM_SALE: '已下架', REMOVED_FROM_SALE: '已下架'
				},
				promoOnlyNote: '当前版本不可编辑，仅「推广文本」可以随时更新。',
				versionLockedNote: '当前版本（已上架）不可编辑：在 ASC 创建新版本后即可修改，仅「推广文本」可随时更新。',
				infoLockedNote: 'App 信息当前不可编辑：名称/副标题需要在 ASC 创建新版本（准备提交）后才能修改。',
				noVersionNote: '该 App 还没有 iOS 版本，暂不可编辑版本文案。',
				readOnlyNote: '该语言没有对应资源的写入权限或资源不存在。',
				diffTitle: '确认同步以下改动',
				diffSub: (n) => `共 ${n} 条改动，将逐条写入 App Store Connect`,
				oldValue: '现值',
				newValue: '新值',
				cancel: '取消',
				confirmSync: '确认同步',
				syncing: '同步中…',
				syncDone: (ok, fail) => fail === 0 ? `已同步 ${ok} 条改动` : `成功 ${ok} 条，失败 ${fail} 条`,
				done: '完成',
				failedKeep: '失败条目仍保留在编辑框中，可修改后重试。',
				needConfig: '尚未配置 App Store Connect API 密钥',
				configRecovery: '凭据的安全保存或迁移尚未完成。请解锁钥匙串后刷新；如仍失败，请重新上传 .p8 后保存，或断开账号后重新配置。',
				needConfigGo: '去设置',
				configTitle: '连接 App Store Connect',
				guideTitle: '生成 API 密钥（5 步）',
				steps: [
					'登录 appstoreconnect.apple.com',
					'打开「用户和访问」',
					'切换到「集成」标签页',
					'左侧选择「App Store Connect API」，点加号生成密钥（角色选 App Manager 或 Admin）',
					'下载 .p8 私钥（只能下载一次），并记下 Issuer ID 与 Key ID'
				],
				issuerId: 'Issuer ID',
				keyId: 'Key ID',
				issuerPlaceholder: '形如 57246542-96fe-1a63-e053-0824d011072a',
				keyIdPlaceholder: '形如 ABC123DEFG',
				uploadP8: '选择 .p8 私钥文件',
				uploaded: (name) => `已上传 ${name}`,
				p8Hint: '私钥仅保存到本机 macOS 钥匙串，用于本地签名。钥匙串不可用时停止保存，不转存未加密文件。',
				keepStoredKey: '将沿用已保存的私钥',
				test: '测试连接',
				testing: '测试中…',
				save: '保存',
				saving: '保存中…',
				testOk: (n) => `连接成功，账号下可见 ${n} 个 App`,
				testNoApp: '连接成功，但账号下没有可见的 App（密钥可能没有 App 访问权限）',
				savedOk: '已保存',
				configuredOn: '已配置',
				storageKeychain: '私钥保存在 macOS 钥匙串',
				storageFile: '私钥尚未迁移到安全存储，请刷新后重试',
				footer: `dsh-asc-studio · v${PLUGIN_VERSION}`,
				openPanel: '打开 App Store 文案面板',
				errNeedAll: '请填写 Issuer ID、Key ID，并上传 .p8（或沿用已保存的私钥）',
				errP8: '.p8 文件内容不是有效的 PEM 私钥'
			},
			en: {
				title: 'App Store Connect',
				connected: 'ASC connected',
				notConnected: 'Not connected',
				settings: 'Settings',
				updateTitle: 'Updates', updateCheck: 'Check for updates', updateChecking: 'Checking…', updateGuide: 'How to update',
				updateCurrent: (version) => `Installed version v${version}`, updateAvailable: (version) => `Version ${version} is available`,
				updateLatest: 'You’re up to date', updateFailed: 'Could not check for updates. Try again later.',
				updateChecked: (time) => `Last checked: ${time}`, updateHint: 'Checks when the panel opens. Results are cached for 6 hours.',
				updatePrivacy: 'Only public npm version information is requested. ASC credentials, copy, and images are not sent.',
				updateGuideSteps: ['Handle unsynced edits and wait for image uploads to finish.', 'Uninstall ASC Studio from DSH’s Plugins page.', 'Choose Add plugin and reinstall with this package name:'],
				updateKeepData: 'Uninstalling from DSH’s plugin manager preserves credentials and local images.',
				updateAvoidCleanup: 'Do not use “Clean up and uninstall plugin” inside ASC Studio. That action deletes local data and credentials.',
				updateClose: 'Got it',
				agentHint: 'Ask Agent in this DSH conversation to generate and fill copy. Review it before syncing to ASC.',
				agentNoSession: 'Open this panel in a project conversation to receive Agent drafts.', agentUnavailable: 'This host does not support Agent drafts yet.',
				agentWaiting: 'Waiting for Agent drafts from this conversation', agentRefresh: 'Refresh drafts', agentView: 'View Agent drafts',
				agentPending: (count) => `${count} Agent draft${count === 1 ? '' : 's'} pending`, agentApplied: (count) => `Filled ${count} suggestion${count === 1 ? '' : 's'}. Review before syncing.`,
				agentKeep: 'Keep current copy and ignore suggestions', agentAckFailed: 'Draft handled, but its receipt could not be saved. Refresh to retry; copy will not be filled again.',
				agentSwitchBlocked: 'Handle the current app’s unsynced drafts before switching to the suggested app.',
				agentConflict: 'These suggestions were not filled:', agentLocalConflict: 'A manual draft already exists', agentRemoteConflict: 'ASC copy has changed',
				agentTargetConflict: 'The app, version, or localization has changed', agentReadonly: 'This field is currently read-only', agentInvalid: 'The suggestion is invalid or exceeds its limit',
				agentLoadFailed: 'Could not recheck ASC copy. Use Refresh drafts to try again.',

				interfaceLanguage: 'Interface language', followSystem: 'Follow system',
				languageHint: 'Applies immediately and is saved in this browser. App Store listing languages stay unchanged.',
				languageSaveError: 'Language changed, but your browser could not save the preference. You may need to select it again next time.',
				storageTitle: 'Local storage', storageProfile: 'Current profile', storageTotal: 'Total size', storageImages: 'Preview images', storageRecords: 'Sync records',
				storageImageCount: (count) => `${count} image${count === 1 ? '' : 's'}`, storageRecordCount: (count) => `${count} record${count === 1 ? '' : 's'}`,
				storageRemoteSafe: 'These actions affect local data in this profile only. They do not delete assets from App Store Connect.',
				storageOpen: 'Open directory', storageClearAll: 'Clear preview images', storageClearApp: 'Clear', storageManageApps: 'Manage by app',
				storageNoImages: 'No local preview images.', storageRetainRecords: 'Clear local preview images for all apps in this profile. Sync records and account credentials are kept.',
				storageDisconnect: 'Disconnect ASC account', storageDisconnected: 'No ASC account is connected.',
				storageDisconnectHint: 'Remove this profile’s saved credentials and Keychain entry. Keep preview images and sync records.',
				storageLegacy: 'Legacy shared data found', storageImport: 'Import into this profile', storageImportHint: 'Import legacy shared data and keep the source files. Other profiles are not affected.',
				storageImportBlocked: 'Import requires an empty profile. Clear this profile’s local data and disconnect its account first.',
				storageUninstall: 'Clean up before uninstalling', storagePrepare: 'Clean up for uninstall',
				storageUninstallNow: 'Clean up and uninstall plugin',
				storageUninstallFailed: 'Local data may already be cleared, but the plugin is still installed. Finish uninstalling it in DSH’s plugin manager.',
				storageManualUninstall: 'This host does not provide automatic uninstall cleanup. Uninstalling directly from DSH will leave local data and interface language preferences behind. Use the cleanup button below first.',
				storageAutoUninstall: 'The host can clean up this profile’s local data during uninstall. You can also clean up here first.',
				storageConfirmTitle: 'Confirm local data action', storageConfirm: 'Confirm action', storageWorking: 'Working…', storageDone: 'Local data action completed.',
				storageClearConfirm: (appLabel, count, bytes) => `Remove ${appLabel ? `“${appLabel}”’s` : 'all of this profile’s'} local preview images (${count} images, ${bytes}).\nSync records and account credentials will be kept.`,
				storageDisconnectConfirm: 'Remove this profile’s saved ASC credentials and Keychain entry, then disconnect the account.\nPreview images and sync records will be kept. Reconnecting requires your key.',
				storagePrepareConfirm: 'Remove this profile’s local preview images, sync records, interface language preference, and account credentials, including its Keychain entry.\nRemoving sync records loses this profile’s asset sync and failure-recovery history. This cannot be undone in the plugin.\nAfter cleanup, uninstall the plugin in DSH’s plugin manager.',
				storageUninstallConfirm: 'Remove this profile’s local preview images, sync records, interface language preference, and account credentials, including its Keychain entry, then uninstall this plugin from DSH.\nRemoving sync records loses this profile’s asset sync and failure-recovery history. This cannot be undone in the plugin.\nThe plugin panel will close after uninstalling.',
				fileReadError: 'Could not read the file', appMismatch: 'The returned app does not match your selection. Refresh and try again.',
				back: 'Back',
				refresh: 'Refresh',
				loading: 'Loading…',
				chooseApp: 'Choose an app',
				discardDraftTitle: 'Discard unsynced changes?',
				discardDraftMessage: (name) => `Changes to the current app have not been synced. Switching to “${name}” will discard them.`,
				keepEditing: 'Keep editing', discardAndSwitch: 'Discard and switch',
				previousText: 'Original text (scroll to read all)', nextText: 'Updated text (scroll to read all)',
				noApps: 'No apps visible for this account',
				language: 'Language',
				fields: 'Listing',
				preview: 'Store preview',
				pvProduct: 'Product page',
				pvSearch: 'Search',
				pvExpand: 'Device preview', pvClose: 'Close preview', pvVersion: 'Version', pvLanguage: 'Language',
				pvBrowseHint: 'Scroll inside the device and swipe through screenshots. The actual App Store presentation may differ.',
				pvAssetHint: 'Standard layout without a creative asset. Upload a header or search asset below.',
				pvNoShots: 'No iPhone screenshots to preview', pvShotsError: 'Screenshots could not be loaded',
				pvShot: (n) => `App screenshot ${n}`, pvImageError: 'Image unavailable', pvDescription: 'About this app',
				pvScreenshots: 'Preview', pvShotCount: 'Screenshots', pvWhatsNew: 'What’s New',
				pvSourceRemote: 'ASC asset', pvSourceLocal: 'Local asset', pvRemoteLoading: 'Loading ASC assets…',
				pvRemoteError: 'Could not load ASC assets', pvRemoteImageError: 'The ASC image could not be loaded. Refresh to retry.',
				get: 'Get',
				pvSearchPlaceholder: 'Search',
				pvCategory: 'Category · Developer',
				pvHeaderPh: 'Product page header asset\n(not uploaded yet — use “Upload asset” below; stays on this machine)',
				pvSearchPh: 'Search results asset\n(not uploaded yet — use “Upload asset” below; stays on this machine)',
				pvUpload: 'Upload asset',
				pvReplace: 'Replace asset',
				pvRemove: 'Remove local',
				pvLoadError: 'Preview failed to load. Your local asset is kept; refresh to retry.',
				pvWithdraw: 'Withdraw from ASC',
				shotsTitle: 'Screenshots',
				shotsUpload: 'Upload screenshots',
				shotsAuto: 'Device size: auto',
				shotsNoType: 'Cannot detect device size — pick one manually (top right)',
				shotsReadOnly: 'Version not editable — screenshots are view-only',
				shotsEmpty: 'No screenshots for this language yet',
				shotsDelete: 'Delete screenshot',
				shotsReadErr: 'Cannot read image dimensions',
				shotsDuoHint: 'Device sizes are auto-detected from pixels (portrait & landscape): iPhone Duo, 6.9"/6.5"/6.1", iPad 13"/11" and more; pick manually (top right) when unclear.',
				pvSync: 'Sync to ASC',
				pvResync: 'Re-sync to ASC',
				pvSyncing: 'Syncing…',
				pvAscState: 'ASC status',
				pvRefreshState: 'Refresh',
				pvStats: ['Ratings', 'Age', 'Developer', 'Language'],
				pvTabs: ['Today', 'Games', 'Apps', 'Arcade', 'Search'],
				screenshots: 'Screenshots',
				checks: 'Pre-submission checks',
				checksRun: 'Run checks',
				checksRunning: 'Checking…',
				checksHint: 'Click “Run checks” for a read-only rules check of listing copy and screenshots.',
				comingSoon: 'Coming soon',
				sync: 'Sync to App Store Connect',
				syncChanges: (n) => `${n} change${n === 1 ? '' : 's'}`,
				overLimitBlocked: 'Some fields exceed their limit — fix them before syncing',
				noChanges: 'No changes',
				fieldLabels: {
					name: 'Name', subtitle: 'Subtitle', keywords: 'Keywords (comma separated)',
					description: 'Description', whatsNew: 'What’s New', promotionalText: 'Promotional Text'
				},
				stateNames: {
					PREPARE_FOR_SUBMISSION: 'Prepare for Submission', DEVELOPER_REJECTED: 'Developer Rejected', REJECTED: 'Rejected',
					METADATA_REJECTED: 'Metadata Rejected', WAITING_FOR_REVIEW: 'Waiting for Review', IN_REVIEW: 'In Review',
					PENDING_DEVELOPER_RELEASE: 'Pending Developer Release', PROCESSING_FOR_APP_STORE: 'Processing for App Store', READY_FOR_SALE: 'Ready for Sale',
					REPLACED_WITH_NEW_VERSION: 'Replaced with New Version', DEVELOPER_REMOVED_FROM_SALE: 'Removed from Sale', REMOVED_FROM_SALE: 'Removed from Sale'
				},
				promoOnlyNote: 'This version is not editable; only the Promotional Text can be updated anytime.',
				versionLockedNote: 'The current (live) version is not editable — create a new version in ASC to modify this field.',
				infoLockedNote: 'App info is not editable: name/subtitle require a new version (Prepare for Submission) in ASC.',
				noVersionNote: 'This app has no iOS version yet, listing copy is read-only.',
				readOnlyNote: 'No writable localization resource for this language.',
				diffTitle: 'Confirm changes to sync',
				diffSub: (n) => `${n} change${n === 1 ? '' : 's'} will be written to App Store Connect one by one`,
				oldValue: 'Current',
				newValue: 'New',
				cancel: 'Cancel',
				confirmSync: 'Sync now',
				syncing: 'Syncing…',
				syncDone: (ok, fail) => fail === 0 ? `Synced ${ok} change${ok === 1 ? '' : 's'}` : `${ok} succeeded, ${fail} failed`,
				done: 'Done',
				failedKeep: 'Failed items stay in the editor so you can retry after fixing.',
				needConfig: 'App Store Connect API key is not configured yet',
				configRecovery: 'Secure credential storage needs recovery. Unlock Keychain and refresh. If recovery still fails, upload the .p8 file again and save, or disconnect and configure the account again.',
				needConfigGo: 'Open settings',
				configTitle: 'Connect to App Store Connect',
				guideTitle: 'Create an API key (5 steps)',
				steps: [
					'Sign in at appstoreconnect.apple.com',
					'Open “Users and Access”',
					'Switch to the “Integrations” tab',
					'Pick “App Store Connect API” and click + to generate a key (App Manager or Admin role)',
					'Download the .p8 key (only once) and note the Issuer ID and Key ID'
				],
				issuerId: 'Issuer ID',
				keyId: 'Key ID',
				issuerPlaceholder: 'e.g. 57246542-96fe-1a63-e053-0824d011072a',
				keyIdPlaceholder: 'e.g. ABC123DEFG',
				uploadP8: 'Choose a .p8 key file',
				uploaded: (name) => `Uploaded ${name}`,
				p8Hint: 'The key is stored only in this Mac’s Keychain for local signing. If Keychain is unavailable, saving stops without writing an unencrypted file.',
				keepStoredKey: 'The previously saved key will be kept',
				test: 'Test connection',
				testing: 'Testing…',
				save: 'Save',
				saving: 'Saving…',
				testOk: (n) => `Connected. ${n} app${n === 1 ? '' : 's'} visible for this account`,
				testNoApp: 'Connected, but no apps are visible (the key may lack app access)',
				savedOk: 'Saved',
				configuredOn: 'Configured',
				storageKeychain: 'Key stored in the macOS Keychain',
				storageFile: 'The key still needs secure storage migration. Refresh and retry.',
				footer: `dsh-asc-studio · v${PLUGIN_VERSION}`,
				openPanel: 'Open the App Store copy panel',
				errNeedAll: 'Fill in Issuer ID, Key ID and upload the .p8 (or keep the saved key)',
				errP8: 'The .p8 file is not a valid PEM private key'
			}
		}
		/** 所有面板和入口订阅同一偏好；切换文案无需重建组件或清空草稿。 */
		function useLanguage() {
			const [preference, lang] = React.useSyncExternalStore(subscribeLanguage, languageSnapshot, languageSnapshot).split(':')
			const t = STR[lang]
			return { preference, lang, t,
				localeName: (locale) => localeName(locale, lang),
				stateName: (state) => t.stateNames[String(state ?? '')] ?? String(state ?? ''),
				ascStateText: (state) => ascStateText(state, lang) }
		}

		/** ASC 素材状态的中文映射（未收录的原样显示）。注意：常规营销素材即时处理，
		 *  WAITING_FOR_REVIEW / IN_REVIEW / REJECTED 是 Apple 保留的审核路径，常规不会出现。 */
		const ASC_STATE_ZH = {
			RESTORE_REQUIRED: '旧素材待恢复，可重试同步或撤回',
			CLEANUP_REQUIRED: '有未完成操作，可重试同步或撤回',
			AWAITING_UPLOAD: '等待上传', UPLOAD_COMPLETE: '已上传完成', FAILED: '处理失败', COMPLETE: '处理完成',
			PREPARE_FOR_SUBMISSION: '已就绪（随所在版本生效）', READY_FOR_REVIEW: '已就绪', WAITING_FOR_REVIEW: '等待审核',
			IN_REVIEW: '审核中', ACCEPTED: '已通过', APPROVED: '已批准', REJECTED: '被驳回', ARCHIVED: '已归档'
		}

		/** @param {string} state - ASC 素材状态。 @returns {string} 中文或原文。 */
		function ascStateText(state, lang) {
			if (lang !== 'zh') return ({
				RESTORE_REQUIRED: 'Restore pending — retry sync or withdraw', CLEANUP_REQUIRED: 'Operation incomplete — retry sync or withdraw',
				AWAITING_UPLOAD: 'Awaiting Upload', UPLOAD_COMPLETE: 'Upload Complete', FAILED: 'Processing Failed', COMPLETE: 'Complete',
				PREPARE_FOR_SUBMISSION: 'Ready (takes effect with this version)', READY_FOR_REVIEW: 'Ready', WAITING_FOR_REVIEW: 'Waiting for Review',
				IN_REVIEW: 'In Review', ACCEPTED: 'Accepted', APPROVED: 'Approved', REJECTED: 'Rejected', ARCHIVED: 'Archived', ACTIVE: 'Active'
			})[state] ?? String(state ?? '')
			return ASC_STATE_ZH[String(state ?? '')] ?? String(state ?? '')
		}

		/** @param {string} locale - BCP-47 语言码。 @returns {string} 展示名。 */
		function localeName(locale, lang) {
			try {
				return new Intl.DisplayNames([lang === 'zh' ? 'zh-Hans' : 'en'], { type: 'language' }).of(locale) ?? locale
			} catch {
				return locale
			}
		}

		/** @param {string} seed - 任意字符串。 @returns {string} HSL 颜色。 */
		function avatarColor(seed) {
			let hash = 0
			for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 360
			return `hsl(${hash}, 42%, 52%)`
		}

		// ── 请求封装 ───────────────────────────────────────────────────
		const ERROR_SUMMARIES_EN = {
			SESSION: 'Your DSH session has expired. Reopen this page from the DSH launch entry.',
			HOST_AUTH: 'DSH secure sessions are unavailable. Update or restart DSH, then retry.',
			LOCAL_ACCESS: 'This request is not authorized to access the current DSH profile.',
			KEYCHAIN: 'Secure storage could not complete the operation. On macOS, unlock Keychain and retry. No unencrypted file fallback is used.',
			CONFIG: 'Set up your App Store Connect API key in Settings.',
			AUTH: 'Authentication failed. Check your Issuer ID, Key ID, private key and system clock.',
			FORBIDDEN: 'Access denied. Check the API key’s role and app access.',
			NOT_FOUND: 'The resource was not found. Refresh and try again.',
			CONFLICT: 'The app, version or resource state has changed or does not allow this operation. Refresh before retrying.',
			COPY_CONFLICT: 'This field changed in ASC and was not overwritten. Your draft is kept. Reopen the change comparison and review the latest ASC text before confirming again.',
			SCREENSHOT_RECOVERY: 'The upload result or cleanup could not be confirmed. Refresh the screenshot list and check ASC before uploading again. Remove any incomplete upload from the list.',
			VALIDATION: 'The request was rejected. Check the field values and length limits.',
			RATE_LIMIT: 'Too many requests. Wait a moment before retrying.',
			NETWORK: 'Could not connect to App Store Connect. Check your connection.',
			REQUEST: 'The request is invalid. Check the selected app, language and input.',
			SERVER: 'The operation could not be completed. Review the details before retrying.'
		}
		/** 本地化操作建议，同时保留服务端诊断，避免隐藏字段错误或恢复信息。 */
		function apiErrorMessage(payload, fallback = '', lang = resolvedLanguage()) {
			const original = String(payload?.error ?? fallback)
			if (lang === 'zh') return original
			const summary = ERROR_SUMMARIES_EN[payload?.code]
			if (!summary) return original
			return `${summary}${original ? `\nDetails: ${payload?.detail || original}` : ''}`
		}
		function apiFailure(payload, status) {
			const error = new Error(String(payload?.error ?? `HTTP ${status}`))
			error.ascPayload = payload
			return error
		}
		function errorText(error, lang = resolvedLanguage()) {
			if (error?.ascPayload) return apiErrorMessage(error.ascPayload, error.message, lang)
			if (error?.messageKey) return STR[lang][error.messageKey]
			if (error?.warning) return lang === 'en' ? (error.warningEn ?? error.warning) : error.warning
			return String(error?.message ?? error ?? '')
		}

		/**
		 * GET 一条插件路由。
		 * @param {string} path - 路由路径。
		 * @returns {Promise<object>} 载荷。
		 */
		async function apiGet(path, signal) {
			const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal })
			const payload = await response.json().catch(() => ({}))
			if (!response.ok || payload?.ok !== true) {
				throw apiFailure(payload, response.status)
			}
			return payload
		}

		/**
		 * POST 一条插件路由（带插件标记头，与 host 的 guard() 对应）。
		 * @param {string} path - 路由路径。
		 * @param {object} body - JSON 载荷。
		 * @returns {Promise<object>} 载荷。
		 */
		async function apiPost(path, body, signal) {
			const response = await fetch(path, {
				method: 'POST',
				signal,
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { 'content-type': 'application/json', 'x-dsh-asc-studio': '1' },
				body: JSON.stringify(body ?? {})
			})
			const payload = await response.json().catch(() => ({}))
			if (!response.ok || payload?.ok !== true) {
				throw apiFailure(payload, response.status)
			}
			return payload
		}

		// ── 图标 ───────────────────────────────────────────────────────

		/** @returns {object} 齿轮图标。 */
		function GearIcon() {
			return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
				h('circle', { cx: 8, cy: 8, r: 2.2, stroke: 'currentColor', strokeWidth: 1.5 }),
				h('path', {
					d: 'M8 1.8v1.7M8 12.5v1.7M2.9 4.9l1.5.9M11.6 10.2l1.5.9M2.9 11.1l1.5-.9M11.6 5.8l1.5-.9',
					stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round'
				})
			)
		}

		/** @returns {object} 返回箭头图标。 */
		function BackIcon() {
			return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
				h('path', { d: 'M10 3 5 8l5 5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })
			)
		}

		/** @returns {object} 刷新图标。 */
		function RefreshIcon() {
			return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
				h('path', {
					d: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.4h-2.4',
					stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round'
				})
			)
		}

		/** @returns {object} 苹果与鲸鱼组合图标（输入框左侧入口）。 */
		function StudioIcon() {
			return h('img', { src: `${BASE}/brand-icon?v=${PLUGIN_VERSION}`, width: 20, height: 20,
				alt: '', 'aria-hidden': true, style: { display: 'block', borderRadius: 5 } })
		}

		/** @param {object} props - `{ app }`。 @returns {object} App 图标或字母头像。 */
		function AppAvatar({ app }) {
			if (typeof app?.iconUrl === 'string' && app.iconUrl !== '') {
				return h('img', { className: 'asc-avatar', src: app.iconUrl, alt: '' })
			}
			const letter = String(app?.name ?? '?').trim().charAt(0).toUpperCase() || '?'
			return h('span', { className: 'asc-avatar-letter', style: { background: avatarColor(String(app?.id ?? letter)) } }, letter)
		}

		/**
		 * 状态胶囊。
		 * @param {object} props - `{ state }` appStoreState。
		 * @returns {object} 胶囊元素。
		 */
		function StatePill({ state }) {
			const { stateName } = useLanguage()
			const editable = isVersionEditable(state)
			const tone = editable ? 'ok' : state === 'READY_FOR_SALE' ? 'muted' : 'warn'
			return h('span', { className: 'asc-pill', 'data-tone': tone }, stateName(state))
		}

		// ── 输入框左侧入口 ─────────────────────────────────────────────

		/**
		 * 输入框左侧的小图标按钮：打开右侧边栏面板。
		 * @param {object} props - slot 注入的 props（含 sessionId）。
		 * @returns {object} React 元素。
		 */
		function ToggleButton() {
			const { t } = useLanguage()
			return h('button', {
				type: 'button',
				className: 'asc-iconbtn',
				title: t.openPanel,
				'aria-label': t.openPanel,
				style: { width: 26, height: 26, borderRadius: 7 },
				onClick: () => openPanel()
			}, h(StudioIcon))
		}

		// ── 设置页 ─────────────────────────────────────────────────────

		function useUpdateCheck(active) {
			const [update, setUpdate] = React.useState(null)
			const [checking, setChecking] = React.useState(false)
			const pending = React.useRef(null)
			const check = React.useCallback(async (force = false) => {
				if (pending.current) return
				const controller = new AbortController()
				pending.current = controller
				setChecking(true)
				try {
					const payload = await apiGet(`${BASE}/updates${force ? '?refresh=1' : ''}`, controller.signal)
					if (!['available', 'current', 'error'].includes(payload.update?.status)) throw new Error('Invalid update response')
					if (payload.update.status === 'available' && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(payload.update.latestVersion)) throw new Error('Invalid update version')
					if (!controller.signal.aborted) setUpdate(payload.update)
				} catch {
					if (!controller.signal.aborted) setUpdate({ status: 'error' })
				} finally {
					if (pending.current === controller) { pending.current = null; setChecking(false) }
				}
			}, [])
			React.useEffect(() => {
				if (active) void check()
				return () => { pending.current?.abort(); pending.current = null }
			}, [active, check])
			return { update, checking, check }
		}

		function UpdateGuide({ version, onClose }) {
			const { t } = useLanguage()
			const ref = React.useRef(null)
			React.useEffect(() => { ref.current?.showModal?.() }, [])
			return h('dialog', { ref, className: 'asc-storage-confirm asc-update-guide', 'aria-label': t.updateGuide, onCancel: onClose, onClose },
				h('div', { className: 'asc-modal-head' }, h('strong', null, t.updateGuide)),
				h('div', { className: 'asc-modal-body' },
					h('ol', null, t.updateGuideSteps.map((step, index) => h('li', { key: index }, step))),
					h('code', { className: 'asc-storage-path' }, `dsh-asc-studio@${version}`),
					h('p', null, t.updateKeepData),
					h('p', { className: 'asc-notice', 'data-tone': 'warn' }, t.updateAvoidCleanup)),
				h('div', { className: 'asc-modal-foot' }, h('button', { type: 'button', className: 'asc-btn', autoFocus: true, onClick: onClose }, t.updateClose)))
		}

		function UpdateInfo({ state, compact = false }) {
			const { t, lang } = useLanguage()
			const [guideOpen, setGuideOpen] = React.useState(false)
			const { update, checking, check } = state
			const available = update?.status === 'available'
			if (compact && !available) return null
			const summary = checking ? t.updateChecking : available ? t.updateAvailable(update.latestVersion)
				: update?.status === 'current' ? t.updateLatest : update?.status === 'error' ? t.updateFailed : ''
			return h('section', { className: compact ? 'asc-notice asc-update-notice' : 'asc-card asc-form asc-update-card', 'aria-label': t.updateTitle },
				compact ? h('span', null, t.updateAvailable(update.latestVersion)) : h(React.Fragment, null,
					h('strong', { className: 'asc-field-label' }, t.updateTitle),
					h('div', null, t.updateCurrent(update?.currentVersion || PLUGIN_VERSION)),
					h('div', { role: 'status' }, summary),
					update?.checkedAt && update.status !== 'error' ? h('div', { className: 'asc-filehint' },
						t.updateChecked(new Date(update.checkedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'))) : null,
					h('div', { className: 'asc-filehint' }, t.updateHint),
					h('div', { className: 'asc-filehint' }, t.updatePrivacy)),
				h('div', { className: 'asc-update-actions' },
					!compact ? h('button', { type: 'button', className: 'asc-btn', disabled: checking, onClick: () => { void check(true) } }, t.updateCheck) : null,
					available ? h('button', { type: 'button', className: 'asc-btn', onClick: () => setGuideOpen(true) }, t.updateGuide) : null),
				guideOpen ? h(UpdateGuide, { version: update.latestVersion, onClose: () => setGuideOpen(false) }) : null)
		}

		function formatStorageBytes(value) {
			const bytes = Math.max(0, Number(value) || 0)
			if (bytes < 1024) return `${Math.round(bytes)} B`
			if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
			if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
			return `${(bytes / 1024 ** 3).toFixed(1)} GB`
		}

		function StorageConfirmation({ selection, storage, busy, onCancel, onConfirm }) {
			const { t } = useLanguage()
			const ref = React.useRef(null)
			React.useEffect(() => { ref.current?.showModal?.() }, [])
			const target = selection.appId ? storage.apps?.find((app) => app.appId === selection.appId) : storage
			const message = selection.action === 'clear-images'
				? t.storageClearConfirm(selection.appLabel, target?.imageCount ?? 0, formatStorageBytes(target?.imageBytes))
				: selection.action === 'disconnect' ? t.storageDisconnectConfirm
					: selection.action === 'uninstall' ? t.storageUninstallConfirm : t.storagePrepareConfirm
			return h('dialog', { ref, className: 'asc-storage-confirm', 'aria-labelledby': 'asc-storage-confirm-title',
				onCancel: (event) => { if (busy) event.preventDefault(); else onCancel() }, onClose: () => { if (!busy) onCancel() } },
				h('div', { className: 'asc-modal-head' }, h('strong', { id: 'asc-storage-confirm-title' }, t.storageConfirmTitle)),
				h('div', { className: 'asc-modal-body' },
					h('div', { className: 'asc-ro-note' }, `${t.storageProfile}: ${storage.profileId}`),
					h('code', { className: 'asc-storage-path' }, storage.directory),
					h('p', null, message),
					h('p', { className: 'asc-notice', 'data-tone': 'warn' }, t.storageRemoteSafe)),
				h('div', { className: 'asc-modal-foot' },
					h('button', { type: 'button', className: 'asc-btn', autoFocus: true, disabled: busy, onClick: onCancel }, t.cancel),
					h('button', { type: 'button', className: 'asc-btn', disabled: busy, onClick: onConfirm }, busy ? t.storageWorking : t.storageConfirm)))
		}

		/** 本机存储操作与 ASC 写操作分开；破坏性操作先展示范围与保留项。 */
		function StorageSettingsCard({ config, apps = [], onChanged, onBusyChange, disabled = false }) {
			const { t } = useLanguage()
			const [storage, setStorage] = React.useState(null)
			const [loading, setLoading] = React.useState(true)
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState(null)
			const [done, setDone] = React.useState(false)
			const [uninstallFailed, setUninstallFailed] = React.useState(false)
			const [selection, setSelection] = React.useState(null)
			const [manageExpanded, setManageExpanded] = React.useState(false)
			const appListId = React.useId()
			const cachedApps = (storage?.apps ?? []).filter((app) => app.imageCount > 0)
			const canManageApps = cachedApps.length > 1
			const appName = (appId) => apps.find((app) => app.id === appId)?.name?.trim() || ''
			const appLabel = (appId) => appName(appId) ? `${appName(appId)} (${appId})` : `App ${appId}`
			React.useEffect(() => { if (!canManageApps) setManageExpanded(false) }, [canManageApps])
			const alive = React.useRef(false)
			const operation = React.useRef(false)
			const request = React.useRef({ sequence: 0, controller: null })
			const load = React.useCallback(async () => {
				request.current.controller?.abort()
				const controller = new AbortController()
				const sequence = ++request.current.sequence
				request.current.controller = controller
				setLoading(true)
				setError(null)
				try {
					const payload = await apiGet(`${BASE}/storage`, controller.signal)
					if (alive.current && sequence === request.current.sequence) setStorage(payload.storage ?? null)
				} catch (reason) {
					if (alive.current && sequence === request.current.sequence && !controller.signal.aborted) setError(reason)
				} finally {
					if (alive.current && sequence === request.current.sequence) setLoading(false)
				}
			}, [])
			React.useEffect(() => {
				alive.current = true
				void load()
				return () => { alive.current = false; request.current.sequence += 1; request.current.controller?.abort() }
			}, [load])
			const execute = async (action, appId) => {
				if (operation.current || disabled || loading) return
				const profileId = config?.profileId ?? ''
				operation.current = true
				setBusy(true)
				onBusyChange?.(true)
				setError(null)
				setDone(false)
				setUninstallFailed(false)
				try {
					const payload = await apiPost(`${BASE}/storage`, { action, ...(appId ? { appId } : {}) })
					// 宿主可能已关闭面板；成功后的语言清理不依赖组件仍然挂载。
					if (action === 'prepare-uninstall' || action === 'uninstall') clearLanguagePreference(profileId)
					if (!alive.current) return
					if (payload.storage) setStorage(payload.storage)
					else await load()
					setSelection(null)
					setDone(true)
					onChanged?.(payload, action)
				} catch (reason) {
					if (alive.current) {
						setSelection(null)
						setError(reason)
						if (action === 'uninstall') {
							setUninstallFailed(true)
							// 清理可能已完成而宿主卸载失败，重新读取占用与连接状态。
							try {
								const [usage, account] = await Promise.all([apiGet(`${BASE}/storage`), apiGet(`${BASE}/config`)])
								if (alive.current) { setStorage(usage.storage ?? null); onChanged?.({ storage: usage.storage, config: account.config }, action) }
							} catch { /* 保留原始失败原因与手动卸载提示。 */ }
						}
					}
				} finally {
					operation.current = false
					if (alive.current) { setBusy(false); onBusyChange?.(false) }
				}
			}
			const blocked = disabled || loading || busy || selection !== null
			const importBlocked = Boolean(storage?.totalBytes || storage?.imageCount || storage?.recordCount || config?.configured || config?.hasKey || config?.hasStoredCredentials)
			const ask = (action, appId) => { if (!blocked) { setDone(false); setSelection({ action, appId, appLabel: appId ? appLabel(appId) : undefined }) } }
			return h('section', { className: 'asc-card asc-storage', 'aria-label': t.storageTitle },
				h('div', { className: 'asc-preview-dialog-head' }, h('strong', null, t.storageTitle),
					h('button', { type: 'button', className: 'asc-btn', disabled: blocked, onClick: load }, t.refresh)),
				loading ? h('div', { className: 'asc-ro-note', role: 'status' }, t.loading) : null,
				error ? h('div', { className: 'asc-notice', 'data-tone': 'err', role: 'alert' }, errorText(error)) : null,
				uninstallFailed ? h('p', { className: 'asc-notice', 'data-tone': 'warn', role: 'status' }, t.storageUninstallFailed) : null,
				done ? h('div', { className: 'asc-notice', 'data-tone': 'ok', role: 'status' }, t.storageDone) : null,
				storage ? h(React.Fragment, null,
					h('div', { className: 'asc-ro-note' }, `${t.storageProfile}: ${storage.profileId}`),
					h('code', { className: 'asc-storage-path' }, storage.directory),
					h('div', { className: 'asc-storage-summary' },
						[[t.storageTotal, storage.totalBytes, ''], [t.storageImages, storage.imageBytes, t.storageImageCount(storage.imageCount)], [t.storageRecords, storage.recordBytes, t.storageRecordCount(storage.recordCount)]].map(([label, bytes, count]) =>
							h('div', { key: label, className: 'asc-storage-stat' }, h('strong', null, formatStorageBytes(bytes)), h('span', null, label), count ? h('div', { className: 'asc-ro-note' }, count) : null))),
					h('p', { className: 'asc-ro-note' }, t.storageRemoteSafe),
					h('div', { className: 'asc-storage-actions' },
						h('button', { type: 'button', className: 'asc-btn', disabled: blocked || !storage.imageCount, onClick: () => ask('clear-images') }, t.storageClearAll),
						h('button', { type: 'button', className: 'asc-btn', disabled: blocked, onClick: () => execute('open-directory') }, t.storageOpen)),
					!storage.imageCount ? h('p', { className: 'asc-ro-note' }, t.storageNoImages) : null,
					h('p', { className: 'asc-ro-note' }, t.storageRetainRecords),
					canManageApps ? h(React.Fragment, null,
						h('button', { type: 'button', className: 'asc-storage-manage', disabled: blocked, 'aria-label': t.storageManageApps, 'aria-expanded': manageExpanded, 'aria-controls': appListId, onClick: () => setManageExpanded((current) => !current) },
							h('span', { 'aria-hidden': true }, manageExpanded ? '▾' : '▸'), t.storageManageApps),
						h('div', { id: appListId, hidden: !manageExpanded }, manageExpanded ? cachedApps.map((app) => h('div', { key: app.appId, className: 'asc-storage-app' },
							h('div', { className: 'asc-storage-app-name' }, h('strong', null, appName(app.appId) || `App ${app.appId}`),
								appName(app.appId) ? h('small', null, `App ID: ${app.appId}`) : null,
								h('small', null, `${t.storageImageCount(app.imageCount)} · ${formatStorageBytes(app.imageBytes)}`)),
							h('button', { type: 'button', className: 'asc-btn', disabled: blocked, 'aria-label': `${t.storageClearAll}: ${appLabel(app.appId)}`, onClick: () => ask('clear-images', app.appId) }, t.storageClearApp))) : null)) : null,
					h('div', { className: 'asc-storage-section' },
						h('button', { type: 'button', className: 'asc-btn', disabled: blocked || !(config?.configured || config?.hasKey || config?.hasStoredCredentials), onClick: () => ask('disconnect') }, t.storageDisconnect),
						h('p', { className: 'asc-ro-note' }, config?.configured || config?.hasKey || config?.hasStoredCredentials ? t.storageDisconnectHint : t.storageDisconnected)),
					storage.legacy?.available ? h('div', { className: 'asc-storage-section' },
						h('strong', null, t.storageLegacy), h('code', { className: 'asc-storage-path' }, storage.legacy.directory),
						h('p', { className: 'asc-ro-note' }, `${t.storageImageCount(storage.legacy.imageCount)} · ${formatStorageBytes(storage.legacy.imageBytes)}`),
						h('p', { className: 'asc-ro-note' }, t.storageImportHint),
						importBlocked ? h('p', { className: 'asc-ro-note' }, t.storageImportBlocked) : null,
						h('button', { type: 'button', className: 'asc-btn', disabled: blocked || importBlocked, onClick: () => execute('import-legacy') }, t.storageImport)) : null,
					h('div', { className: 'asc-storage-section' }, h('strong', null, t.storageUninstall),
						h('p', { className: 'asc-ro-note' }, storage.automaticUninstallCleanup ? t.storageAutoUninstall : t.storageManualUninstall),
						h('button', { type: 'button', className: 'asc-btn', disabled: blocked, onClick: () => ask(storage.canUninstall ? 'uninstall' : 'prepare-uninstall') }, storage.canUninstall ? t.storageUninstallNow : t.storagePrepare)),
					selection ? h(StorageConfirmation, { selection, storage, busy, onCancel: () => setSelection(null), onConfirm: () => execute(selection.action, selection.appId) }) : null) : null)
		}

		/**
		 * 设置页：5 步引导 + 密钥表单 + 测试连接 + 保存。
		 * @param {object} props - `{ config, onBack, onSaved }`。
		 * @returns {object} React 元素。
		 */
		function SettingsView({ config, apps, onBack, onSaved, onStorageChanged, updateState }) {
			const { t, preference, lang } = useLanguage()
			const [storageBusy, setStorageBusy] = React.useState(false)
			const [languageSaveFailed, setLanguageSaveFailed] = React.useState(false)
			const [issuerId, setIssuerId] = React.useState(config?.issuerId ?? '')
			const [keyId, setKeyId] = React.useState(config?.keyId ?? '')
			const [p8File, setP8File] = React.useState(null)
			const [testing, setTesting] = React.useState(false)
			const [saving, setSaving] = React.useState(false)
			const [testResult, setTestResult] = React.useState(null)
			const [error, setError] = React.useState('')
			const [saved, setSaved] = React.useState(false)
			React.useEffect(() => {
				setIssuerId(config?.issuerId ?? '')
				setKeyId(config?.keyId ?? '')
				setP8File(null)
				setTestResult(null)
				setSaved(false)
			}, [config])

			const hasStoredKey = config?.hasKey === true
			const canSave = issuerId.trim() !== '' && keyId.trim() !== '' && (p8File !== null || hasStoredKey)

			/** 读入 .p8 文件（只留在内存，稍后交给 host 保存到本机）。 */
			const pickFile = async (event) => {
				const file = event.target?.files?.[0]
				if (file === undefined || file === null) return
				setError('')
				try {
					const content = await file.text()
					if (!content.includes('PRIVATE KEY')) {
						setError({ messageKey: 'errP8' })
						setP8File(null)
						return
					}
					setP8File({ name: file.name, content })
				} catch (reason) {
					setError(reason)
				} finally {
					event.target.value = ''
				}
			}

			/** 用表单当前值（未保存也行）测试一次连接。 */
			const runTest = async () => {
				if (testing) return
				if (issuerId.trim() === '' || keyId.trim() === '' || (p8File === null && !hasStoredKey)) {
					setError({ messageKey: 'errNeedAll' })
					return
				}
				setTesting(true)
				setError('')
				setTestResult(null)
				try {
					const payload = await apiPost(`${BASE}/config/test`, {
						issuerId: issuerId.trim(),
						keyId: keyId.trim(),
						p8: p8File === null ? undefined : p8File.content
					})
					setTestResult({ ok: true, appCount: Number(payload?.appCount ?? 0) })
				} catch (reason) {
					setTestResult({ ok: false, message: reason })
				} finally {
					setTesting(false)
				}
			}

			/** 保存到本机钥匙串；失败不降级成文件。 */
			const runSave = async () => {
				if (saving) return
				if (!canSave) {
					setError({ messageKey: 'errNeedAll' })
					return
				}
				setSaving(true)
				setError('')
				try {
					const payload = await apiPost(`${BASE}/config`, {
						issuerId: issuerId.trim(),
						keyId: keyId.trim(),
						p8: p8File === null ? undefined : p8File.content,
						keyFileName: p8File === null ? undefined : p8File.name
					})
					setSaved(true)
					onSaved?.(payload?.config)
				} catch (reason) {
					setError(reason)
				} finally {
					setSaving(false)
				}
			}

			return h('div', { className: 'asc-root', lang: lang === 'zh' ? 'zh-Hans' : 'en' },
				h('div', { className: 'asc-head' },
					h('button', { type: 'button', className: 'asc-iconbtn', title: t.back, 'aria-label': t.back, disabled: storageBusy || saving || testing, onClick: onBack }, h(BackIcon)),
					h('span', { className: 'asc-head-title' }, t.settings)
				),
				h('fieldset', { className: 'asc-scroll', disabled: storageBusy, style: { border: 0, margin: 0, minWidth: 0 } },
					config?.recoveryRequired ? h('div', { className: 'asc-notice', 'data-tone': 'warn', role: 'status' }, t.configRecovery) : null,
					h('div', { className: 'asc-card asc-form' },
						h('label', { className: 'asc-field-label', htmlFor: 'asc-ui-language' }, t.interfaceLanguage),
						h('select', { id: 'asc-ui-language', className: 'asc-input', value: preference,
							onChange: (event) => setLanguageSaveFailed(!setLanguagePreference(event.target.value)) },
							h('option', { value: 'auto' }, t.followSystem),
							h('option', { value: 'zh', lang: 'zh-Hans' }, '简体中文'),
							h('option', { value: 'en', lang: 'en' }, 'English')),
						h('p', { className: 'asc-ro-note', style: { margin: 0 } }, t.languageHint),
						languageSaveFailed ? h('div', { className: 'asc-notice', 'data-tone': 'warn', role: 'status' }, t.languageSaveError) : null),
					h(UpdateInfo, { state: updateState }),
					h('div', { className: 'asc-card' },
						h('div', { className: 'asc-field-label', style: { marginBottom: 8 } }, t.configTitle),
						h('div', { className: 'asc-section-title' }, t.guideTitle),
						h('ol', { className: 'asc-steps' },
							t.steps.map((step, index) => h('li', { key: index, className: 'asc-step' },
								h('span', { className: 'asc-step-no' }, String(index + 1)),
								h('span', null, step)
							))
						)
					),
					h('div', { className: 'asc-card asc-form' },
						h('div', { className: 'asc-form-row' },
							h('label', { className: 'asc-field-label', htmlFor: 'asc-issuer' }, t.issuerId),
							h('input', {
								id: 'asc-issuer', className: 'asc-input', value: issuerId,
								placeholder: t.issuerPlaceholder, autoComplete: 'off', spellCheck: false,
								onChange: (event) => setIssuerId(event.target.value)
							})
						),
						h('div', { className: 'asc-form-row' },
							h('label', { className: 'asc-field-label', htmlFor: 'asc-keyid' }, t.keyId),
							h('input', {
								id: 'asc-keyid', className: 'asc-input', value: keyId,
								placeholder: t.keyIdPlaceholder, autoComplete: 'off', spellCheck: false,
								onChange: (event) => setKeyId(event.target.value)
							})
						),
						h('div', { className: 'asc-form-row' },
							h('span', { className: 'asc-field-label' }, '.p8'),
							h('label', { className: 'asc-filebtn' },
								h('input', { type: 'file', accept: '.p8,application/octet-stream', style: { display: 'none' }, onChange: pickFile }),
								h('span', null, t.uploadP8)
							),
							p8File !== null
								? h('span', { className: 'asc-filehint' }, t.uploaded(p8File.name))
								: hasStoredKey
									? h('span', { className: 'asc-filehint' },
										`✓ ${t.uploaded(config?.keyFileName || '*.p8')} · ${t.keepStoredKey}`)
									: null,
							h('span', { className: 'asc-filehint' }, t.p8Hint)
						),
						error === '' ? null : h('div', { className: 'asc-notice', 'data-tone': 'err' },
							h('span', { className: 'asc-notice-body' }, errorText(error))),
						testResult !== null && testResult.ok === true
							? h('div', { className: 'asc-notice', 'data-tone': 'ok' },
								h('span', { className: 'asc-notice-body' },
									testResult.appCount > 0 ? t.testOk(testResult.appCount) : t.testNoApp))
							: null,
						testResult !== null && testResult.ok === false
							? h('div', { className: 'asc-notice', 'data-tone': 'err' },
								h('span', { className: 'asc-notice-body' }, errorText(testResult.message)))
							: null,
						h('div', { style: { display: 'flex', gap: 8 } },
							h('button', { type: 'button', className: 'asc-btn', disabled: testing || saving, onClick: runTest },
								testing ? h('span', { className: 'asc-spin' }) : null, testing ? t.testing : t.test),
							h('button', { type: 'button', className: 'asc-btn', 'data-variant': 'primary', style: { flex: 1, borderColor: 'color-mix(in srgb, var(--asc-primary) 45%, transparent)', color: 'var(--asc-primary)', fontWeight: 600 }, disabled: saving || testing || !canSave, onClick: runSave },
								saving ? h('span', { className: 'asc-spin' }) : null, saving ? t.saving : t.save)
						),
						saved ? h('div', { className: 'asc-notice', 'data-tone': 'ok' }, h('span', { className: 'asc-notice-body' }, t.savedOk)) : null,
						config?.configured === true
							? h('div', { className: 'asc-notice', 'data-tone': 'ok' },
								h('span', { className: 'asc-notice-body' },
									`${t.configuredOn} · ${config?.storage === 'keychain' ? t.storageKeychain : t.storageFile}`))
							: null
					),
					h(StorageSettingsCard, { config, apps, onChanged: onStorageChanged, onBusyChange: setStorageBusy, disabled: saving || testing })
				),
				h('div', { className: 'asc-settings-footer' }, t.footer)
			)
		}

		// ── 对比确认弹窗 ───────────────────────────────────────────────

		/** 原生对话框保留焦点，取消或按 Escape 均继续编辑当前草稿。 */
		function DraftDiscardDialog({ appName, onCancel, onConfirm }) {
			const { t } = useLanguage()
			const ref = React.useRef(null)
			React.useEffect(() => { ref.current?.showModal?.() }, [])
			return h('dialog', { ref, className: 'asc-storage-confirm', 'aria-labelledby': 'asc-discard-title', onCancel, onClose: onCancel },
				h('div', { className: 'asc-modal-head' }, h('strong', { id: 'asc-discard-title' }, t.discardDraftTitle)),
				h('div', { className: 'asc-modal-body' }, h('p', null, t.discardDraftMessage(appName))),
				h('div', { className: 'asc-modal-foot' },
					h('button', { type: 'button', className: 'asc-btn', autoFocus: true, onClick: onCancel }, t.keepEditing),
					h('button', { type: 'button', className: 'asc-btn', onClick: onConfirm }, t.discardAndSwitch)))
		}

		/** 结果行使用确认时的 result.synced 快照，避免刷新后 changes 下标错位。 */
		function DiffModal({ changes, syncing, result, onCancel, onConfirm, onClose }) {
			const { t, lang, localeName } = useLanguage()
			return h('div', { className: 'asc-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget && !syncing) onCancel?.() } },
				h('div', { className: 'asc-modal' },
					h('div', { className: 'asc-modal-head' },
						h('div', { className: 'asc-modal-title' }, result === null ? t.diffTitle : t.syncDone(result.succeeded, result.failed)),
						h('div', { className: 'asc-modal-sub' },
							result === null ? t.diffSub(changes.length) : (result.failed > 0 ? t.failedKeep : ''))
					),
					h('div', { className: 'asc-modal-body' },
						result === null
							? changes.map((change, index) => h('div', { key: index, className: 'asc-diff' },
								h('div', { className: 'asc-diff-head' },
									h('span', null, localeName(change.locale)),
									h('span', null, '·'),
									h('span', { className: 'asc-diff-field' }, t.fieldLabels[change.field] ?? change.field)
								),
								change.oldValue !== ''
									? h('div', { className: 'asc-diff-old', tabIndex: 0, role: 'region', 'aria-label': t.previousText }, change.oldValue)
									: null,
								h('div', null, h('span', { className: 'asc-diff-arrow' }, '→ '), null),
								h('div', { className: 'asc-diff-new', tabIndex: 0, role: 'region', 'aria-label': t.nextText }, change.newValue)
							))
							: result.results.map((entry, index) => {
								const change = (result.synced ?? changes)[entry.index]
								return h('div', { key: index, className: 'asc-result-row', 'data-ok': entry.ok ? 'true' : 'false' },
									h('div', null,
										`${entry.ok ? '✓' : '✕'} ${localeName(change?.locale ?? '')} · ${t.fieldLabels[change?.field ?? ''] ?? change?.field ?? ''}`),
									entry.ok === false && entry.error
										? h('div', { style: { fontSize: 11, whiteSpace: 'pre-line' } }, typeof entry.error === 'string' ? apiErrorMessage(entry, '', lang) : errorText(entry.error, lang))
										: null
								)
							})
					),
					h('div', { className: 'asc-modal-foot' },
						result === null
							? [
								h('button', { key: 'cancel', type: 'button', className: 'asc-btn', style: { flex: 1 }, disabled: syncing, onClick: onCancel }, t.cancel),
								h('button', { key: 'go', type: 'button', className: 'asc-btn-primary', style: { flex: 2, height: 32, fontSize: 12.5 }, disabled: syncing, onClick: onConfirm },
									syncing ? h('span', { className: 'asc-spin' }) : null, syncing ? t.syncing : t.confirmSync)
							]
							: h('button', { type: 'button', className: 'asc-btn-primary', disabled: syncing, onClick: onClose }, t.done)
					)
				)
			)
		}

		// ── 字段编辑器 ─────────────────────────────────────────────────

		/**
		 * 单个语言的一个字段。只读时也展示当前值（置灰），并在下方给出原因。
		 * @param {object} props - `{ def, entry, value, disabled, note, onChange }`。
		 * @returns {object} React 元素。
		 */
		function FieldRow({ def, entry, value, disabled, note, onChange }) {
			const { t } = useLanguage()
			const count = charCount(value)
			const over = count > def.limit
			const writable = !disabled && (def.target === 'appInfoLocalization' ? entry.appInfoLocId : entry.versionLocId) !== undefined
			return h('div', { className: 'asc-field' },
				h('div', { className: 'asc-field-head' },
					h('span', { className: 'asc-field-label' }, t.fieldLabels[def.key] ?? def.key),
					h('span', { className: 'asc-counter', 'data-over': over ? 'true' : 'false' }, `${count}/${def.limit}`)
				),
				h(def.multiline ? 'textarea' : 'input', {
					className: def.multiline ? 'asc-textarea' : 'asc-input',
					'data-over': writable && over ? 'true' : 'false',
					value,
					disabled: !writable,
					spellCheck: false,
					onChange: (event) => onChange(def.key, event.target.value)
				}),
				writable ? null : h('div', { className: 'asc-ro-note' }, note ?? t.readOnlyNote)
			)
		}

		// ── 商店页预览（对齐 Apple 2025 新版布局） ─────────────────────

		/**
		 * 预览用 App 图标（真图或字母头像，尺寸由 className 决定）。
		 * @param {object} props - `{ app, className }`。
		 * @returns {object} React 元素。
		 */
		function PreviewIcon({ app, className }) {
			if (app === null || app === undefined) return null
			if (typeof app.iconUrl === 'string' && app.iconUrl !== '') {
				return h('img', { className, src: app.iconUrl, alt: '' })
			}
			return h('span', { className, style: { background: avatarColor(String(app.id ?? 'x')) } },
				String(app.name ?? '?').trim().charAt(0).toUpperCase() || '?')
		}

		/**
		 * 预览素材槽：已上传 → 显示真实图片（object-fit: cover，CSS 负责圆角遮罩）；
		 * 未上传 → 虚线占位。加载失败自动回落占位。
		 * @param {object} props - `{ kind, appId, className, exists, version, phText, onFailure }`。
		 * @returns {object} React 元素。
		 */
		function AssetSlot({ kind, appId, className, exists, version, phText, onFailure, remoteAsset }) {
			const { t } = useLanguage()
			const aspectRatio = remoteAsset?.width > 0 && remoteAsset?.height > 0 ? remoteAsset.width / remoteAsset.height : 16 / 9
			const src = remoteAsset ? remoteAsset.imageAssetUrl.replace('{w}', '1200').replace('{h}', String(Math.round(1200 / aspectRatio))).replace('{f}', 'png')
				: `${BASE}/preview-asset?kind=${encodeURIComponent(kind)}&appId=${encodeURIComponent(appId)}&v=${encodeURIComponent(version)}&profile=${encodeURIComponent(languageProfileId || 'default')}&cacheBuster=${encodeURIComponent(PREVIEW_CACHE_BUSTER)}`
			const [failedUrl, setFailedUrl] = React.useState('')
			if (exists !== true || failedUrl === src) {
				return h('div', { className: `asc-pv-asset ${className}` },
					h('span', { style: { whiteSpace: 'pre-line' } }, failedUrl === src ? (remoteAsset ? t.pvRemoteImageError : t.pvLoadError) : phText))
			}
			return h('div', { className: `asc-pv-asset ${className}`, style: { aspectRatio, border: 'none', background: '#F2F2F4', padding: 0, overflow: 'hidden' } },
				h('img', { src, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
					onError: () => { setFailedUrl(src); onFailure?.() } }))
		}

		/** 设备内仅呈现预览，导航和获取图标不执行商店操作。 */
		function PreviewSymbol({ name }) {
			const paths = {
				today: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
				games: 'M8 8h8c4 0 6 10 3 11-2 1-3-3-5-3h-4c-2 0-3 4-5 3-3-1-1-11 3-11z M7 10v4 M5 12h4 M16 11h.1 M18 13h.1',
				apps: 'M9 4l10 17 M15 4L5 21 M3 15h18',
				arcade: 'M6 13h12l3 7H3z M12 13V7 M9 4a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M7 17h2',
				search: 'M10.5 3a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15 M16 16l5 5',
				back: 'M15 4l-8 8 8 8', share: 'M12 16V2 M7 7l5-5 5 5 M5 10v11h14V10',
				image: 'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M15 8h.1'
			}
			return h('svg', { className: 'asc-pv-symbol', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] ?? paths.image }))
		}
		function PreviewShot({ shot, index }) {
			const { t } = useLanguage()
			const [failed, setFailed] = React.useState(false)
			const src = shot.url.replace('{w}', '600').replace('{h}', '1300').replace('{f}', 'png')
			return h('figure', { className: 'asc-pv-shot' }, failed
				? h('div', { className: 'asc-pv-empty' }, h(PreviewSymbol, { name: 'image' }), t.pvImageError)
				: h('img', { src, alt: t.pvShot(index + 1), loading: 'lazy', onError: () => setFailed(true) }))
		}
		function PreviewScreenshots({ shots, loading, error, compact = false }) {
			const { t } = useLanguage()
			if (shots.length === 0) return h('div', { className: 'asc-pv-empty', role: 'status' },
				h(PreviewSymbol, { name: 'image' }), loading ? t.loading : error ? t.pvShotsError : t.pvNoShots)
			return h('div', { className: 'asc-pv-shots', 'data-compact': compact, tabIndex: 0, role: 'region', 'aria-label': t.screenshots },
				(compact ? shots.slice(0, 3) : shots).map((shot, index) => h(PreviewShot, { key: `${shot.id}:${shot.url}`, shot, index })))
		}
		function ProductPreview({ app, name, subtitle, headerNode, entry, version, shots, loading, error }) {
			const { t, localeName } = useLanguage()
			return h(React.Fragment, null,
				h('div', { className: 'asc-pv-nav', 'aria-hidden': true }, h('span', null, h(PreviewSymbol, { name: 'back' }), t.pvTabs[2]), h(PreviewSymbol, { name: 'share' })),
				headerNode,
				h('div', { className: 'asc-pv-row' }, h(PreviewIcon, { app, className: 'asc-pv-icon' }),
					h('div', { className: 'asc-pv-meta' }, h('div', { className: 'asc-pv-name' }, name || app.name),
						h('div', { className: 'asc-pv-sub' }, subtitle), h('span', { className: 'asc-pv-get' }, t.get))),
				h('div', { className: 'asc-pv-stats' }, [[t.pvVersion, version?.versionString || '—'], [t.pvLanguage, localeName(entry.locale)], [t.pvShotCount, loading || error ? '—' : String(shots.length)]].map(([label, value]) =>
					h('span', { key: label, className: 'asc-pv-stat' }, label, h('b', null, value)))),
				h('div', { className: 'asc-pv-section-title' }, t.pvScreenshots),
				h(PreviewScreenshots, { shots, loading, error }),
				entry.promotionalText ? h('p', { className: 'asc-pv-copy' }, entry.promotionalText) : null,
				entry.whatsNew ? h('section', { className: 'asc-pv-description' }, h('div', { className: 'asc-pv-section-title' }, t.pvWhatsNew), h('p', { className: 'asc-pv-copy' }, entry.whatsNew)) : null,
				entry.description ? h('details', { className: 'asc-pv-description' }, h('summary', null, t.pvDescription), h('p', { className: 'asc-pv-copy' }, entry.description)) : null)
		}
		function SearchPreview({ app, name, subtitle, searchNode, shots, loading, error }) {
			const { t } = useLanguage()
			return h(React.Fragment, null,
				h('div', { className: 'asc-pv-search-title' }, t.pvSearchPlaceholder),
				h('div', { className: 'asc-pv-searchbar' }, h(PreviewSymbol, { name: 'search' }), t.pvSearchPlaceholder),
				h('div', { className: 'asc-pv-row asc-pv-search-row' }, h(PreviewIcon, { app, className: 'asc-pv-icon asc-pv-icon-sm' }),
					h('div', { className: 'asc-pv-meta' }, h('div', { className: 'asc-pv-name' }, name || app.name), h('div', { className: 'asc-pv-sub' }, subtitle)),
					h('span', { className: 'asc-pv-get asc-pv-get-ghost' }, t.get)),
				searchNode || h('div', { className: 'asc-pv-search-shots' }, h(PreviewScreenshots, { shots, loading, error, compact: true })))
		}
		function PreviewPhone({ app, entry, version, mode, assets, remoteAssets, assetVersion, onFailure, shots, loading, error }) {
			const { t } = useLanguage()
			const kind = mode === 'product' ? 'header' : 'search'
			const remoteAsset = remoteAssets?.[kind]
			const asset = remoteAsset || assets?.[kind] ? h(AssetSlot, { kind, appId: app.id, exists: true, version: `${app.id}-${assetVersion}`, remoteAsset,
				className: kind === 'header' ? 'asc-pv-head' : 'asc-pv-asset-lg', phText: t.pvImageError, onFailure: () => onFailure({ messageKey: remoteAsset ? 'pvRemoteImageError' : 'pvLoadError' }) }) : null
			const props = { app, entry, version, name: entry.name, subtitle: entry.subtitle, shots, loading, error }
			return h('div', { className: 'asc-phone' },
				h('div', { className: 'asc-phone-screen' },
					h('div', { className: 'asc-pv-safe-area', 'aria-hidden': true }),
					h('div', { key: `${app.id}:${entry.locale}:${mode}`, className: 'asc-pv-body', tabIndex: 0, role: 'region', 'aria-label': mode === 'product' ? t.pvProduct : t.pvSearch },
						mode === 'product' ? h(ProductPreview, { ...props, headerNode: asset }) : h(SearchPreview, { ...props, searchNode: asset })),
					h('div', { className: 'asc-pv-tabs', 'aria-hidden': true }, ['today', 'games', 'apps', 'arcade', 'search'].map((name, index) =>
						h('span', { key: name, 'data-active': mode === 'search' ? index === 4 : index === 2 }, h(PreviewSymbol, { name }), t.pvTabs[index]))),
					h('div', { className: 'asc-pv-home', 'aria-hidden': true })))
		}
		function PreviewDialog({ children, onClose }) {
			const { t, lang } = useLanguage()
			const ref = React.useRef(null)
			React.useEffect(() => { ref.current?.showModal?.() }, [])
			return h('dialog', { ref, className: 'asc-preview-dialog', lang: lang === 'zh' ? 'zh-Hans' : 'en', 'aria-label': t.preview, onClose, onCancel: onClose },
				h('div', { className: 'asc-preview-dialog-head' }, h('strong', null, t.preview),
					h('button', { type: 'button', className: 'asc-btn', autoFocus: true, onClick: onClose }, t.pvClose)), children)
		}

		// ── 截图管理卡片 ───────────────────────────────────────────────

		/**
		 * 截图管理：按当前语言列出各设备规格的截图集，支持上传（自动识别规格）与删除。
		 * @param {object} props - `{ appId, version, entry, locale, onPreviewChange }`。
		 * @returns {object} React 元素。
		 */
		function ScreenshotsCard({ appId, version, entry, locale, onPreviewChange }) {
			const { t, lang, localeName } = useLanguage()
			const editable = version?.editable === true
			const versionLocId = entry?.versionLocId ?? ''
			const [sets, setSets] = React.useState([])
			const [supported, setSupported] = React.useState({})
			const [loading, setLoading] = React.useState(true)
			const [error, setError] = React.useState('')
			const [progress, setProgress] = React.useState('')
			const [typeChoice, setTypeChoice] = React.useState('auto')
			const fileRef = React.useRef(null)
			const request = React.useRef({ sequence: 0, controller: null })
			const mounted = React.useRef(true)
			const busy = React.useRef(false)
			const [deleting, setDeleting] = React.useState(false)

			const load = React.useCallback(async () => {
				if (!mounted.current) return
				request.current.controller?.abort()
				const controller = new AbortController()
				const sequence = ++request.current.sequence
				request.current.controller = controller
				const scope = `${appId}:${versionLocId}`
				setSets([])
				setError('')
				if (versionLocId === '') {
					setLoading(false)
					onPreviewChange?.({ scope, sets: [], loading: false, error: '' })
					return
				}
				setLoading(true)
				onPreviewChange?.({ scope, sets: [], loading: true, error: '' })
				try {
					const payload = await apiGet(`${BASE}/screenshots?versionLocId=${encodeURIComponent(versionLocId)}`, controller.signal)
					if (!mounted.current || sequence !== request.current.sequence || controller.signal.aborted) return
					const nextSets = Array.isArray(payload?.sets) ? payload.sets : []
					setSets(nextSets)
					setSupported(payload?.supported ?? {})
					onPreviewChange?.({ scope, sets: nextSets, loading: false, error: '' })
				} catch (reason) {
					if (mounted.current && sequence === request.current.sequence && !controller.signal.aborted) {
						const message = reason
						setError(message)
						onPreviewChange?.({ scope, sets: [], loading: false, error: message })
					}
				} finally {
					if (mounted.current && sequence === request.current.sequence) setLoading(false)
				}
			}, [appId, versionLocId, onPreviewChange])

			React.useEffect(() => {
				mounted.current = true
				void load()
				return () => { mounted.current = false; request.current.sequence += 1; request.current.controller?.abort() }
			}, [load])

			/** 读取图片像素尺寸（createImageBitmap 优先，老引擎回落 Image）。 */
			const readDims = async (file) => {
				try {
					const bitmap = await createImageBitmap(file)
					const dims = { w: bitmap.width, h: bitmap.height }
					bitmap.close?.()
					return dims
				} catch { /* 回落 */ }
				return await new Promise((resolve, reject) => {
					const img = new Image()
					const url = URL.createObjectURL(file)
					img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }) }
					img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t.shotsReadErr)) }
					img.src = url
				})
			}

			/** 从 host 下发的规格表里按尺寸猜设备规格。 */
			const guessType = React.useCallback((w, h) => {
				for (const [key, def] of Object.entries(supported)) {
					if ((def.sizes ?? []).some(([sw, sh]) => sw === w && sh === h)) return key
				}
				return undefined
			}, [supported])

			const pickFiles = () => { fileRef.current?.click() }

			const onFiles = async (event) => {
				const files = [...(event.target?.files ?? [])]
				event.target.value = ''
				if (files.length === 0 || loading || busy.current || !editable || !versionLocId) return
				busy.current = true
				setError('')
				let failure, attempted = false
				try {
					let done = 0
					for (const file of files) {
						if (!mounted.current) return
						done += 1
						setProgress(`${lang === 'zh' ? '上传中' : 'Uploading'} ${done}/${files.length}…`)
						const dims = await readDims(file)
						const displayType = typeChoice !== 'auto' ? typeChoice : guessType(dims.w, dims.h)
						if (typeof displayType !== 'string' || displayType === '') {
							throw new Error(`${t.shotsNoType}（${dims.w}×${dims.h}）`)
						}
						const dataUrl = await new Promise((resolve, reject) => {
							const reader = new FileReader()
							reader.onload = () => resolve(String(reader.result))
							reader.onerror = () => reject(new Error(t.shotsReadErr))
							reader.readAsDataURL(file)
						})
						if (!mounted.current) return
						attempted = true
						await apiPost(`${BASE}/screenshots`, { action: 'upload', appId, versionLocId, displayType, fileName: file.name, dataUrl })
					}
				} catch (reason) {
					failure = reason
				} finally {
					// 部分成功或响应丢失也要刷新，以 ASC 当前状态为准，保留失败提示。
					if (mounted.current && attempted) await load()
					busy.current = false
					if (mounted.current) { if (failure) setError(failure); setProgress('') }
				}
			}

			const removeShot = async (screenshotId) => {
				if (loading || busy.current || !editable || !versionLocId || !mounted.current) return
				busy.current = true
				setDeleting(true)
				setError('')
				try {
					await apiPost(`${BASE}/screenshots`, { action: 'delete', appId, versionLocId, screenshotId })
					if (mounted.current) await load()
				} catch (reason) {
					if (mounted.current) setError(reason)
				} finally { busy.current = false; if (mounted.current) setDeleting(false) }
			}

			return h('div', { className: 'asc-card' },
				h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
					h('div', { className: 'asc-section-title', style: { margin: 0 } }, `${t.shotsTitle} · ${localeName(locale)}`),
					editable
						? h('select', {
							className: 'asc-input',
							style: { marginLeft: 'auto', height: 24, fontSize: 11, padding: '0 6px', borderRadius: 8, width: 'auto' },
							value: typeChoice,
							onChange: (event) => setTypeChoice(event.target.value)
						},
							h('option', { value: 'auto' }, t.shotsAuto),
							Object.entries(supported).map(([key, def]) => h('option', { key, value: key }, def.label ?? key)))
						: null),
				loading ? h('div', { className: 'asc-empty' }, t.loading) : null,
				error === '' ? null : h('div', { className: 'asc-notice', 'data-tone': 'err' }, h('span', { className: 'asc-notice-body' }, errorText(error))),
				progress === '' ? null : h('div', { className: 'asc-notice', 'data-tone': 'ok' }, h('span', { className: 'asc-notice-body' }, progress)),
				!loading && sets.length === 0
					? h('div', { className: 'asc-empty' }, editable ? t.shotsEmpty : t.shotsReadOnly)
					: !loading ? sets.map((set) => h('div', { key: set.id, style: { marginBottom: 10 } },
						h('div', { className: 'asc-field-label', style: { marginBottom: 4 } }, `${set.label} · ${set.screenshots.length}`),
						h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' } },
							set.screenshots.map((shot) => h('div', { key: shot.id, style: { position: 'relative' } },
								typeof shot.url === 'string' && shot.url !== ''
									? h('img', {
										// bb = 边界盒模式，保持原始宽高比（iPad/Duo/横屏不被裁切）
										src: shot.url.replace('{w}', '160').replace('{h}', '160').replace('{f}', 'png'),
										style: { height: 100, width: 'auto', maxWidth: 160, borderRadius: 8, border: '1px solid var(--asc-line)', display: 'block', background: 'var(--asc-fill)' },
										alt: ''
									})
									: h('div', {
										style: { width: 64, height: 100, borderRadius: 8, background: 'var(--asc-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--asc-text-3)' }
									}, shot.state),
								editable
									? h('button', {
										type: 'button',
										'aria-label': t.shotsDelete,
										disabled: loading || deleting || progress !== '',
										title: t.shotsDelete,
										onClick: () => { void removeShot(shot.id) },
										style: { position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, border: 0, background: 'var(--asc-err)', color: '#fff', fontSize: 10, lineHeight: '16px', cursor: 'pointer', padding: 0 }
									}, '×')
									: null
							)))
					)) : null,
				h('div', { className: 'asc-ro-note', style: { marginTop: 2 } }, t.shotsDuoHint),
				editable
					? h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
						h('button', { type: 'button', className: 'asc-btn', disabled: loading || deleting || progress !== '' || !versionLocId, onClick: pickFiles }, progress !== '' ? h('span', { className: 'asc-spin' }) : null, t.shotsUpload))
					: h('div', { className: 'asc-ro-note' }, t.shotsReadOnly),
				h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg', multiple: true, style: { display: 'none' }, onChange: onFiles })
			)
		}

		// ── 提交前检查卡片 ─────────────────────────────────────────────

		/**
		 * 提交前检查：点按钮运行只读规则检查（文案完整性/字数/截图），展示结果。
		 * @param {object} props - `{ appId, version }`。
		 * @returns {object} React 元素。
		 */
		function PrecheckCard({ appId, version }) {
			const { t, lang } = useLanguage()
			const [results, setResults] = React.useState(null)
			const [running, setRunning] = React.useState(false)
			const [error, setError] = React.useState('')

			const run = async () => {
				setRunning(true)
				setError('')
				try {
					const payload = await apiGet(`${BASE}/precheck?id=${encodeURIComponent(appId)}`)
					setResults(Array.isArray(payload?.results) ? payload.results : [])
				} catch (reason) {
					setError(reason)
				} finally {
					setRunning(false)
				}
			}

			return h('div', { className: 'asc-card' },
				h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
					h('div', { className: 'asc-section-title', style: { margin: 0 } }, t.checks),
					h('button', {
						type: 'button', className: 'asc-btn', style: { marginLeft: 'auto' },
						disabled: running || version === null, onClick: () => { void run() }
					},
						running ? h('span', { className: 'asc-spin' }) : null, running ? t.checksRunning : t.checksRun)),
				version === null ? h('div', { className: 'asc-ro-note' }, t.noVersionNote) : null,
				error === '' ? null : h('div', { className: 'asc-notice', 'data-tone': 'err' }, h('span', { className: 'asc-notice-body' }, errorText(error))),
				results === null && !running && version !== null
					? h('div', { className: 'asc-ro-note' }, t.checksHint)
					: null,
				results !== null
					? results.map((item, index) => h('div', { key: index, className: 'asc-check-row' },
						h('span', { className: 'asc-check-dot', 'data-level': item.level }),
						h('span', null, lang === 'en' ? (item.messageEn ?? item.message) : item.message)))
					: null)
		}

		// ── 主面板 ─────────────────────────────────────────────────────

		// 回执按账号和会话隔离；面板重挂载后也不会把回执失败的建议再次覆盖到草稿。
		const agentReceipts = new Map()
		function useAgentDraftQueue({ sessionId, config, active }) {
			const scope = JSON.stringify([config?.profileId, config?.issuerId, config?.keyId, sessionId])
			if (!agentReceipts.has(scope)) agentReceipts.set(scope, { handled: new Set(), pending: new Set() })
			const receipts = agentReceipts.get(scope)
			const [proposals, setProposals] = React.useState([])
			const [available, setAvailable] = React.useState(true)
			const [error, setError] = React.useState('')
			const [ackFailed, setAckFailed] = React.useState(receipts.pending.size > 0)
			const [revision, setRevision] = React.useState(0)
			const [polling, setPolling] = React.useState(false)
			const [foreground, setForeground] = React.useState(document.visibilityState !== 'hidden')
			const acknowledge = React.useRef(null)
			const retryRequested = React.useRef(false)
			const enabled = Boolean(sessionId && active && foreground)
			React.useEffect(() => {
				const update = () => setForeground(document.visibilityState !== 'hidden')
				document.addEventListener('visibilitychange', update)
				return () => document.removeEventListener('visibilitychange', update)
			}, [])
			React.useEffect(() => {
				if (!enabled) return
				let cancelled = false, timer
				const controller = new AbortController()
				const acknowledging = new Set()
				const ack = async (id) => {
					if (cancelled || acknowledging.has(id)) return
					acknowledging.add(id)
					try {
						await apiPost(`${BASE}/agent-drafts`, { sessionId, id, action: 'acknowledge' }, controller.signal)
						if (!cancelled) receipts.pending.delete(id)
					} catch { /* 保留回执，下次刷新重试；不再次填入。 */ }
					finally {
						acknowledging.delete(id)
						if (!cancelled) setAckFailed(receipts.pending.size > 0)
					}
				}
				acknowledge.current = ack
				const poll = async () => {
					setPolling(true)
					try {
						const payload = await apiGet(`${BASE}/agent-drafts?sessionId=${encodeURIComponent(sessionId)}`, controller.signal)
						if (cancelled) return
						setAvailable(payload.available !== false)
						setError('')
						const incoming = payload.available === false ? [] : (Array.isArray(payload.drafts) ? payload.drafts : [])
						const retryFailed = retryRequested.current
						retryRequested.current = false
						setProposals((previous) => incoming.filter((item) => item && typeof item.id === 'string' && !receipts.handled.has(item.id))
							.map((item) => {
								const retained = previous.find((entry) => entry.id === item.id)
								// 手动刷新只重试临时读取失败；真实冲突仍留给用户处理。
								return retained && retryFailed && retained.retryable
									? { ...retained, reviewed: false, conflicts: undefined, retryable: false }
									: retained ?? { ...item, reviewed: false }
							}))
						for (const id of receipts.pending) { if (cancelled) break; await ack(id) }
					} catch (reason) { if (!cancelled) setError(reason) }
					finally {
						if (!cancelled) { setPolling(false); timer = window.setTimeout(poll, 2000) }
					}
				}
				void poll()
				return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); acknowledge.current = null }
			}, [enabled, sessionId, scope, revision])
			const finish = (id) => {
				receipts.handled.add(id)
				receipts.pending.add(id)
				setProposals((previous) => previous.filter((item) => item.id !== id))
				if (enabled) void acknowledge.current?.(id)
			}
			const review = (id, conflicts, retryable = false) => {
				if (conflicts.length === 0) { finish(id); return }
				setProposals((previous) => previous.map((item) => item.id === id ? { ...item, reviewed: true, conflicts, retryable } : item))
			}
			return { proposals, available, error, ackFailed, polling, enabled, finish, review, refresh: () => { retryRequested.current = true; setRevision((value) => value + 1) } }
		}

		/** 在最新 ASC 基线上合并安全建议，人工改动和资源身份变化一律留待检查。 */
		function mergeAgentDraft(proposal, detail, drafts) {
			const next = { ...drafts }, conflicts = []
			let applied = 0, firstLocale = ''
			for (const change of proposal.changes ?? []) {
				const def = FIELD_DEFS.find((item) => item.key === change.field)
				const entry = detail.locales?.find((item) => item.locale === change.locale)
				const targetId = def?.target === 'appInfoLocalization' ? entry?.appInfoLocId : entry?.versionLocId
				let reason = ''
				if (!def || typeof change.value !== 'string' || typeof change.baseValue !== 'string' || isOverLimit(change.field, change.value)) reason = 'agentInvalid'
				else if (proposal.app?.id !== detail.app?.id || (proposal.versionId ?? null) !== (detail.version?.id ?? null) || !targetId || targetId !== change.targetId) reason = 'agentTargetConflict'
				else if (def.target === 'appInfoLocalization' ? detail.appInfo?.editable !== true
					: !(detail.version?.promoOnly === true ? change.field === 'promotionalText' : detail.version?.editable === true)) reason = 'agentReadonly'
				else {
					const remote = String(entry[change.field] ?? '')
					const current = next[change.locale]?.[change.field] ?? remote
					if (current === change.value) continue
					if (remote !== change.baseValue) reason = 'agentRemoteConflict'
					else if (current !== remote) reason = 'agentLocalConflict'
					else {
						next[change.locale] = { ...(next[change.locale] ?? {}), [change.field]: change.value }
						applied += 1
						if (!firstLocale) firstLocale = change.locale
					}
				}
				if (reason) conflicts.push({ ...change, reason })
			}
			return { drafts: next, conflicts, applied, firstLocale }
		}

		/**
		 * 主面板。
		 * @param {object} props - `{ config, onOpenSettings }`。
		 * @returns {object} React 元素。
		 */
		function MainView({ config, sessionId, isVisible, onOpenSettings, onAppsLoaded, hidden = false, storageRevision = 0, updateState }) {
			const { t, lang, localeName, ascStateText } = useLanguage()
			const [apps, setApps] = React.useState([])
			const [appsState, setAppsState] = React.useState('loading') // loading | ready | error
			const [appsError, setAppsError] = React.useState('')
			const [selectedId, setSelectedId] = React.useState('')
			const [menuOpen, setMenuOpen] = React.useState(false)
			const [detail, setDetail] = React.useState(null)
			const [detailState, setDetailState] = React.useState('idle') // idle | loading | ready | error
			const [detailError, setDetailError] = React.useState('')
			const [locale, setLocale] = React.useState('')
			const [drafts, setDrafts] = React.useState({})
			const draftsRef = React.useRef(drafts)
			draftsRef.current = drafts
			const agent = useAgentDraftQueue({ sessionId, config, active: isVisible && !hidden })
			const [agentExpanded, setAgentExpanded] = React.useState(false)
			const [agentApplied, setAgentApplied] = React.useState(0)
			const [agentSwitchBlocked, setAgentSwitchBlocked] = React.useState(false)
			const [modal, setModal] = React.useState(null) // null | diff | result | discard
			const [syncing, setSyncing] = React.useState(false)
			const [previewMode, setPreviewMode] = React.useState('product') // product | search
			const [previewExpanded, setPreviewExpanded] = React.useState(false)
			const [shotPreview, setShotPreview] = React.useState(null)
			const [previewAssets, setPreviewAssets] = React.useState({}) // { [appId]: { header, search } }
			const [remotePreview, setRemotePreview] = React.useState(null)
			const [previewSources, setPreviewSources] = React.useState({})
			const [ascSync, setAscSync] = React.useState({}) // { [appId]: { header: meta|null, search: meta|null } }
			const [assetVersion, setAssetVersion] = React.useState(0)
			React.useEffect(() => {
				if (storageRevision === 0) return
				setPreviewAssets({})
				setAssetVersion((current) => current + 1)
			}, [storageRevision])
			const [previewError, setPreviewError] = React.useState('')
			const [syncingAscKind, setSyncingAscKind] = React.useState('')
			const fileRef = React.useRef(null)
			const uploadKindRef = React.useRef('header')
			const selectedRef = React.useRef(selectedId)
			const detailRequest = React.useRef({ sequence: 0, controller: null })
			const appsRequest = React.useRef(0)
			const assetRequest = React.useRef(0)
			const assetBusy = React.useRef(false)
			selectedRef.current = selectedId
			const activeDetail = detail?.app?.id === selectedId ? detail : null
			const activeLocId = activeDetail?.locales?.find((item) => item.locale === locale)?.versionLocId ?? ''
			const assetScope = `${selectedId}:${activeLocId}`
			const assetScopeRef = React.useRef(assetScope)
			assetScopeRef.current = assetScope
			React.useEffect(() => () => {
				detailRequest.current.sequence += 1
				detailRequest.current.controller?.abort()
				appsRequest.current += 1
				assetRequest.current += 1
			}, [])


			const loadApps = React.useCallback(async () => {
				const sequence = ++appsRequest.current
				setAppsState('loading')
				setAppsError('')
				try {
					const payload = await apiGet(`${BASE}/apps`)
					if (sequence !== appsRequest.current) return
					const list = Array.isArray(payload?.apps) ? payload.apps : []
					setApps(list)
					onAppsLoaded?.(list)
					setAppsState('ready')
					let next = 0
					await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
						while (next < list.length && sequence === appsRequest.current) {
							const app = list[next++]
							if (app.iconUrl) continue
							try {
								const icon = await apiGet(`${BASE}/icon?id=${encodeURIComponent(app.id)}`)
								if (sequence === appsRequest.current && icon.iconUrl) setApps((current) => current.map((item) => item.id === app.id ? { ...item, iconUrl: icon.iconUrl } : item))
							} catch { /* 图标失败不影响选择 App。 */ }
						}
					}))
				} catch (reason) {
					if (sequence !== appsRequest.current) return
					setAppsError(reason)
					setAppsState('error')
				}
			}, [onAppsLoaded])

			const loadDetail = React.useCallback(async (appId) => {
				if (appId === '' || appId !== selectedRef.current) return
				detailRequest.current.controller?.abort()
				const controller = new AbortController()
				const sequence = ++detailRequest.current.sequence
				detailRequest.current.controller = controller
				const isCurrent = () => sequence === detailRequest.current.sequence && appId === selectedRef.current
				setDetailState('loading')
				setDetailError('')
				try {
					const payload = await apiGet(`${BASE}/app?id=${encodeURIComponent(appId)}`, controller.signal)
					if (!isCurrent()) return
					if (payload?.app?.id !== appId) throw new Error(STR[resolvedLanguage()].appMismatch)
					setDetail(payload)
					setLocale((current) => {
						const locales = Array.isArray(payload?.locales) ? payload.locales : []
						return locales.some((entry) => entry.locale === current) ? current : (locales[0]?.locale ?? '')
					})
					setDetailState('ready')
				} catch (reason) {
					if (!isCurrent() || controller.signal.aborted) return
					setDetailError(reason)
					setDetailState('error')
				}
			}, [])

			React.useEffect(() => { void loadApps() }, [loadApps])
			React.useEffect(() => {
				if (selectedId === '' || activeLocId === '') return
				const sequence = ++assetRequest.current
				const controller = new AbortController()
				Promise.all(['header', 'search'].map(async (kind) => {
					const payload = await apiGet(`${BASE}/preview-asset?kind=${kind}&appId=${selectedId}&versionLocId=${activeLocId}&meta=1`, controller.signal)
					return [kind, { exists: payload?.exists === true, asc: payload?.asc ?? null }]
				})).then((entries) => {
					if (sequence !== assetRequest.current || controller.signal.aborted) return
					setPreviewAssets((previous) => ({ ...previous, [selectedId]: Object.fromEntries(entries.map(([kind, value]) => [kind, value.exists])) }))
					setAscSync((previous) => ({ ...previous, [assetScope]: Object.fromEntries(entries.map(([kind, value]) => [kind, value.asc])) }))
				}).catch((reason) => {
					if (sequence === assetRequest.current && !controller.signal.aborted) setPreviewError(reason)
				})
				return () => controller.abort()
			}, [selectedId, activeLocId, assetScope, assetVersion])

			React.useEffect(() => {
				if (!selectedId || !activeLocId) return
				const controller = new AbortController()
				setRemotePreview({ scope: assetScope, assets: [], loading: true, error: '' })
				apiGet(`${BASE}/creative-assets?appId=${encodeURIComponent(selectedId)}&versionLocId=${encodeURIComponent(activeLocId)}`, controller.signal)
					.then((payload) => {
						if (!Array.isArray(payload.assets)) throw new Error(t.pvRemoteError)
						if (!controller.signal.aborted) setRemotePreview({ scope: assetScope, assets: payload.assets, loading: false, error: '' })
					}).catch((reason) => {
						if (!controller.signal.aborted) setRemotePreview({ scope: assetScope, assets: [], loading: false, error: reason })
					})
				return () => controller.abort()
			}, [selectedId, activeLocId, assetScope, assetVersion, detail])

			React.useEffect(() => {
				if (selectedId !== '') void loadDetail(selectedId)
			}, [selectedId, loadDetail])

			/** 切换 App：清空草稿与详情。 */
			React.useEffect(() => { setPreviewError('') }, [assetScope])

			const switchApp = (appId) => {
				setModal(null)
				setAgentSwitchBlocked(false)
				selectedRef.current = appId
				detailRequest.current.sequence += 1
				detailRequest.current.controller?.abort()
				setSelectedId(appId)
				setDetail(null)
				draftsRef.current = {}
				setDrafts({})
				setLocale('')
			}
			const hasUnsyncedDrafts = activeDetail
				? buildChanges(activeDetail.locales ?? [], drafts).length > 0
				: Object.keys(drafts).length > 0
			const pickApp = (appId) => {
				setMenuOpen(false)
				if (appId === selectedId || syncing || modal !== null) return
				if (hasUnsyncedDrafts) { setModal({ phase: 'discard', appId }); return }
				switchApp(appId)
			}
			React.useEffect(() => {
				if (!hasUnsyncedDrafts) return
				const warnBeforeLeaving = (event) => { event.preventDefault(); event.returnValue = '' }
				window.addEventListener('beforeunload', warnBeforeLeaving)
				return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
			}, [hasUnsyncedDrafts])

			/** 记一处草稿编辑。 */
			const editField = (field, value) => {
				const next = { ...draftsRef.current, [locale]: { ...(draftsRef.current[locale] ?? {}), [field]: value } }
				draftsRef.current = next
				setDrafts(next)
			}

			const agentCandidate = agent.proposals.find((item) => !item.reviewed && (!selectedId || item.app?.id === selectedId))
			React.useEffect(() => {
				if (!agent.enabled || syncing || modal !== null || !agentCandidate || appsState !== 'ready') return
				if (!apps.some((app) => app.id === agentCandidate.app?.id)) return
				if (!selectedId) { pickApp(agentCandidate.app.id); return }
				if (detailState !== 'ready') return
				let cancelled = false
				const controller = new AbortController()
				// 单独读取基线；弹窗或同步开始后取消，避免改变已展示的同步快照。
				apiGet(`${BASE}/app?id=${encodeURIComponent(selectedId)}`, controller.signal).then((fresh) => {
					if (cancelled || controller.signal.aborted || document.visibilityState === 'hidden' || selectedRef.current !== selectedId) return
					if (fresh.app?.id !== selectedId) throw new Error(STR[resolvedLanguage()].appMismatch)
					const merged = mergeAgentDraft(agentCandidate, fresh, draftsRef.current)
					setDetail(fresh)
					draftsRef.current = merged.drafts
					setDrafts(merged.drafts)
					if (merged.firstLocale) setLocale(merged.firstLocale)
					if (merged.applied) setAgentApplied(merged.applied)
					if (merged.conflicts.length) setAgentExpanded(true)
					agent.review(agentCandidate.id, merged.conflicts)
				}).catch(() => {
					if (cancelled || controller.signal.aborted) return
					agent.review(agentCandidate.id, (agentCandidate.changes ?? []).map((change) => ({ ...change, reason: 'agentLoadFailed' })), true)
					setAgentExpanded(true)
				})
				return () => { cancelled = true; controller.abort() }
			}, [agentCandidate?.id, selectedId, appsState, detailState, agent.enabled, syncing, modal !== null])

			const viewAgentDrafts = () => {
				setAgentExpanded((current) => !current)
				const proposal = agent.proposals[0]
				if (!proposal || proposal.app?.id === selectedId || syncing || modal !== null) return
				if (buildChanges(activeDetail?.locales ?? [], draftsRef.current).length > 0) { setAgentSwitchBlocked(true); return }
				if (!apps.some((app) => app.id === proposal.app?.id)) return
				setAgentSwitchBlocked(false)
				pickApp(proposal.app.id)
			}

			/** 选择本地素材文件并上传到 host（仅存本机，用于预览回显）。 */
			const pickAsset = (kind) => {
				uploadKindRef.current = kind
				fileRef.current?.click()
			}
			const onAssetFile = async (event) => {
				const file = event.target?.files?.[0]
				event.target.value = ''
				const kind = uploadKindRef.current
				const appId = selectedApp?.id ?? ''
				const scope = assetScope
				if (file === undefined || file === null || appId === '') return
				setPreviewError('')
				try {
					const dataUrl = await new Promise((resolve, reject) => {
						const reader = new FileReader()
						reader.onload = () => resolve(String(reader.result))
						reader.onerror = () => reject(new Error(t.fileReadError))
						reader.readAsDataURL(file)
					})
					await apiPost(`${BASE}/preview-asset`, { kind, appId, dataUrl })
					setPreviewSources((previous) => ({ ...previous, [scope]: { ...(previous[scope] ?? {}), [kind]: 'local' } }))
					setPreviewAssets((previous) => ({
						...previous,
						[appId]: { ...(previous[appId] ?? {}), [kind]: true }
					}))
					setAssetVersion((version) => version + 1)
				} catch (reason) {
					setPreviewError(reason)
				}
			}
			const removeAsset = async (kind) => {
				setPreviewError('')
				try {
					await apiPost(`${BASE}/preview-asset`, { action: 'remove', kind, appId: selectedApp?.id })
					setPreviewAssets((previous) => ({
						...previous,
						[selectedApp?.id ?? '']: { ...(previous[selectedApp?.id ?? ''] ?? {}), [kind]: false }
					}))
				} catch (reason) {
					setPreviewError(reason)
				}
			}
			/** 每次操作冻结 App 与版本语言；结果只更新对应记录。 */
			const performAssetAction = async (kind, action) => {
				if (assetBusy.current || !activeLocId || detailState !== 'ready') return
				if (action !== 'state' && !activeDetail?.version?.editable) return
				const scope = assetScope
				assetBusy.current = true
				assetRequest.current += 1
				setPreviewError('')
				setSyncingAscKind(kind)
				try {
					const payload = await apiPost(`${BASE}/asset-to-asc`, { action, kind, appId: selectedId, versionLocId: activeLocId })
					const meta = action === 'state' ? payload.asc : action === 'remove' ? null : payload
					setAscSync((previous) => ({ ...previous, [scope]: { ...(previous[scope] ?? {}), [kind]: meta } }))
					if (payload.warning && scope === assetScopeRef.current) setPreviewError({ warning: payload.warning, warningEn: payload.warningEn })
				} catch (reason) {
					if (scope === assetScopeRef.current) setPreviewError(reason)
				} finally {
					assetBusy.current = false
					setSyncingAscKind('')
					setAssetVersion((current) => current + 1)
				}
			}
			const syncAssetToAsc = (kind) => performAssetAction(kind, 'upload')
			const withdrawFromAsc = (kind) => performAssetAction(kind, 'remove')
			const refreshAscState = (kind) => performAssetAction(kind, 'state')

			const changes = React.useMemo(
				() => detailState === 'ready' ? buildChanges(activeDetail?.locales ?? [], drafts) : [],
				[activeDetail, detailState, drafts])
			// 预览模式 → 素材种类的键名映射（product→header，search→search）。
			const currentAssetKind = previewMode === 'product' ? 'header' : 'search'
			const currentAssetExists = previewAssets[selectedId]?.[currentAssetKind] === true
			const overLimit = hasOverLimitChange(changes)
			const selectedApp = apps.find((app) => app.id === selectedId) ?? null
			const entry = activeDetail?.locales?.find((item) => item.locale === locale) ?? null
			const version = activeDetail?.version ?? null
			const previewData = shotPreview?.scope === assetScope ? shotPreview : null
			const readyShots = (set) => (set?.screenshots ?? []).filter((shot) => shot.state === 'COMPLETE' && typeof shot.url === 'string' && shot.url !== '')
			// 普通 iPhone 机框不使用折叠屏或 iPad 截图，排序不能依赖 ASC 返回顺序。
			const phoneTypes = ['APP_IPHONE_67', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_55']
			const previewSet = (previewData?.sets ?? []).filter((set) => phoneTypes.includes(set.displayType) && readyShots(set).length > 0)
				.sort((a, b) => phoneTypes.indexOf(a.displayType) - phoneTypes.indexOf(b.displayType))[0]
			const remoteData = remotePreview?.scope === assetScope ? remotePreview : null
			const selectedRemote = {}
			const selectedAssets = {}
			const profileRank = (asset) => asset.displayClassId === 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY' ? 0 : asset.displayClassId?.includes('DYNAMIC_ISLAND') ? 1 : asset.displayClassId === 'DEFAULT' ? 3 : 2
			for (const kind of ['header', 'search']) {
				const candidates = (remoteData?.assets ?? []).filter((asset) => asset.kind === kind && asset.imageAssetUrl &&
					(asset.displayClassId === 'DEFAULT' || (asset.deviceFamily === 'IPHONE' && !asset.displayClassId?.includes('DUO'))))
				selectedRemote[kind] = candidates.sort((a, b) => profileRank(a) - profileRank(b) || String(a.placementId).localeCompare(String(b.placementId)))[0]
				selectedAssets[kind] = previewSources[assetScope]?.[kind] === 'local' && previewAssets[selectedId]?.[kind] ? null : selectedRemote[kind]
			}
			const previewProps = { app: selectedApp, entry: { ...entry, ...(drafts[locale] ?? {}) }, version, mode: previewMode,
				assets: previewAssets[selectedId], remoteAssets: selectedAssets, assetVersion, onFailure: setPreviewError,
				shots: readyShots(previewSet), loading: !previewData || previewData.loading, error: previewData?.error }
			React.useEffect(() => { setPreviewExpanded(false) }, [assetScope])

			/** 执行同步：POST 后展示逐条结果，再拉一次详情。 */
			const runSync = async () => {
				if (syncing || detailState !== 'ready' || !activeDetail || modal?.phase !== 'diff' || !modal.changes.length) return
				setSyncing(true)
				// 发送用户打开确认框时看到的快照，刷新或后续编辑不能暗中替换确认内容。
				const { changes: synced, appId, versionId } = modal
				try {
					const payload = await apiPost(`${BASE}/sync`, {
						appId, versionId,
						changes: synced.map((change) => ({
							target: change.target,
							id: change.id,
							attributes: { [change.field]: change.newValue },
							baseValues: { [change.field]: change.oldValue }
						}))
					})
					const result = {
						succeeded: Number(payload?.succeeded ?? 0),
						failed: Number(payload?.failed ?? 0),
						results: Array.isArray(payload?.results) ? payload.results : [],
						synced
					}
					if (selectedRef.current !== appId) return
					setDrafts((previous) => {
						const next = { ...previous }
						for (const item of result.results) {
							const change = synced[item.index]
							if (!item.ok || !change || next[change.locale]?.[change.field] !== change.newValue) continue
							next[change.locale] = { ...next[change.locale] }
							delete next[change.locale][change.field]
							if (Object.keys(next[change.locale]).length === 0) delete next[change.locale]
						}
						draftsRef.current = next
						return next
					})
					setModal({ phase: 'result', result })
					await loadDetail(appId)
				} catch (reason) {
					setModal({ phase: 'result', result: { succeeded: 0, failed: synced.length, results: synced.map((_change, index) => ({ index, ok: false, error: reason })), synced } })
				} finally {
					setSyncing(false)
				}
			}

			return h('div', { className: 'asc-root', hidden, lang: lang === 'zh' ? 'zh-Hans' : 'en' },
				h('div', { className: 'asc-head' },
					h('span', { className: 'asc-head-title' }, t.title),
					h('span', { className: 'asc-conn' },
						h('span', { className: 'asc-conn-dot', 'data-on': config?.configured === true ? 'true' : 'false' }),
						config?.configured === true ? t.connected : t.notConnected),
					h('span', { className: 'asc-head-actions' },
						h('button', { type: 'button', className: 'asc-iconbtn', title: t.refresh, 'aria-label': t.refresh, disabled: detailState === 'loading', onClick: () => { void loadApps(); if (selectedId !== '') void loadDetail(selectedId) } }, h(RefreshIcon)),
						h('button', { type: 'button', className: 'asc-iconbtn', title: t.settings, 'aria-label': t.settings, disabled: syncing || modal !== null, onClick: onOpenSettings }, h(GearIcon))
					)
				),
				h('div', { className: 'asc-scroll' },
					h(UpdateInfo, { state: updateState, compact: true }),
					h('section', { className: 'asc-card asc-agent', 'aria-label': 'Agent' },
						h('div', { className: 'asc-coming-title' }, 'Agent'),
						h('div', { className: 'asc-filehint' }, t.agentHint),
						h('div', { role: 'status', className: 'asc-filehint', style: { marginTop: 6 } },
							!sessionId ? t.agentNoSession : !agent.available ? t.agentUnavailable : agent.proposals.length ? t.agentPending(agent.proposals.length) : agentApplied ? t.agentApplied(agentApplied) : t.agentWaiting),
						sessionId ? h('div', { className: 'asc-agent-actions' },
							h('button', { type: 'button', className: 'asc-btn', disabled: !agent.enabled || agent.polling, onClick: agent.refresh }, t.agentRefresh),
							agent.proposals.length ? h('button', { type: 'button', className: 'asc-btn', disabled: !agent.enabled || syncing || modal !== null, 'aria-expanded': agentExpanded, onClick: viewAgentDrafts }, t.agentView) : null) : null,
						agent.error ? h('div', { role: 'alert', className: 'asc-filehint' }, errorText(agent.error)) : null,
						agent.ackFailed ? h('div', { role: 'alert', className: 'asc-filehint' }, t.agentAckFailed) : null,
						agentSwitchBlocked ? h('div', { role: 'alert', className: 'asc-filehint' }, t.agentSwitchBlocked) : null,
						agentExpanded ? agent.proposals.map((proposal) => h('div', { className: 'asc-agent-review', key: proposal.id },
							h('strong', null, `${proposal.app?.name ?? proposal.app?.id ?? ''}${proposal.versionString ? ` · v${proposal.versionString}` : ''}`),
							proposal.reviewed ? h('div', { className: 'asc-filehint' }, t.agentConflict) : null,
							(proposal.conflicts ?? proposal.changes ?? []).map((change, index) => h('div', { key: `${change.locale}:${change.field}:${index}` },
								h('div', { className: 'asc-filehint', style: { marginTop: 8 } }, `${localeName(change.locale)} · ${t.fieldLabels?.[change.field] ?? change.field}${change.reason ? ` · ${t[change.reason]}` : ''}`),
								h('div', { className: 'asc-agent-copy' }, change.value))),
							h('button', { type: 'button', className: 'asc-btn', style: { marginTop: 8 }, disabled: !agent.enabled || syncing || modal !== null, onClick: () => agent.finish(proposal.id) }, t.agentKeep))) : null
					),
					// App 选择卡片
					h('div', { className: 'asc-card asc-appcard' },
						h('div', { className: 'asc-approw' },
							h('button', {
								type: 'button', className: 'asc-appbtn', disabled: syncing || modal !== null,
								onClick: () => setMenuOpen((open) => !open)
							},
								selectedApp !== null
									? h(AppAvatar, { app: selectedApp })
									: h('span', { className: 'asc-avatar-letter', style: { background: 'var(--asc-fill)', color: 'var(--asc-text-3)' } }, '?'),
								h('span', { className: 'asc-appmeta' },
									h('span', { className: 'asc-appname' },
										selectedApp !== null ? selectedApp.name : t.chooseApp),
									h('span', { className: 'asc-appsub' },
										selectedApp !== null ? `${selectedApp.bundleId}${detail?.version ? ` · v${detail.version.versionString}` : ''}` : '')),
								h('span', { style: { color: 'var(--asc-text-3)', fontSize: 10 } }, '▼')
							),
							version !== null ? h(StatePill, { state: version.appStoreState }) : null
						),
						menuOpen
							? [
								h('div', { key: 'backdrop', className: 'asc-backdrop', onMouseDown: () => setMenuOpen(false) }),
								h('div', { key: 'menu', className: 'asc-appmenu', role: 'listbox' },
									apps.length === 0
										? h('div', { className: 'asc-empty' }, appsState === 'loading' ? t.loading : t.noApps)
										: apps.map((app) => h('button', {
											key: app.id, type: 'button', className: 'asc-appmenu-item', role: 'option',
											'aria-selected': app.id === selectedId ? 'true' : 'false',
											onClick: () => pickApp(app.id)
										},
											h(AppAvatar, { app }),
											h('span', { className: 'asc-appmeta' },
												h('span', { className: 'asc-appname' }, app.name),
												h('span', { className: 'asc-appsub' }, app.bundleId))))
								)
							]
							: null
					),
					appsState === 'error'
						? h('div', { className: 'asc-notice', 'data-tone': 'err' },
							h('span', { className: 'asc-notice-body' }, errorText(appsError)))
						: null,
					detailState === 'error'
						? h('div', { className: 'asc-notice', 'data-tone': 'err' },
							h('span', { className: 'asc-notice-body' }, errorText(detailError)))
						: null,
					version !== null && version.promoOnly === true
						? h('div', { className: 'asc-notice', 'data-tone': 'warn' },
							h('span', { className: 'asc-notice-body' }, t.promoOnlyNote))
						: null,
					version === null && detailState === 'ready'
						? h('div', { className: 'asc-notice', 'data-tone': 'warn' },
							h('span', { className: 'asc-notice-body' }, t.noVersionNote))
						: null,

					detailState === 'ready' && entry !== null
						? [
							// 上架信息
							h('div', { key: 'fields', className: 'asc-card' },
								h('div', { className: 'asc-section-title' }, t.fields),
								h('div', { className: 'asc-seg', role: 'tablist' },
									detail.locales.map((item) => h('button', {
										key: item.locale, type: 'button', className: 'asc-seg-btn', role: 'tab',
										'aria-pressed': item.locale === locale ? 'true' : 'false',
										onClick: () => setLocale(item.locale)
									}, localeName(item.locale)))),
								h('div', { style: { height: 6 } }),
								FIELD_DEFS.map((def) => {
									const draftValue = drafts[locale]?.[def.key]
									const value = draftValue !== undefined ? draftValue : String(entry[def.key] ?? '')
									const targetId = def.target === 'appInfoLocalization' ? entry.appInfoLocId : entry.versionLocId
									// 三种只读原因各用各的说明：版本状态不可编辑 / App 信息不可编辑 / 该语言缺资源。
									const versionStateBlocked = def.target === 'appStoreVersionLocalization'
										&& version !== null && version.promoOnly === true && def.key !== 'promotionalText'
									const infoBlocked = def.target === 'appInfoLocalization'
										&& detail?.appInfo?.editable === false
									const missing = typeof targetId !== 'string' || targetId === ''
									const note = versionStateBlocked
										? t.versionLockedNote
										: infoBlocked
											? t.infoLockedNote
											: missing
												? (def.target === 'appStoreVersionLocalization' && version === null ? t.noVersionNote : t.readOnlyNote)
												: undefined
									return h(FieldRow, {
										key: def.key, def, entry,
										value,
										disabled: versionStateBlocked || infoBlocked || missing,
										note,
										onChange: editField
									})
								})
							),
							// 预览（对齐 2025 新版商店页：产品页 / 搜索结果两种视图）
							h('div', { key: 'preview', className: 'asc-card asc-preview-card' },
								h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
									h('div', { className: 'asc-section-title', style: { margin: 0 } }, t.preview),
									h('div', { className: 'asc-seg', style: { marginLeft: 'auto' } },
										h('button', { type: 'button', className: 'asc-seg-btn', 'aria-pressed': previewMode === 'product' ? 'true' : 'false', onClick: () => setPreviewMode('product') }, t.pvProduct),
										h('button', { type: 'button', className: 'asc-seg-btn', 'aria-pressed': previewMode === 'search' ? 'true' : 'false', onClick: () => setPreviewMode('search') }, t.pvSearch)
									)
								),
								h('div', { className: 'asc-preview-toolbar' },
									h('span', { className: 'asc-preview-device' }, h(PreviewSymbol, { name: 'apps' }), 'iPhone · ', localeName(locale)),
									h('button', { type: 'button', className: 'asc-btn', onClick: () => setPreviewExpanded(true) }, t.pvExpand)),
								remoteData?.loading ? h('p', { className: 'asc-preview-caption', role: 'status' }, t.pvRemoteLoading) : null,
								remoteData?.error ? h('div', { className: 'asc-notice', 'data-tone': 'err' }, `${t.pvRemoteError}：${errorText(remoteData.error)}`) : null,
								selectedRemote[currentAssetKind] && currentAssetExists
									? h('div', { className: 'asc-seg', style: { marginBottom: 10 } }, ['asc', 'local'].map((source) => h('button', {
										key: source, type: 'button', className: 'asc-seg-btn', 'aria-pressed': (selectedAssets[currentAssetKind] ? 'asc' : 'local') === source,
										onClick: () => setPreviewSources((previous) => ({ ...previous, [assetScope]: { ...(previous[assetScope] ?? {}), [currentAssetKind]: source } }))
									}, source === 'asc' ? t.pvSourceRemote : t.pvSourceLocal)))
									: selectedAssets[currentAssetKind] || currentAssetExists ? h('p', { className: 'asc-preview-caption' }, selectedAssets[currentAssetKind] ? t.pvSourceRemote : t.pvSourceLocal) : null,
								h('div', { className: 'asc-preview-wrap' }, h(PreviewPhone, previewProps)),
								h('p', { className: 'asc-preview-caption' }, t.pvBrowseHint),
								remoteData && !remoteData.loading && !remoteData.error && !currentAssetExists && !selectedAssets[currentAssetKind] ? h('p', { className: 'asc-preview-caption' }, t.pvAssetHint) : null,
								previewExpanded ? h(PreviewDialog, { onClose: () => setPreviewExpanded(false) },
									h('div', { className: 'asc-preview-toolbar' },
										h('span', { className: 'asc-preview-device' }, 'iPhone · ', localeName(locale)),
										h('div', { className: 'asc-seg' }, ['product', 'search'].map((mode) => h('button', { key: mode, type: 'button', className: 'asc-seg-btn', 'aria-pressed': previewMode === mode, onClick: () => setPreviewMode(mode) }, mode === 'product' ? t.pvProduct : t.pvSearch)))),
									h('div', { className: 'asc-preview-wrap' }, h(PreviewPhone, previewProps)),
									h('p', { className: 'asc-preview-caption' }, t.pvBrowseHint)) : null,
								h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onChange: onAssetFile }),
								h('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' } },
									currentAssetExists
										? h('button', { type: 'button', className: 'asc-btn', style: { borderColor: 'color-mix(in srgb, var(--asc-primary) 45%, transparent)', color: 'var(--asc-primary)', fontWeight: 600 }, disabled: syncingAscKind !== '' || !version?.editable || !activeLocId, onClick: () => { void syncAssetToAsc(currentAssetKind) } },
											syncingAscKind !== '' ? h('span', { className: 'asc-spin' }) : null,
											syncingAscKind !== '' ? t.pvSyncing : (ascSync[assetScope]?.[currentAssetKind] ? t.pvResync : t.pvSync))
										: null,
									h('button', { type: 'button', className: 'asc-btn', onClick: () => pickAsset(currentAssetKind) }, currentAssetExists ? t.pvReplace : t.pvUpload),
									currentAssetExists
										? h('button', { type: 'button', className: 'asc-btn', onClick: () => { void removeAsset(currentAssetKind) } }, t.pvRemove)
										: null,
									ascSync[assetScope]?.[currentAssetKind]
										? h('button', { type: 'button', className: 'asc-btn', 'data-tone': 'err', disabled: syncingAscKind !== '' || !version?.editable || !activeLocId, onClick: () => { void withdrawFromAsc(currentAssetKind) } }, t.pvWithdraw)
										: null),
								ascSync[assetScope]?.[currentAssetKind]
									? h('div', { style: { textAlign: 'center', fontSize: 11, color: 'var(--asc-text-3)', marginTop: 6 } },
										`${t.pvAscState}：${ascStateText(ascSync[assetScope]?.[currentAssetKind]?.state) || '—'}`,
										h('button', { type: 'button', className: 'asc-btn', style: { height: 20, fontSize: 10, padding: '0 8px', marginLeft: 6 }, disabled: syncingAscKind !== '', onClick: () => { void refreshAscState(currentAssetKind) } }, t.pvRefreshState))
									: null,
								previewError === ''
									? null
									: h('div', { className: 'asc-notice', 'data-tone': 'err', style: { marginTop: 8 } },
										h('span', { className: 'asc-notice-body' }, errorText(previewError)))
							),
							// 截图管理（查看 / 上传 / 删除）
							h(ScreenshotsCard, { key: `shots:${selectedId}:${activeLocId}`, appId: selectedId, version, entry, locale, onPreviewChange: setShotPreview }),
							// 提交前检查
							h(PrecheckCard, { key: `precheck:${selectedId}:${version?.id}`, appId: selectedId, version })
						]
						: detailState === 'loading'
							? h('div', { key: 'loading', className: 'asc-empty' }, t.loading)
							: null
				),
				// 吸底同步按钮
				h('div', { className: 'asc-footer' },
					overLimit ? h('div', { className: 'asc-notice', 'data-tone': 'err' }, h('span', { className: 'asc-notice-body' }, t.overLimitBlocked)) : null,
					h('button', {
						type: 'button', className: 'asc-btn-primary',
						disabled: detailState !== 'ready' || changes.length === 0 || overLimit || syncing || modal !== null,
						onClick: () => setModal({ phase: 'diff', appId: selectedId, versionId: version?.id ?? null, changes: changes.map((change) => ({ ...change })) })
					},
						syncing ? h('span', { className: 'asc-spin' }) : null,
						h('span', null, changes.length === 0 ? t.noChanges : t.sync),
						changes.length > 0 ? h('span', { className: 'asc-chip', style: { background: 'rgba(255,255,255,0.22)', color: '#fff' } }, t.syncChanges(changes.length)) : null
					)
				),
				modal?.phase === 'discard'
					? h(DraftDiscardDialog, { appName: apps.find((app) => app.id === modal.appId)?.name ?? modal.appId,
						onCancel: () => setModal(null), onConfirm: () => switchApp(modal.appId) })
					: modal !== null
					? h(DiffModal, {
						changes: modal.phase === 'diff' ? modal.changes : changes,
						syncing,
						result: modal.phase === 'result' ? modal.result : null,
						onCancel: () => setModal(null),
						onConfirm: runSync,
						onClose: () => setModal(null)
					})
					: null
			)
		}

		// ── 顶层 ───────────────────────────────────────────────────────

		/**
		 * 顶层组件：配置检查 → 设置页 / 主面板。
		 * @returns {object} React 元素。
		 */
		function App({ sessionId, isVisible }) {
			const { t, lang } = useLanguage()
			const [config, setConfig] = React.useState(null)
			const [configError, setConfigError] = React.useState(null)
			const [loadRevision, setLoadRevision] = React.useState(0)
			const [configRevision, setConfigRevision] = React.useState(0)
			const [storageRevision, setStorageRevision] = React.useState(0)
			const [appCatalog, setAppCatalog] = React.useState([])
			const [view, setView] = React.useState('main') // main | settings
			const updateState = useUpdateCheck(isVisible && config !== null && configError === null)

			React.useEffect(() => {
				const controller = new AbortController()
				setConfigError(null)
				apiGet(`${BASE}/config`, controller.signal)
					.then((payload) => { setLanguageScope(payload?.config?.profileId); setConfig(payload?.config ?? null) })
					.catch((error) => { if (!controller.signal.aborted) setConfigError(error) })
				return () => controller.abort()
			}, [loadRevision])

			if (configError !== null) {
				return h('div', { className: 'asc-root', lang: lang === 'zh' ? 'zh-Hans' : 'en' },
					h('div', { className: 'asc-head' }, h('span', { className: 'asc-head-title' }, t.title)),
					h('div', { className: 'asc-scroll' }, h('div', { className: 'asc-notice', 'data-tone': 'err', role: 'alert' },
						h('span', { className: 'asc-notice-body' }, errorText(configError, lang)))),
					h('div', { className: 'asc-footer' }, h('button', { type: 'button', className: 'asc-btn-primary', onClick: () => setLoadRevision((value) => value + 1) }, t.refresh)))
			}

			if (config === null) {
				return h('div', { className: 'asc-root' }, h('div', { className: 'asc-empty' }, t.loading))
			}
			// 打开语言设置不卸载编辑器；凭据保存后才重新载入账户数据。
			return h(React.Fragment, null,
				config.configured === true
					? h(MainView, { key: configRevision, config, sessionId, isVisible, storageRevision, updateState, onAppsLoaded: setAppCatalog, hidden: view === 'settings', onOpenSettings: () => setView('settings') })
					: h('div', { className: 'asc-root', hidden: view === 'settings', lang: lang === 'zh' ? 'zh-Hans' : 'en' },
					h('div', { className: 'asc-head' }, h('span', { className: 'asc-head-title' }, t.title)),
					h('div', { className: 'asc-scroll' },
							h(UpdateInfo, { state: updateState, compact: true }),
						h('div', { className: 'asc-notice', 'data-tone': 'warn' },
							h('span', { className: 'asc-notice-body' }, config.recoveryRequired ? t.configRecovery : t.needConfig))),
					h('div', { className: 'asc-footer' },
						h('button', { type: 'button', className: 'asc-btn-primary', onClick: () => setView('settings') }, t.needConfigGo))
				),
				view === 'settings' ? h(SettingsView, {
					config, apps: appCatalog, updateState, onBack: () => setView('main'),
					onSaved: (next) => { setLanguageScope((next ?? config)?.profileId); setConfig(next ?? config); setAppCatalog([]); setConfigRevision((current) => current + 1) },
					onStorageChanged: (payload, action) => {
						if (payload.config && ['disconnect', 'prepare-uninstall', 'import-legacy', 'uninstall'].includes(action)) {
							const next = payload.config
							const accountChanged = ['configured', 'hasKey', 'issuerId', 'keyId'].some((key) => next[key] !== config[key])
							setLanguageScope(next.profileId)
							setConfig(next)
							if (accountChanged || ['disconnect', 'prepare-uninstall'].includes(action)) {
								setAppCatalog([])
								setConfigRevision((current) => current + 1)
							}
						}
						if (action === 'clear-images' || action === 'import-legacy') setStorageRevision((current) => current + 1)
					}
				}) : null)
		}

		/**
		 * Open the App Store tab, creating it if needed.
		 */
		function openPanel() {
			try {
				const sidebar = ctxRef.get('sidebarRight')
				sidebar?.openTab?.(TAB_KIND, { params: {} })
			} catch (error) {
				console.warn('[dsh-asc-studio] openTab failed', error)
			}
		}

		/** @type {object} the client context captured in `apply`. */
		let ctxRef = undefined

		/**
		 * Inject the stylesheet once.
		 * @returns {() => void} cleanup.
		 */
		function installStyles() {
			if (document.getElementById(STYLE_ID) !== null) return () => {}
			const style = document.createElement('style')
			style.id = STYLE_ID
			style.textContent = CSS
			document.head.appendChild(style)
			return () => { style.remove() }
		}

		/**
		 * Plugin entry point.
		 * @param {object} ctx - client context with `slots`.
		 */
		function apply(ctx) {
			ctxRef = ctx
			ctx.effect(installStyles, 'dsh-asc-studio styles')

			ctx.slots.inject(SEAT, () => ctx.slots.register({
				name: SEAT,
				id: ENTRY_ID,
				order: -90
			}, ToggleButton))

			ctx.inject(['sidebarRightTabs'], (injected) => {
				const tabs = injected.get('sidebarRightTabs')
				if (tabs === undefined) return
				ctx.effect(() => tabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					keepMounted: true,
					priority: 'extension',
					title: () => 'App Store'
				}), 'dsh-asc-studio tab type')
			})

			ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
				name: 'sidebar.right.pane.tab',
				key: TAB_ID,
				inject: (sessionId) => ({ sessionId })
			}, Panel))
		}

		/**
		 * The tab body. `useTabInfo` is injected by the sidebar framework; the
		 * fallback keeps the hook order stable outside a tab.
		 * @param {object} props - injected props (`sessionId`, `useTabInfo`).
		 * @returns {object} React element.
		 */
		function Panel(props) {
			const useTabInfo = props.useTabInfo ?? (() => undefined)
			const tabInfo = useTabInfo()
			return h(App, { key: props.sessionId ?? '', sessionId: props.sessionId, isVisible: tabInfo?.tab?.visible === true })
		}

		const module = { exports: {} }
		module.exports.apply = apply
		module.exports.inject = ['slots']
		return module.exports
	}
})
