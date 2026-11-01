// The dashboard's single page. Plain DOM, no build step, no external requests.
// Written without backticks or template placeholders so it can live in this
// template literal untouched.
export const dashboardHtml: string = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simple Browser</title>
<style>
:root{
  --bg:#f4f5f7;--panel:#fff;--sunken:#f0f1f4;--field:#fff;
  --fg:#16181d;--fg2:#4b5161;--muted:#7a8090;--line:#e3e5ea;--line2:#cfd3db;
  --accent:#4f46e5;--accent-fg:#fff;--accent-soft:#eef0ff;--ring:rgba(79,70,229,.22);
  --ok:#15803d;--ok-soft:#e8f6ed;--fail:#dc2626;--fail-soft:#fdecec;--warn:#b45309;--warn-soft:#fdf3e4;
  --shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);
  --shadow-lg:0 12px 32px -8px rgba(16,24,40,.18),0 4px 8px -4px rgba(16,24,40,.08);
  --chev:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237a8090' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0c10;--panel:#14161c;--sunken:#0f1116;--field:#0f1116;
  --fg:#eceef3;--fg2:#b4b9c6;--muted:#7d8496;--line:#242833;--line2:#323744;
  --accent:#7c74ff;--accent-fg:#fff;--accent-soft:#1d1b3a;--ring:rgba(124,116,255,.3);
  --ok:#3ecf74;--ok-soft:#10261a;--fail:#f26666;--fail-soft:#2e1416;--warn:#f0a646;--warn-soft:#2c1f0c;
  --shadow:0 1px 2px rgba(0,0,0,.4);--shadow-lg:0 16px 40px -8px rgba(0,0,0,.6);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
svg.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ---------- header ---------- */
header{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--panel) 85%,transparent);backdrop-filter:saturate(1.6) blur(12px);-webkit-backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid var(--line)}
.hwrap{max-width:1440px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:15px;letter-spacing:-.01em;white-space:nowrap}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#a855f7);display:grid;place-items:center;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)}
.logo svg.i{width:16px;height:16px}
.seg{display:inline-flex;padding:3px;background:var(--sunken);border:1px solid var(--line);border-radius:10px;gap:2px}
.seg button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:7px;color:var(--muted);font-weight:550;font-size:13px}
.seg button:hover{color:var(--fg)}
.seg button.on{background:var(--panel);color:var(--fg);box-shadow:var(--shadow)}
.seg .count{font-size:11px;min-width:18px;text-align:center;padding:0 5px;border-radius:9px;background:var(--line);color:var(--fg2)}
.seg button.on .count{background:var(--accent-soft);color:var(--accent)}
.spacer{flex:1}
.status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.dot.off{background:var(--fail);box-shadow:0 0 0 3px var(--fail-soft)}
main{max-width:1440px;margin:0 auto;padding:20px}

/* ---------- controls ---------- */
.field{display:grid;gap:5px;min-width:0}
.field>span{font-size:12px;font-weight:550;color:var(--fg2)}
input[type=text],input:not([type]),select{
  height:36px;width:100%;padding:0 12px;border:1px solid var(--line2);border-radius:8px;background:var(--field);color:var(--fg);
  font:inherit;font-size:13.5px;outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
input::placeholder{color:var(--muted)}
input:hover,select:hover{border-color:color-mix(in srgb,var(--line2) 50%,var(--fg2))}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
select{appearance:none;-webkit-appearance:none;padding-right:34px;background-image:var(--chev);background-repeat:no-repeat;background-position:right 10px center;cursor:pointer}
.inputwrap{position:relative;display:flex;align-items:center;min-width:0;flex:1}
.inputwrap svg.i{position:absolute;left:11px;color:var(--muted);pointer-events:none}
.inputwrap input{padding-left:34px}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--fg);font:inherit;font-size:13px;font-weight:550;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;box-shadow:var(--shadow)}
.btn:hover{background:var(--sunken)}
.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.lg{height:36px;padding:0 16px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.btn.primary:hover{background:color-mix(in srgb,var(--accent) 88%,#000)}
.btn.ghost{background:none;border-color:transparent;box-shadow:none;color:var(--fg2)}
.btn.ghost:hover{background:var(--sunken);color:var(--fg)}
.btn.danger{color:var(--fail)}
.btn.danger:hover{background:var(--fail-soft);border-color:color-mix(in srgb,var(--fail) 35%,var(--line2))}
.btn.icon{width:32px;padding:0}
.btn.sm{height:28px;padding:0 9px;font-size:12.5px}
.btn.sm.icon{width:28px}

.switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:13px;color:var(--fg2);white-space:nowrap}
.switch input{appearance:none;-webkit-appearance:none;margin:0;width:34px;height:20px;border-radius:10px;background:var(--line2);position:relative;cursor:pointer;transition:background .2s;outline:none}
.switch input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s}
.switch input:checked{background:var(--accent)}
.switch input:checked::after{transform:translateX(14px)}
.switch input:focus-visible{box-shadow:0 0 0 3px var(--ring)}

.badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:10px;font-size:11.5px;font-weight:550;background:var(--sunken);color:var(--fg2);border:1px solid var(--line);white-space:nowrap}
.badge.accent{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.badge.fail{background:var(--fail-soft);color:var(--fail);border-color:transparent}
.badge.ok{background:var(--ok-soft);color:var(--ok);border-color:transparent}
.badge.rec{background:var(--warn-soft);color:var(--warn);border-color:transparent}
.badge.rec::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;animation:pulse 1.4s infinite}
@keyframes pulse{50%{opacity:.3}}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
.muted{color:var(--muted)}

