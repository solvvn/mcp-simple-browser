// The dashboard's single page. Plain DOM, no build step, no external requests.
// Written without backticks or template placeholders so it can live in this
// template literal untouched.
export const dashboardHtml = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simple Browser</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c1e21;--muted:#65676b;--line:#d0d7de;--accent:#0969da;--ok:#1a7f37;--fail:#cf222e;--warn:#9a6700;--chip:#eef1f4}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#4493f8;--ok:#3fb950;--fail:#f85149;--warn:#d29922;--chip:#21262d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:16px;margin:0}
nav{display:flex;gap:4px}
nav button{border:0;background:none;padding:6px 12px;border-radius:6px;color:var(--muted);font:inherit;cursor:pointer}
nav button.on{background:var(--chip);color:var(--fg);font-weight:600}
.spacer{flex:1}
.muted{color:var(--muted)}
main{padding:16px;max-width:1500px;margin:0 auto}
button.b,a.b{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:4px 10px;border-radius:6px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}
button.b:hover,a.b:hover{border-color:var(--accent)}
button.b.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.b.danger{color:var(--fail)}
button.b:disabled{opacity:.5;cursor:default}
input,select{font:inherit;font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);min-width:0}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.shot{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;object-position:top;background:var(--chip);border-bottom:1px solid var(--line);cursor:zoom-in}
.body{padding:10px 12px;display:grid;gap:8px}
.title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.title b{font-size:15px}
.chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--chip);color:var(--muted)}
.chip.on{background:var(--accent);color:#fff}
.chip.err{background:var(--fail);color:#fff}
.chip.rec{background:var(--warn);color:#fff}
.url{font-size:12px;color:var(--muted);word-break:break-all}
.tabs{display:grid;gap:2px;font-size:12px}
.tabs div{display:flex;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer;overflow:hidden}
.tabs div:hover{background:var(--chip)}
.tabs div.cur{background:var(--chip);font-weight:600}
.tabs span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.row input{flex:1}
.stats{display:flex;gap:12px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.layout{display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start}
@media (max-width:820px){.layout{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
.folders{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;position:sticky;top:64px;max-height:calc(100vh - 80px);overflow-y:auto}
.folder{padding:8px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:grid;gap:2px}
.folder:hover{background:var(--chip)}
.folder.sel{background:var(--chip);box-shadow:inset 3px 0 0 var(--accent)}
.folder .n{font-weight:600;word-break:break-all;font-size:13px}
.folder .m{font-size:11px;color:var(--muted)}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.file{background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.file.fail{border-top:3px solid var(--fail)}
.file .thumb{width:100%;aspect-ratio:16/9;object-fit:cover;object-position:top;background:var(--chip);display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--muted);cursor:pointer;border:0}
.file .meta{padding:6px 8px;display:grid;gap:4px;font-size:12px}
.file .meta .p{word-break:break-all}
.file .acts{display:flex;gap:4px;flex-wrap:wrap}
.file .acts .b{padding:2px 7px;font-size:12px}
h2{font-size:15px;margin:18px 0 10px}
h2:first-child{margin-top:0}
.empty{padding:28px;text-align:center;color:var(--muted);background:var(--card);border:1px dashed var(--line);border-radius:10px}
#viewer{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;z-index:20;flex-direction:column}
#viewer.on{display:flex}
#viewer .top{display:flex;gap:8px;align-items:center;padding:8px 12px;color:#fff;font-size:13px}
#viewer .top span{flex:1;word-break:break-all}
#viewer .stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:0 12px 12px}
#viewer img,#viewer video{max-width:100%;max-height:100%;object-fit:contain;background:#fff}
#viewer iframe{width:100%;height:100%;border:0;background:#fff;border-radius:6px}
#toast{position:fixed;bottom:16px;right:16px;background:var(--fg);color:var(--bg);padding:8px 14px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30;max-width:80vw}
#toast.on{opacity:1}
#toast.err{background:var(--fail);color:#fff}
</style>
</head>
<body>
<header>
  <h1>Simple Browser</h1>
  <nav><button data-tab="sessions" class="on">Session</button><button data-tab="assets">Assets</button></nav>
  <div class="spacer"></div>
  <span class="muted" id="status"></span>
</header>
<main>
  <section id="sessions">
    <form class="bar" id="openForm">
      <input name="id" placeholder="id session mới, vd alice" required pattern="[A-Za-z0-9._\\-]{1,64}" style="width:180px">
      <input name="url" placeholder="URL mở đầu (tuỳ chọn)" style="width:260px">
      <select name="headless"><option value="">Mặc định</option><option value="true">Headless</option><option value="false">Có cửa sổ</option></select>
      <select name="isolation"><option value="browser">Process riêng</option><option value="context">Chung process</option></select>
      <button class="b primary">Mở session</button>
      <div class="spacer"></div>
      <label class="muted"><input type="checkbox" id="live" checked> Ảnh trực tiếp</label>
    </form>
    <div id="sessionList" class="grid"></div>
  </section>
  <section id="assets" hidden>
    <div class="bar">
      <select id="kind"><option value="">Mọi loại</option><option value="image">Ảnh</option><option value="video">Video</option><option value="report">Báo cáo</option><option value="trace">Trace</option><option value="har">HAR</option><option value="pdf">PDF</option><option value="other">Khác</option></select>
      <input id="filter" placeholder="Lọc theo tên" style="width:200px">
      <label class="muted"><input type="checkbox" id="failedOnly"> Chỉ bước lỗi</label>
      <div class="spacer"></div>
      <span class="muted" id="rootInfo"></span>
      <button class="b danger" id="prune">Dọn thư mục đã đóng…</button>
    </div>
    <div class="layout">
      <div class="folders" id="folderList"></div>
      <div id="fileList"></div>
    </div>
  </section>
</main>
<div id="viewer"><div class="top"><span id="vName"></span><a class="b" id="vOpen" target="_blank">Mở tab mới</a><a class="b" id="vDl">Tải về</a><button class="b" id="vClose">Đóng ✕</button></div><div class="stage" id="vStage"></div></div>
<div id="toast"></div>
<script>
var state = { tab: "sessions", folder: null, assets: null, files: [], sessions: null };
var $ = function (id) { return document.getElementById(id); };

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

function toast(msg, err) {
  var t = $("toast");
  t.textContent = msg;
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
  if (s < 60) return s + " giây trước";
  if (s < 3600) return Math.round(s / 60) + " phút trước";
  if (s < 86400) return Math.round(s / 3600) + " giờ trước";
  return new Date(t).toLocaleString("vi-VN");
}
function fileUrl(rel) { return "/files/" + rel.split("/").map(encodeURIComponent).join("/"); }
function extUrl(p) { return "/external?p=" + encodeURIComponent(p); }
var ICONS = { video: "🎬", report: "📄", trace: "🧭", har: "🌐", pdf: "📕", other: "📦", image: "🖼" };

// ---------- viewer ----------
function view(name, src, kind) {
  var stage = $("vStage");
  stage.textContent = "";
  $("vName").textContent = name;
  $("vOpen").href = src;
  $("vDl").href = src + (src.indexOf("?") < 0 ? "?" : "&") + "download";
  if (kind === "image") stage.append(h("img", { src: src }));
  else if (kind === "video") stage.append(h("video", { src: src, controls: true, autoplay: true }));
  else if (kind === "report" || kind === "pdf" || kind === "other" || kind === "har") stage.append(h("iframe", { src: src }));
  else { window.open(src); return; }
  $("viewer").className = "on";
}
function closeViewer() { $("viewer").className = ""; $("vStage").textContent = ""; }
$("vClose").onclick = closeViewer;
$("viewer").addEventListener("click", function (e) { if (e.target.id === "vStage") closeViewer(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeViewer(); });

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach(function (b) {
  b.onclick = function () {
    state.tab = b.dataset.tab;
    document.querySelectorAll("nav button").forEach(function (x) { x.classList.toggle("on", x === b); });
    $("sessions").hidden = state.tab !== "sessions";
    $("assets").hidden = state.tab !== "assets";
    location.hash = state.tab;
    refresh();
  };
});

// ---------- sessions ----------
function act(id, action, body, label) {
  return api("/api/sessions/" + encodeURIComponent(id) + "/" + action, body || {}).then(function (r) {
    if (label) toast(label);
    loadSessions();
    return r;
  }, function (e) { toast(e.message, true); });
}

function sessionCard(s, active) {
  var shotSrc = "/api/sessions/" + encodeURIComponent(s.id) + "/shot?t=" + Date.now();
  var img = h("img", { class: "shot", alt: "", "data-id": s.id, src: $("live").checked ? shotSrc : null,
    onclick: function () { view(s.id + " · " + s.url, "/api/sessions/" + encodeURIComponent(s.id) + "/shot?t=" + Date.now(), "image"); },
    onerror: function () { this.removeAttribute("src"); } });
  var urlInput = h("input", { placeholder: "https://…", value: s.url && s.url !== "about:blank" ? s.url : "" });
  var go = function () { if (urlInput.value) act(s.id, "navigate", { url: /^\\w+:/.test(urlInput.value) ? urlInput.value : "https://" + urlInput.value }, "Đã mở trang"); };
  urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  return h("div", { class: "card" + (s.id === active ? " active" : "") },
    img,
    h("div", { class: "body" },
      h("div", { class: "title" },
        h("b", { text: s.id }),
        s.id === active ? h("span", { class: "chip on", text: "đang dùng" }) : null,
        h("span", { class: "chip", text: s.headless ? "headless" : "có cửa sổ" }),
        h("span", { class: "chip", text: s.isolation }),
        s.tracing ? h("span", { class: "chip rec", text: "● trace" }) : null,
        s.video ? h("span", { class: "chip rec", text: "● video" }) : null,
        s.har ? h("span", { class: "chip rec", text: "● HAR" }) : null),
      h("div", { class: "tabs" }, s.tabs.map(function (t, i) {
        return h("div", { class: t.current ? "cur" : "", title: t.url, onclick: function () { act(s.id, "tab", { index: i }); } },
          h("span", { text: (i + 1) + "." }), h("span", { text: t.title || t.url || "(trống)" }));
      })),
      h("div", { class: "stats" },
        h("span", { text: s.tabs.length + " tab" }),
        h("span", { text: s.requests + " request" }),
        s.failedRequests ? h("span", { class: "chip err", text: s.failedRequests + " request lỗi" }) : null,
        s.consoleErrors ? h("span", { class: "chip err", text: s.consoleErrors + " lỗi console" }) : null),
      h("div", { class: "row" }, urlInput, h("button", { class: "b", onclick: go, text: "Đi" })),
      h("div", { class: "row" },
        s.id !== active ? h("button", { class: "b", text: "Dùng làm mặc định", onclick: function () { act(s.id, "use", {}, "Đã chuyển session"); } }) : null,
        h("button", { class: "b", text: "← Lùi", onclick: function () { act(s.id, "back"); } }),
        h("button", { class: "b", text: "Tải lại", onclick: function () { act(s.id, "reload"); } }),
        h("button", { class: "b", text: "Báo cáo", onclick: function () {
          act(s.id, "report").then(function (r) { if (r) view("report.html", fileUrl(r.report), "report"); });
        } }),
        h("button", { class: "b", text: "Assets", onclick: function () { state.folder = s.evidenceFolder; document.querySelector('nav button[data-tab=assets]').click(); } }),
        h("div", { class: "spacer" }),
        h("button", { class: "b danger", text: "Đóng", onclick: function () {
          if (confirm("Đóng session " + s.id + "?")) act(s.id, "close", {}, "Đã đóng " + s.id);
        } })),
      h("div", { class: "url", text: s.evidenceDir })));
}

function loadSessions() {
  return api("/api/sessions").then(function (d) {
    state.sessions = d;
    var list = $("sessionList");
    list.textContent = "";
    if (!d.sessions.length) list.append(h("div", { class: "empty", text: "Chưa có session nào đang mở. Session sẽ hiện ở đây khi agent dùng trình duyệt, hoặc mở một cái ở trên." }));
    d.sessions.forEach(function (s) { list.append(sessionCard(s, d.active)); });
    $("status").textContent = d.sessions.length + " session · mặc định " + (d.defaultHeadless ? "headless" : "có cửa sổ");
  }, function (e) { $("status").textContent = "Mất kết nối: " + e.message; });
}

$("openForm").onsubmit = function (e) {
  e.preventDefault();
  var f = e.target, btn = f.querySelector("button");
  var body = { id: f.id.value.trim(), url: f.url.value.trim(), isolation: f.isolation.value };
  if (body.url && !/^\\w+:/.test(body.url)) body.url = "https://" + body.url;
  if (f.headless.value) body.headless = f.headless.value === "true";
  btn.disabled = true;
  btn.textContent = "Đang mở…";
  api("/api/sessions", body).then(function () { toast("Đã mở " + body.id); f.id.value = ""; f.url.value = ""; loadSessions(); },
    function (err) { toast(err.message, true); }).then(function () { btn.disabled = false; btn.textContent = "Mở session"; });
};
$("live").onchange = loadSessions;

// ---------- assets ----------
function loadAssets() {
  return api("/api/assets").then(function (d) {
    state.assets = d;
    $("rootInfo").textContent = d.root + " · " + size(d.folders.reduce(function (n, f) { return n + f.size; }, 0));
    var list = $("folderList");
    list.textContent = "";
    if (d.external.length) list.append(folderRow({ name: "__external", label: "File lưu ngoài thư mục evidence", files: d.external.length, size: d.external.reduce(function (n, f) { return n + f.size; }, 0), mtime: d.external[0].mtime }));
    d.folders.forEach(function (f) { list.append(folderRow(f)); });
    if (!d.folders.length && !d.external.length) list.append(h("div", { class: "folder muted", text: "Trống" }));
    var names = d.folders.map(function (f) { return f.name; });
    if (state.folder !== "__external" && names.indexOf(state.folder) < 0) state.folder = names[0] || (d.external.length ? "__external" : null);
    highlight();
    return loadFiles();
  }, function (e) { toast(e.message, true); });
}

function folderRow(f) {
  return h("div", { class: "folder", "data-name": f.name, onclick: function () { state.folder = f.name; highlight(); loadFiles(); } },
    h("div", { class: "n" }, f.label || f.name, f.session ? h("span", { class: "chip on", text: " đang mở: " + f.session, style: "margin-left:6px" }) : null),
    h("div", { class: "m", text: f.files + " file · " + size(f.size) + " · " + ago(f.mtime) + (f.images ? " · " + f.images + " ảnh" : "") }));
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
    box.append(h("div", { class: "bar" },
      h("b", { text: folder.name }),
      folder.session ? h("span", { class: "chip on", text: "session " + folder.session + " đang mở" }) : null,
      h("div", { class: "spacer" }),
      folder.hasReport ? h("button", { class: "b", text: "Xem báo cáo", onclick: function () { view("report.html", fileUrl(folder.name + "/report.html"), "report"); } }) : null,
      h("button", { class: "b danger", text: "Xoá thư mục", disabled: !!folder.session, title: folder.session ? "Đóng session trước" : "",
        onclick: function () { if (confirm("Xoá toàn bộ " + folder.name + "?")) del({ path: folder.name }); } })));
  }
  var kind = $("kind").value, q = $("filter").value.toLowerCase(), failedOnly = $("failedOnly").checked;
  var shown = files.filter(function (f) {
    return (!kind || f.kind === kind) && (!q || f.path.toLowerCase().indexOf(q) >= 0) && (!failedOnly || /FAILED/.test(f.path));
  });
  if (!shown.length) { box.append(h("div", { class: "empty", text: files.length ? "Không có file khớp bộ lọc." : "Thư mục trống." })); return; }
  // Group by sub folder (run-01, run-02, …) so a flow reads as one strip.
  var groups = {};
  shown.forEach(function (f) {
    var rel = f.external ? f.path : f.path.split("/").slice(1).join("/");
    var parts = rel.split("/");
    var g = f.external ? "" : parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    (groups[g] = groups[g] || []).push(Object.assign({ name: f.external ? f.path : parts[parts.length - 1] }, f));
  });
  Object.keys(groups).sort().forEach(function (g) {
    if (g) box.append(h("h2", { text: g + " · " + groups[g].length + " file" }));
    box.append(h("div", { class: "files" }, groups[g].map(fileCard)));
  });
}

function fileCard(f) {
  var thumb = f.kind === "image"
    ? h("img", { class: "thumb", loading: "lazy", src: f.src, alt: "", onclick: function () { view(f.path, f.src, f.kind); } })
    : h("button", { class: "thumb", text: ICONS[f.kind] || ICONS.other, onclick: function () { view(f.path, f.src, f.kind); } });
  return h("div", { class: "file" + (/FAILED/.test(f.name) ? " fail" : "") }, thumb,
    h("div", { class: "meta" },
      h("div", { class: "p", text: f.name }),
      h("div", { class: "muted", text: size(f.size) + " · " + ago(f.mtime) }),
      f.kind === "trace" ? h("code", { class: "muted", text: "npx playwright show-trace" }) : null,
      h("div", { class: "acts" },
        h("a", { class: "b", href: f.src + (f.src.indexOf("?") < 0 ? "?" : "&") + "download", text: "Tải" }),
        h("button", { class: "b", text: "Copy đường dẫn", onclick: function () {
          var p = f.external ? f.path : state.assets.root + "/" + f.path;
          navigator.clipboard.writeText(p).then(function () { toast("Đã copy " + p); }, function () { prompt("Đường dẫn", p); });
        } }),
        h("button", { class: "b danger", text: "Xoá", onclick: function () {
          if (confirm("Xoá " + f.name + "?")) del(f.external ? { external: f.path } : { path: f.path });
        } }))));
}

function del(body) {
  api("/api/assets/delete", body).then(function () { toast("Đã xoá"); loadAssets(); }, function (e) { toast(e.message, true); });
}

$("kind").onchange = $("filter").oninput = $("failedOnly").onchange = function () { loadFiles(); };
$("prune").onclick = function () {
  var days = prompt("Xoá mọi thư mục evidence của session đã đóng và cũ hơn số ngày này (0 = tất cả):", "7");
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
if (location.hash === "#assets") document.querySelector('nav button[data-tab=assets]').click();
else refresh();
</script>
</body>
</html>`;