/* ---------- sessions ---------- */
.toolbar{display:grid;grid-template-columns:minmax(140px,1fr) minmax(200px,2fr) minmax(130px,1fr) minmax(150px,1fr) auto;gap:12px;align-items:end;padding:16px;margin-bottom:20px}
.sechead{display:flex;align-items:center;gap:12px;margin:0 0 14px}
.sechead h2{font-size:15px;font-weight:650;margin:0;letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:box-shadow .2s,border-color .2s}
.card:hover{box-shadow:var(--shadow-lg)}
.card.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}
.chrome{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--sunken);border-bottom:1px solid var(--line)}
.lights{display:flex;gap:5px}
.lights i{width:9px;height:9px;border-radius:50%;background:var(--line2)}
.card.active .lights i:nth-child(1){background:#ff5f57}.card.active .lights i:nth-child(2){background:#febc2e}.card.active .lights i:nth-child(3){background:#28c840}
.addr{flex:1;min-width:0;height:24px;display:flex;align-items:center;gap:6px;padding:0 10px;border-radius:6px;background:var(--panel);border:1px solid var(--line);font-size:12px;color:var(--fg2)}
.addr span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.addr svg.i{width:12px;height:12px;color:var(--muted)}
.shotwrap{position:relative;aspect-ratio:16/9;background:var(--sunken);cursor:zoom-in;overflow:hidden}
.shotwrap img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.shotwrap .ph{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:12.5px}
.shotwrap .zoom{position:absolute;right:10px;bottom:10px;opacity:0;transition:opacity .15s;background:rgba(0,0,0,.6);color:#fff;border-radius:6px;padding:4px 8px;font-size:12px;display:flex;gap:5px;align-items:center}
.shotwrap:hover .zoom{opacity:1}
.cbody{padding:14px 16px 16px;display:grid;gap:12px}
.ctitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ctitle b{font-size:16px;font-weight:650;letter-spacing:-.01em;margin-right:2px}
.tabs{display:grid;gap:2px;margin:0 -6px}
.tab{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;cursor:pointer;font-size:12.5px;color:var(--fg2);min-width:0}
.tab:hover{background:var(--sunken)}
.tab.cur{background:var(--accent-soft);color:var(--fg)}
.tab .n{font-size:11px;color:var(--muted);width:14px;text-align:right;flex:none}
.tab .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550}
.tab .u{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);flex:1;min-width:0}
.stats{display:flex;gap:6px;flex-wrap:wrap}
.go{display:flex;gap:8px}
.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line)}
.path{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---------- assets ---------- */
.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px;margin-bottom:18px}
.filters select{width:150px}
.filters .inputwrap{max-width:280px}
.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}
.folders{position:sticky;top:76px;max-height:calc(100vh - 96px);overflow-y:auto;padding:6px}
.folder{display:grid;gap:3px;padding:10px 12px;border-radius:9px;cursor:pointer}
.folder:hover{background:var(--sunken)}
.folder.sel{background:var(--accent-soft)}
.folder .n{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;min-width:0}
.folder .n span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.folder .n svg.i{color:var(--muted)}
.folder.sel .n svg.i{color:var(--accent)}
.folder .m{font-size:11.5px;color:var(--muted);padding-left:24px}
.fhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.fhead h2{margin:0;font-size:16px;font-weight:650;word-break:break-all;letter-spacing:-.01em}
.group{display:flex;align-items:center;gap:8px;margin:22px 0 10px;font-size:13px;font-weight:650;color:var(--fg2)}
.group:first-of-type{margin-top:4px}
.group::after{content:"";flex:1;height:1px;background:var(--line)}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.file{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:box-shadow .2s}
.file:hover{box-shadow:var(--shadow-lg)}
.file.fail{border-color:color-mix(in srgb,var(--fail) 45%,var(--line))}
.thumb{all:unset;position:relative;display:grid;place-items:center;aspect-ratio:16/9;background:var(--sunken);cursor:zoom-in;overflow:hidden;color:var(--muted);border-bottom:1px solid var(--line)}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top left}
.thumb svg.i{width:30px;height:30px;stroke-width:1.5}
.thumb .tag{position:absolute;left:8px;top:8px}
.fmeta{padding:10px 12px 12px;display:grid;gap:8px}
.fname{font-size:12.5px;font-weight:600;word-break:break-all;line-height:1.35}
.fsub{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--muted)}
.facts{display:flex;gap:2px}
.empty{display:grid;place-items:center;gap:8px;padding:48px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line2);border-radius:14px;background:var(--panel)}
.empty svg.i{width:28px;height:28px;stroke-width:1.5}

/* ---------- viewer & toast ---------- */
#viewer{position:fixed;inset:0;background:rgba(8,9,12,.82);backdrop-filter:blur(4px);display:none;z-index:40;flex-direction:column}
#viewer.on{display:flex}
#viewer .top{display:flex;gap:8px;align-items:center;padding:12px 16px;color:#fff}
#viewer .top span{flex:1;font-size:13px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#viewer .top .btn{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.15);color:#fff;box-shadow:none}
#viewer .top .btn:hover{background:rgba(255,255,255,.2)}
#viewer .stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:0 16px 16px;min-height:0}
#viewer img,#viewer video{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
#viewer iframe{width:100%;height:100%;border:0;background:#fff;border-radius:10px}
#toast{position:fixed;bottom:20px;left:50%;transform:translate(-50%,12px);display:flex;align-items:center;gap:8px;background:var(--fg);color:var(--bg);padding:10px 16px;border-radius:10px;font-size:13px;font-weight:550;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:50;max-width:calc(100vw - 32px);box-shadow:var(--shadow-lg)}
#toast.on{opacity:1;transform:translate(-50%,0)}
#toast.err{background:var(--fail);color:#fff}

@media (max-width:900px){
  .toolbar{grid-template-columns:1fr 1fr}
  .toolbar .wide{grid-column:1/-1}
  .layout{grid-template-columns:1fr}
  .folders{position:static;max-height:260px}
}
@media (max-width:560px){
  .hwrap{padding:10px 16px;gap:12px;flex-wrap:wrap}
  .status{order:3;width:100%}
  main{padding:16px}
  .grid{grid-template-columns:1fr}
  .toolbar{grid-template-columns:1fr}
  .files{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .filters select,.filters .inputwrap{width:100%;max-width:none}
}
</style>
</head>
<body>
<header><div class="hwrap">
  <div class="brand"><div class="logo"><span data-icon="globe"></span></div>Simple Browser</div>
  <div class="seg" id="seg">
    <button data-tab="sessions" class="on"><span data-icon="window"></span>Session<span class="count" id="cSessions">0</span></button>
    <button data-tab="assets"><span data-icon="images"></span>Assets</button>
  </div>
  <div class="spacer"></div>
  <div class="status"><span class="dot" id="dot"></span><span id="status">Đang kết nối…</span></div>
</div></header>
<main>
  <section id="sessions">
    <form class="panel toolbar" id="openForm" autocomplete="off">
      <label class="field"><span>Tên session</span><input name="id" placeholder="vd: alice" required pattern="[A-Za-z0-9._\\-]{1,64}"></label>
      <label class="field wide"><span>URL mở đầu</span><input name="url" placeholder="https://… (tuỳ chọn)"></label>
      <label class="field"><span>Chế độ</span><select name="headless"><option value="">Mặc định</option><option value="true">Headless</option><option value="false">Có cửa sổ</option></select></label>
      <label class="field"><span>Cô lập</span><select name="isolation"><option value="browser">Process riêng</option><option value="context">Chung process</option></select></label>
      <button class="btn primary lg" id="openBtn"><span data-icon="plus"></span>Mở session</button>
    </form>
    <div class="sechead">
      <h2>Session đang mở</h2>
      <div class="spacer"></div>
      <label class="switch"><input type="checkbox" id="live" checked>Ảnh trực tiếp</label>
    </div>
    <div id="sessionList" class="grid"></div>
  </section>
  <section id="assets" hidden>
    <div class="panel filters">
      <select id="kind"><option value="">Mọi loại</option><option value="image">Ảnh</option><option value="video">Video</option><option value="report">Báo cáo</option><option value="trace">Trace</option><option value="har">HAR</option><option value="pdf">PDF</option><option value="other">Khác</option></select>
      <div class="inputwrap"><span data-icon="search"></span><input id="filter" placeholder="Lọc theo tên file"></div>
      <label class="switch"><input type="checkbox" id="failedOnly">Chỉ bước lỗi</label>
      <div class="spacer"></div>
      <span class="muted" id="rootInfo" style="font-size:12.5px"></span>
      <button class="btn danger" id="prune"><span data-icon="broom"></span>Dọn thư mục cũ</button>
    </div>
    <div class="layout">
      <div class="panel folders" id="folderList"></div>
      <div id="fileList"></div>
    </div>
  </section>
</main>
<div id="viewer"><div class="top"><span id="vName"></span><a class="btn" id="vOpen" target="_blank"><span data-icon="external"></span>Tab mới</a><a class="btn" id="vDl"><span data-icon="download"></span>Tải về</a><button class="btn icon" id="vClose" title="Đóng (Esc)"><span data-icon="x"></span></button></div><div class="stage" id="vStage"></div></div>
<div id="toast"></div>
<script>
var state = { tab: "sessions", folder: null, assets: null, sessions: null, shots: {} };
var $ = function (id) { return document.getElementById(id); };

// Lucide-style 24px stroke icons.
var PATHS = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  reload: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  broom: '<path d="m19 2-8.5 8.5M14 13l-4-4-6.5 6.5a2 2 0 0 0 0 2.8l1.2 1.2a2 2 0 0 0 2.8 0z"/><path d="m9 18 3 3M6 15l-1 1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  net: '<path d="M2 12h4l3-9 6 18 3-9h4"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'
};
function icon(name) {
  var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "i");
  s.innerHTML = PATHS[name] || "";
  return s;
}
document.querySelectorAll("[data-icon]").forEach(function (el) { el.replaceWith(icon(el.dataset.icon)); });

function h(tag, attrs) {
  var el = document.createElement(tag);
  for (var k in attrs || {}) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "text") el.textContent = v;
    else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach(function (x) { if (x) el.append(x); });
    else el.append(c);
  }
  return el;
}
function btn(cls, ic, label, onclick, extra) {
  var b = h("button", Object.assign({ class: "btn " + cls, type: "button", onclick: onclick, title: label && cls.indexOf("icon") >= 0 ? label : null }, extra || {}),
    ic ? icon(ic) : null, label && cls.indexOf("icon") < 0 ? label : null);
  if (cls.indexOf("icon") >= 0) b.setAttribute("aria-label", label);
  return b;
}

function toast(msg, err) {
  var t = $("toast");
  t.textContent = "";
  t.append(icon(err ? "alert" : "check"), msg);
  t.className = "on" + (err ? " err" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.className = ""; }, err ? 5000 : 2200);
}

function api(path, body) {
  var opts = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-mcp-ui": "1" }, body: JSON.stringify(body) };
  return fetch(path, opts).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });
  });
}

function size(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function ago(t) {
  var s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return Math.round(s / 60) + " phút trước";
  if (s < 86400) return Math.round(s / 3600) + " giờ trước";
  return new Date(t).toLocaleDateString("vi-VN");
}
function fileUrl(rel) { return "/files/" + rel.split("/").map(encodeURIComponent).join("/"); }
function extUrl(p) { return "/external?p=" + encodeURIComponent(p); }
function shortUrl(u) {
  if (!u || u === "about:blank") return "about:blank";
  if (/^data:/.test(u)) return "data:…";
  return u.replace(/^https?:\\/\\//, "");
}
var KIND_ICON = { video: "film", report: "report", trace: "route", har: "net", pdf: "pdf", other: "box", image: "images" };
var KIND_LABEL = { video: "Video", report: "Báo cáo", trace: "Trace", har: "HAR", pdf: "PDF", other: "File", image: "Ảnh" };

// ---------- viewer ----------
function view(name, src, kind) {
  var stage = $("vStage");
  stage.textContent = "";
  $("vName").textContent = name;
  $("vOpen").href = src;
  $("vDl").href = src + (src.indexOf("?") < 0 ? "?" : "&") + "download";
  if (kind === "image") stage.append(h("img", { src: src }));
  else if (kind === "video") stage.append(h("video", { src: src, controls: true, autoplay: true }));
  else if (kind === "trace") { location.href = $("vDl").href; return; }
  else stage.append(h("iframe", { src: src }));
  $("viewer").className = "on";
}
function closeViewer() { $("viewer").className = ""; $("vStage").textContent = ""; }
$("vClose").onclick = closeViewer;
$("viewer").addEventListener("click", function (e) { if (e.target.id === "vStage") closeViewer(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeViewer(); });

// ---------- tabs ----------
function showTab(name) {
  state.tab = name;
  document.querySelectorAll("#seg button").forEach(function (x) { x.classList.toggle("on", x.dataset.tab === name); });
  $("sessions").hidden = name !== "sessions";
  $("assets").hidden = name !== "assets";
  history.replaceState(null, "", "#" + name);
  refresh();
}
document.querySelectorAll("#seg button").forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });

// ---------- sessions ----------
function act(id, action, body, label) {
  return api("/api/sessions/" + encodeURIComponent(id) + "/" + action, body || {}).then(function (r) {
    if (label) toast(label);
    loadSessions();
    return r;
  }, function (e) { toast(e.message, true); });
}
function shotUrl(id) { return "/api/sessions/" + encodeURIComponent(id) + "/shot?t=" + Date.now(); }

function sessionCard(s, active) {
  var cur = s.tabs.filter(function (t) { return t.current; })[0] || s.tabs[0] || { url: s.url, title: "" };
  var live = $("live").checked;
  var shot = h("div", { class: "shotwrap", "data-id": s.id, onclick: function () { view(s.id + " · " + (cur.title || cur.url), shotUrl(s.id), "image"); } },
    h("div", { class: "ph", text: live ? "Đang chụp…" : "Ảnh trực tiếp đang tắt" }),
    live && state.shots[s.id] ? h("img", { src: state.shots[s.id], alt: "" }) : null,
    h("div", { class: "zoom" }, icon("zoom"), "Phóng to"));
  var urlInput = h("input", { placeholder: "Nhập URL rồi Enter", value: cur.url && !/^(about|data):/.test(cur.url) ? cur.url : "" });
  var go = function () { if (urlInput.value) act(s.id, "navigate", { url: /^\\w+:/.test(urlInput.value) ? urlInput.value : "https://" + urlInput.value }, "Đã mở trang"); };
  urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  var isActive = s.id === active;
  return h("div", { class: "card" + (isActive ? " active" : "") },
    h("div", { class: "chrome" },
      h("div", { class: "lights" }, h("i"), h("i"), h("i")),
      h("div", { class: "addr", title: cur.url }, icon(/^https:/.test(cur.url) ? "lock" : "globe"), h("span", { text: shortUrl(cur.url) }))),
    shot,
    h("div", { class: "cbody" },
      h("div", { class: "ctitle" },
        h("b", { text: s.id }),
        isActive ? h("span", { class: "badge accent", text: "Mặc định" }) : null,
        h("span", { class: "badge", text: s.headless ? "Headless" : "Có cửa sổ" }),
        h("span", { class: "badge", text: s.isolation === "context" ? "Chung process" : s.isolation === "cdp" ? "Chrome của bạn" : "Process riêng" }),
        s.tracing ? h("span", { class: "badge rec", text: "Trace" }) : null,
        s.video ? h("span", { class: "badge rec", text: "Video" }) : null,
        s.har ? h("span", { class: "badge rec", text: "HAR" }) : null),
      s.tabs.length ? h("div", { class: "tabs" }, s.tabs.map(function (t, i) {
        return h("div", { class: "tab" + (t.current ? " cur" : ""), title: t.url, onclick: function () { if (!t.current) act(s.id, "tab", { index: i }); } },
          h("span", { class: "n", text: String(i + 1) }),
          t.title ? h("span", { class: "t", text: t.title }) : null,
          h("span", { class: "u", text: shortUrl(t.url) }));
      })) : null,
      h("div", { class: "stats" },
        h("span", { class: "badge", text: s.tabs.length + " tab" }),
        h("span", { class: "badge", text: s.requests + " request" }),
        s.failedRequests ? h("span", { class: "badge fail", text: s.failedRequests + " request lỗi" }) : null,
        s.consoleErrors ? h("span", { class: "badge fail", text: s.consoleErrors + " lỗi console" }) : null,
        !s.failedRequests && !s.consoleErrors ? h("span", { class: "badge ok", text: "Không có lỗi" }) : null),
      h("div", { class: "go" },
        h("div", { class: "inputwrap" }, icon("search"), urlInput),
        h("button", { class: "btn primary lg", type: "button", onclick: go, text: "Mở" })),
      h("div", { class: "actions" },
        btn("icon", "back", "Lùi", function () { act(s.id, "back"); }),
        btn("icon", "reload", "Tải lại", function () { act(s.id, "reload"); }),
        btn("", "report", "Báo cáo", function () { act(s.id, "report").then(function (r) { if (r) view("report.html", fileUrl(r.report), "report"); }); }),
        btn("", "folder", "Assets", function () { state.folder = s.evidenceFolder; showTab("assets"); }),
        isActive ? null : btn("icon", "star", "Đặt làm session mặc định", function () { act(s.id, "use", {}, "Đã đặt " + s.id + " làm mặc định"); }),
        h("div", { class: "spacer" }),
        btn("danger icon", "x", "Đóng session", function () { if (confirm("Đóng session " + s.id + "?")) act(s.id, "close", {}, "Đã đóng " + s.id); })),
      h("div", { class: "path", title: s.evidenceDir, text: s.evidenceDir })));
}

function loadSessions() {
  return api("/api/sessions").then(function (d) {
    state.sessions = d;
    var list = $("sessionList");
    list.textContent = "";
    if (!d.sessions.length) list.append(h("div", { class: "empty", style: "grid-column:1/-1" }, icon("window"),
      h("div", { text: "Chưa có session nào. Session sẽ hiện ở đây khi agent dùng trình duyệt, hoặc mở một cái ở trên." })));
    d.sessions.forEach(function (s) { list.append(sessionCard(s, d.active)); });
    if ($("live").checked) d.sessions.forEach(function (s) { refreshShot(s.id); });
    $("cSessions").textContent = d.sessions.length;
    $("dot").className = "dot";
    $("status").textContent = "Đã kết nối · mặc định " + (d.defaultHeadless ? "headless" : "có cửa sổ");
  }, function (e) { $("dot").className = "dot off"; $("status").textContent = "Mất kết nối"; });
}

// Fetch the next frame off-screen and swap it in when ready, so the card keeps
// showing the previous one instead of flashing empty every refresh.
function refreshShot(id) {
  fetch(shotUrl(id)).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (blob) {
    var old = state.shots[id];
    var src = URL.createObjectURL(blob);
    state.shots[id] = src;
    var wrap = document.querySelector('.shotwrap[data-id="' + CSS.escape(id) + '"]');
    if (wrap) {
      var img = wrap.querySelector("img");
      if (!img) { img = h("img", { alt: "" }); wrap.insertBefore(img, wrap.querySelector(".zoom")); }
      img.src = src;
    }
    if (old) setTimeout(function () { URL.revokeObjectURL(old); }, 1000);
  }).catch(function () {});
}

$("openForm").onsubmit = function (e) {
  e.preventDefault();
  var f = e.target, b = $("openBtn");
  var body = { id: f.id.value.trim(), url: f.url.value.trim(), isolation: f.isolation.value };
  if (body.url && !/^\\w+:/.test(body.url)) body.url = "https://" + body.url;
  if (f.headless.value) body.headless = f.headless.value === "true";
  b.disabled = true;
  b.lastChild.textContent = "Đang mở…";
  api("/api/sessions", body).then(function () { toast("Đã mở " + body.id); f.id.value = ""; f.url.value = ""; loadSessions(); },
    function (err) { toast(err.message, true); }).then(function () { b.disabled = false; b.lastChild.textContent = "Mở session"; });
};
$("live").onchange = loadSessions;

// ---------- assets ----------
function loadAssets() {
  return api("/api/assets").then(function (d) {
    state.assets = d;
    $("rootInfo").textContent = d.root + " · " + size(d.folders.reduce(function (n, f) { return n + f.size; }, 0));
    var list = $("folderList");
    list.textContent = "";
    if (d.external.length) list.append(folderRow({ name: "__external", label: "Lưu ngoài thư mục evidence", files: d.external.length, size: d.external.reduce(function (n, f) { return n + f.size; }, 0), mtime: d.external[0].mtime }));
    d.folders.forEach(function (f) { list.append(folderRow(f)); });
    if (!d.folders.length && !d.external.length) list.append(h("div", { class: "folder muted", text: "Chưa có thư mục nào" }));
    var names = d.folders.map(function (f) { return f.name; });
    if (state.folder !== "__external" && names.indexOf(state.folder) < 0) state.folder = names[0] || (d.external.length ? "__external" : null);
    highlight();
    return loadFiles();
  }, function (e) { toast(e.message, true); });
}

// Evidence folders are named <session>-<YYYY-MM-DD>T<HH-MM-SS>; show the
// session as the title and the start time in the meta line.
function splitFolder(name) {
  var m = /^(.*)-(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})$/.exec(name);
  return m ? { id: m[1], when: m[4] + "/" + m[3] + " " + m[5] + ":" + m[6] } : { id: name, when: "" };
}
function folderRow(f) {
  var parts = f.label ? { id: f.label, when: "" } : splitFolder(f.name);
  return h("div", { class: "folder", "data-name": f.name, title: f.name, onclick: function () { state.folder = f.name; highlight(); loadFiles(); } },
    h("div", { class: "n" }, icon(f.name === "__external" ? "box" : "folder"), h("span", { text: parts.id }), f.session ? h("span", { class: "badge accent", text: "đang mở" }) : null),
    h("div", { class: "m", text: (parts.when ? parts.when + " · " : "") + f.files + " file · " + size(f.size) }));
}
function highlight() {
  document.querySelectorAll(".folder").forEach(function (el) { el.classList.toggle("sel", el.dataset.name === state.folder); });
}

function loadFiles() {
  if (!state.folder) { renderFiles([]); return; }
  if (state.folder === "__external") {
    renderFiles(state.assets.external.map(function (f) { return Object.assign({ external: true, src: extUrl(f.path) }, f); }));
    return;
  }
  return api("/api/assets/" + encodeURIComponent(state.folder)).then(function (d) {
    renderFiles(d.files.map(function (f) { return Object.assign({ src: fileUrl(f.path) }, f); }));
  }, function (e) { toast(e.message, true); });
}

function renderFiles(files) {
  var box = $("fileList");
  box.textContent = "";
  var folder = state.assets && state.assets.folders.filter(function (f) { return f.name === state.folder; })[0];
  if (folder) {
    var failed = files.filter(function (f) { return /FAILED/.test(f.path); }).length;
    box.append(h("div", { class: "fhead" },
      h("h2", { text: folder.name }),
      folder.session ? h("span", { class: "badge accent", text: "Session " + folder.session + " đang mở" }) : null,
      failed ? h("span", { class: "badge fail", text: failed + " bước lỗi" }) : null,
      h("div", { class: "spacer" }),
      folder.hasReport ? btn("", "report", "Xem báo cáo", function () { view("report.html", fileUrl(folder.name + "/report.html"), "report"); }) : null,
      btn("danger", "trash", "Xoá thư mục", function () { if (confirm("Xoá toàn bộ " + folder.name + "?")) del({ path: folder.name }); },
        { disabled: !!folder.session, title: folder.session ? "Đóng session trước khi xoá" : null })));
  }
  var kind = $("kind").value, q = $("filter").value.toLowerCase(), failedOnly = $("failedOnly").checked;
  var shown = files.filter(function (f) {
    return (!kind || f.kind === kind) && (!q || f.path.toLowerCase().indexOf(q) >= 0) && (!failedOnly || /FAILED/.test(f.path));
  });
  if (!shown.length) {
    box.append(h("div", { class: "empty" }, icon("images"), h("div", { text: files.length ? "Không có file khớp bộ lọc." : "Thư mục trống." })));
    return;
  }
  // Group by sub folder (run-01, run-02, …) so a flow reads as one strip.
  var groups = {};
  shown.forEach(function (f) {
    var rel = f.external ? f.path : f.path.split("/").slice(1).join("/");
    var parts = rel.split("/");
    var g = f.external ? "" : parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    (groups[g] = groups[g] || []).push(Object.assign({ name: f.external ? f.path : parts[parts.length - 1] }, f));
  });
  Object.keys(groups).sort().forEach(function (g) {
    box.append(h("div", { class: "group" }, icon(g ? "route" : "folder"), g ? g + " · " + groups[g].length + " file" : "Tổng quan"));
    box.append(h("div", { class: "files" }, groups[g].map(fileCard)));
  });
}

function fileCard(f) {
  var failed = /FAILED/.test(f.name);
  var thumb = h("button", { class: "thumb", type: "button", title: "Xem", onclick: function () { view(f.path, f.src, f.kind); } },
    f.kind === "image" ? h("img", { loading: "lazy", src: f.src, alt: "" }) : icon(KIND_ICON[f.kind] || "box"),
    failed ? h("span", { class: "badge fail tag", text: "Lỗi" }) : f.kind !== "image" ? h("span", { class: "badge tag", text: KIND_LABEL[f.kind] }) : null);
  var path = f.external ? f.path : state.assets.root + "/" + f.path;
  return h("div", { class: "file" + (failed ? " fail" : "") }, thumb,
    h("div", { class: "fmeta" },
      h("div", { class: "fname", text: f.name }),
      h("div", { class: "fsub" },
        h("span", { text: size(f.size) + " · " + ago(f.mtime) }),
        h("div", { class: "facts" },
          h("a", { class: "btn ghost sm icon", href: f.src + (f.src.indexOf("?") < 0 ? "?" : "&") + "download", title: "Tải về", "aria-label": "Tải về" }, icon("download")),
          btn("ghost sm icon", "copy", "Copy đường dẫn", function () {
            navigator.clipboard.writeText(path).then(function () { toast("Đã copy đường dẫn"); }, function () { prompt("Đường dẫn", path); });
          }),
          btn("ghost sm icon danger", "trash", "Xoá", function () {
            if (confirm("Xoá " + f.name + "?")) del(f.external ? { external: f.path } : { path: f.path });
          }))),
      f.kind === "trace" ? h("code", { class: "path", text: "npx playwright show-trace " + path }) : null));
}

function del(body) {
  api("/api/assets/delete", body).then(function () { toast("Đã xoá"); loadAssets(); }, function (e) { toast(e.message, true); });
}

$("kind").onchange = $("filter").oninput = $("failedOnly").onchange = function () { loadFiles(); };
$("prune").onclick = function () {
  var days = prompt("Xoá thư mục evidence của các session đã đóng, cũ hơn bao nhiêu ngày? (0 = tất cả)", "7");
  if (days === null) return;
  api("/api/assets/prune", { olderThanDays: Number(days) || 0 }).then(function (r) {
    toast("Đã xoá " + r.removed.length + " thư mục");
    loadAssets();
  }, function (e) { toast(e.message, true); });
};

// ---------- loop ----------
function refresh() { return state.tab === "sessions" ? loadSessions() : loadAssets(); }
setInterval(function () {
  if (document.hidden || state.tab !== "sessions" || $("viewer").className) return;
  // Rebuilding the cards would wipe whatever is being typed into one.
  if ($("sessionList").contains(document.activeElement)) return;
  loadSessions();
}, 4000);
if (location.hash === "#assets") showTab("assets");
else refresh();
</script>
</body>
</html>`;
