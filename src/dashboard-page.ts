// The dashboard is one self-contained page: no build step, no external assets.
// It is written without template literals so it can live in String.raw.
export const dashboardHtml = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simple Browser</title>
<style>
:root {
  --bg: #f5f6f8; --surface: #ffffff; --sunken: #eef0f3; --border: #dfe3e8; --border-strong: #c9ced6;
  --text: #16191f; --muted: #5a6371; --faint: #8a93a1;
  --accent: #2563eb; --accent-text: #ffffff; --accent-soft: #e8efff;
  --ok: #1a7f37; --ok-soft: #e6f4ea; --bad: #c4232f; --bad-soft: #fdecee; --warn: #8a5a00; --warn-soft: #fff4d6;
  --shadow: 0 1px 2px rgba(16, 24, 40, .06);
  --radius: 8px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1013; --surface: #16191e; --sunken: #1d2127; --border: #2a2f37; --border-strong: #3a414c;
    --text: #e7e9ed; --muted: #a1a9b6; --faint: #6e7683;
    --accent: #4d8dff; --accent-text: #0b1220; --accent-soft: #1a2a48;
    --ok: #4ac26b; --ok-soft: #13291a; --bad: #ff6b72; --bad-soft: #3a1418; --warn: #e3b341; --warn-soft: #33290f;
    --shadow: none;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.muted { color: var(--muted); }
.num { font-variant-numeric: tabular-nums; }
[hidden] { display: none !important; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Header */
header { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--border); }
.bar { max-width: 1320px; margin: 0 auto; padding: 0 24px; height: 56px; display: flex; align-items: center; gap: 28px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
.mark { width: 24px; height: 24px; border-radius: 6px; background: var(--text); color: var(--surface); display: grid; place-items: center; }
nav { display: flex; gap: 4px; height: 100%; }
nav a { display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--muted); font-weight: 550; border-bottom: 2px solid transparent; margin-bottom: -1px; }
nav a:hover { color: var(--text); text-decoration: none; }
nav a[aria-current="page"] { color: var(--text); border-bottom-color: var(--accent); }
.count { min-width: 20px; padding: 0 6px; border-radius: 10px; background: var(--sunken); color: var(--muted); font-size: 12px; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }
.count.bad { background: var(--bad-soft); color: var(--bad); }
.status { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot.off { background: var(--bad); }

main { max-width: 1320px; margin: 0 auto; padding: 24px; }
.toolbar { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -.01em; }
.toolbar .sub { color: var(--muted); font-size: 13px; margin-top: 2px; overflow-wrap: anywhere; }
.toolbar .right { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

/* Controls */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; font-weight: 550; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--sunken); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.ghost { border-color: transparent; background: transparent; color: var(--muted); }
.btn.ghost:hover { background: var(--sunken); color: var(--text); }
.btn.danger { color: var(--bad); }
.btn.danger:hover { background: var(--bad-soft); color: var(--bad); }
.btn.icon { width: 32px; padding: 0; }
.btn svg, .mark svg { width: 16px; height: 16px; flex: none; }
.input, select.input { height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; min-width: 0; }
.input.mono { font-size: 12.5px; }
.input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
.seg button { height: 30px; padding: 0 12px; border: 0; background: var(--surface); color: var(--muted); font: inherit; font-weight: 550; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--border-strong); }
.seg button[aria-pressed="true"] { background: var(--sunken); color: var(--text); }
.check { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; cursor: pointer; }

.tag { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; background: var(--sunken); color: var(--muted); font-size: 12px; font-weight: 550; white-space: nowrap; }
.tag.accent { background: var(--accent-soft); color: var(--accent); }
.tag.warn { background: var(--warn-soft); color: var(--warn); }
.pill { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 4px; font-size: 12px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.pill svg { width: 12px; height: 12px; }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.bad { background: var(--bad-soft); color: var(--bad); }
.pill.none { background: var(--sunken); color: var(--muted); }
.pill.run { background: var(--accent-soft); color: var(--accent); }
.spin { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
.progress { flex-basis: 100%; height: 4px; border-radius: 2px; background: var(--sunken); overflow: hidden; }
.progress i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.lastrun .now { flex-basis: 100%; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.empty { padding: 56px 24px; text-align: center; color: var(--muted); }
.empty h2 { margin: 0 0 6px; color: var(--text); font-size: 16px; }
.empty p { margin: 0 auto 16px; max-width: 460px; }

/* Open session form */
.open-form { padding: 16px; margin-bottom: 16px; display: grid; grid-template-columns: minmax(140px, 1fr) minmax(200px, 2fr) auto auto auto; gap: 12px; align-items: end; }
.field { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--muted); }
.open-form .acts { display: flex; gap: 8px; }

/* Session cards */
.sessions { display: grid; grid-template-columns: repeat(auto-fill, minmax(600px, 1fr)); gap: 16px; }
.card { display: grid; grid-template-columns: 220px 1fr; overflow: hidden; }
.thumb { position: relative; display: block; padding: 0; border: 0; border-right: 1px solid var(--border); background: var(--sunken); cursor: zoom-in; min-height: 190px; }
.thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.thumb .noshot { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); font-size: 13px; }
.thumb .live { position: absolute; left: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 4px; background: rgba(0, 0, 0, .65); color: #fff; font-size: 11px; font-weight: 600; }
.thumb .live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #3fdc6c; }
.body { padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.name { margin: 0 4px 0 0; font-size: 15px; font-weight: 650; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.page { min-width: 0; }
.page .title { font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page .url { display: block; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tabs button { max-width: 200px; height: 26px; padding: 0 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs button[aria-current="true"] { border-color: var(--accent); color: var(--accent); }
.lastrun { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.lastrun .err { flex-basis: 100%; color: var(--bad); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { display: flex; gap: 16px; font-size: 13px; color: var(--muted); }
.stats b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.stats b.bad { color: var(--bad); }
.foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.go { display: flex; gap: 6px; flex: 1 1 100%; min-width: 0; }
.go .input { flex: 1; }
.actions { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; width: 100%; }
.actions .grow { flex: 1; }
.actions .btn:not(.icon) { padding: 0 8px; }

/* Runs */
.runs { display: grid; gap: 8px; }
.run { overflow: hidden; }
.run.failed { border-left: 3px solid var(--bad); }
.run-head { width: 100%; display: grid; grid-template-columns: 96px minmax(160px, 1.2fr) minmax(120px, 2fr) 80px 70px 120px 20px; gap: 16px; align-items: center; padding: 12px 16px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.run-head:hover { background: var(--sunken); }
.run-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip { display: flex; gap: 2px; flex-wrap: wrap; }
.strip i { width: 10px; height: 10px; border-radius: 2px; background: var(--ok); opacity: .75; }
.strip i.bad { background: var(--bad); opacity: 1; }
.strip i.todo { background: var(--border-strong); opacity: 1; }
.strip i.now { background: var(--accent); opacity: 1; animation: pulse 1s ease-in-out infinite; }
.run.running { border-left: 3px solid var(--accent); }
.chev { width: 16px; height: 16px; color: var(--faint); transition: transform .15s; }
.run-head[aria-expanded="true"] .chev { transform: rotate(90deg); }
.run-err { padding: 0 16px 12px 128px; margin-top: -4px; color: var(--bad); font-size: 13px; overflow-wrap: anywhere; }
.run-detail { border-top: 1px solid var(--border); padding: 16px; background: var(--bg); }
.run-detail .links { display: flex; gap: 8px; margin-bottom: 12px; }
.steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; align-items: start; }
.step { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }
.step.bad { border-color: var(--bad); }
.step .shot { aspect-ratio: 16 / 10; padding: 0; border: 0; border-bottom: 1px solid var(--border); background: var(--sunken); cursor: zoom-in; display: block; width: 100%; }
.step .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top left; display: block; }
.step .noshot { aspect-ratio: 16 / 10; display: grid; place-items: center; color: var(--faint); font-size: 12px; background: var(--sunken); border-bottom: 1px solid var(--border); }
.step figcaption { padding: 8px 10px; display: grid; gap: 4px; font-size: 13px; }
.step .lbl { font-weight: 550; overflow-wrap: anywhere; }
.step .meta { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; }
.step .error { color: var(--bad); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7.5em; overflow: auto; }

/* Files */
.files { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
.folders { overflow: hidden; position: sticky; top: 72px; max-height: calc(100vh - 96px); overflow-y: auto; }
.folder { width: 100%; display: grid; gap: 2px; padding: 10px 14px; border: 0; border-bottom: 1px solid var(--border); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.folder:last-child { border-bottom: 0; }
.folder:hover { background: var(--sunken); }
.folder[aria-current="true"] { background: var(--accent-soft); box-shadow: inset 3px 0 var(--accent); }
.folder .row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.folder .fname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.folder .row .tag { margin-left: auto; }
.folder .fmeta { color: var(--muted); font-size: 12px; }
.content { min-height: 300px; }
.content-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.content-head h2 { margin: 0; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.content-head .right { margin-left: auto; display: flex; gap: 6px; }
.group { padding: 14px 16px; }
.group + .group { border-top: 1px solid var(--border); }
.group h3 { margin: 0 0 10px; font-size: 12px; font-weight: 650; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.tile { margin: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface); }
.tile.bad { border-color: var(--bad); }
.tile button { display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: 0; background: var(--sunken); cursor: zoom-in; }
.tile img { width: 100%; height: 100%; object-fit: cover; object-position: top left; display: block; }
.tile figcaption { padding: 6px 8px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rows { display: grid; }
.frow { display: grid; grid-template-columns: 72px 1fr 80px 130px auto; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.frow:last-child { border-bottom: 0; }
.frow .fn { min-width: 0; overflow-wrap: anywhere; }
.frow .acts { display: flex; gap: 2px; }

/* Viewer */
dialog { padding: 0; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--text); width: min(1280px, 94vw); max-height: 94vh; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); }
dialog::backdrop { background: rgba(10, 12, 16, .72); }
.vhead { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--border); }
.vhead .vt { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vhead .right { margin-left: auto; display: flex; gap: 4px; align-items: center; }
.vbody { background: var(--sunken); display: grid; place-items: center; max-height: calc(94vh - 53px); overflow: auto; }
.vbody img, .vbody video { max-width: 100%; max-height: calc(94vh - 53px); display: block; }
.vbody iframe { width: 100%; height: calc(94vh - 53px); border: 0; background: #fff; }

.toast { position: fixed; right: 20px; bottom: 20px; z-index: 50; max-width: 420px; padding: 10px 14px; border-radius: 6px; background: var(--text); color: var(--surface); box-shadow: 0 6px 24px rgba(0, 0, 0, .2); font-size: 13px; }
.toast.bad { background: var(--bad); color: #fff; }

@media (max-width: 900px) {
  .bar { gap: 12px; padding: 0 12px; }
  .brand span { display: none; }
  main { padding: 16px 12px; }
  .sessions { grid-template-columns: 1fr; }
  .card { grid-template-columns: 1fr; }
  .thumb { border-right: 0; border-bottom: 1px solid var(--border); aspect-ratio: 16 / 9; min-height: 0; }
  .open-form { grid-template-columns: 1fr; }
  .run-head { grid-template-columns: 96px 1fr auto 20px; }
  .run-head .hide-sm { display: none; }
  .run-err { padding-left: 16px; }
  .files { grid-template-columns: 1fr; }
  .folders { position: static; max-height: 260px; }
  .frow { grid-template-columns: 60px 1fr auto; }
  .frow .hide-sm { display: none; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
<header>
  <div class="bar">
    <div class="brand">
      <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v15.5l4-3.6 2.7 5.9 2.7-1.2-2.7-5.8H17z"/></svg></div>
      <span>Simple Browser</span>
    </div>
    <nav aria-label="Mục chính">
      <a href="#sessions" data-view="sessions">Session <span class="count" id="n-sessions">0</span></a>
      <a href="#runs" data-view="runs">Lịch sử chạy <span class="count" id="n-runs">0</span></a>
      <a href="#files" data-view="files">File</a>
    </nav>
    <div class="status" aria-live="polite"><span class="dot" id="dot"></span><span id="status">Đang tải</span></div>
  </div>
</header>

<main>
  <section id="view-sessions" hidden>
    <div class="toolbar">
      <div>
        <h1>Session</h1>
        <div class="sub" id="session-meta"></div>
      </div>
      <div class="right">
        <button class="btn primary" type="button" id="open-toggle" aria-expanded="false" aria-controls="open-form">Mở session</button>
      </div>
    </div>
    <form class="panel open-form" id="open-form" hidden>
      <label class="field">Tên session
        <input class="input" name="id" required pattern="[A-Za-z0-9._\-]{1,64}" placeholder="vd: alice" autocomplete="off">
      </label>
      <label class="field">Mở sẵn URL (không bắt buộc)
        <input class="input mono" name="url" placeholder="https://example.com" autocomplete="off">
      </label>
      <label class="field">Cách ly
        <select class="input" name="isolation">
          <option value="browser">Trình duyệt riêng</option>
          <option value="context">Context trong trình duyệt chung</option>
        </select>
      </label>
      <label class="field">Hiển thị
        <select class="input" name="headless">
          <option value="">Theo mặc định</option>
          <option value="true">Headless</option>
          <option value="false">Có cửa sổ</option>
        </select>
      </label>
      <div class="acts">
        <button class="btn primary" type="submit">Mở</button>
        <button class="btn ghost" type="button" id="open-cancel">Huỷ</button>
      </div>
    </form>
    <div class="sessions" id="session-list"></div>
    <div class="panel empty" id="session-empty" hidden>
      <h2>Chưa có session nào đang mở</h2>
      <p>Session do agent mở, ở bất kỳ instance nào, sẽ hiện ở đây kèm ảnh trực tiếp của trang.</p>
      <button class="btn" type="button" id="open-empty">Mở session thủ công</button>
    </div>
  </section>

  <section id="view-runs" hidden>
    <div class="toolbar">
      <div>
        <h1>Lịch sử chạy</h1>
        <div class="sub" id="runs-meta"></div>
      </div>
      <div class="right">
        <div class="seg" role="group" aria-label="Lọc theo kết quả" id="run-filter">
          <button type="button" data-v="all" aria-pressed="true">Tất cả</button>
          <button type="button" data-v="bad" aria-pressed="false">Lỗi</button>
          <button type="button" data-v="ok" aria-pressed="false">Đạt</button>
        </div>
        <select class="input" id="run-session" aria-label="Lọc theo session"></select>
      </div>
    </div>
    <div class="runs" id="run-list"></div>
    <div class="panel empty" id="runs-empty" hidden>
      <h2>Chưa có lần chạy nào</h2>
      <p>Mỗi lần agent gọi browser_run_flow sẽ được ghi lại ở đây, kèm ảnh từng bước và bước gây lỗi.</p>
    </div>
  </section>

  <section id="view-files" hidden>
    <div class="toolbar">
      <div>
        <h1>File</h1>
        <div class="sub mono" id="files-meta"></div>
      </div>
      <div class="right">
        <label class="check"><input type="checkbox" id="show-empty"> Hiện thư mục rỗng</label>
        <select class="input" id="prune-days" aria-label="Phạm vi dọn dẹp">
          <option value="7">Cũ hơn 7 ngày</option>
          <option value="1">Cũ hơn 1 ngày</option>
          <option value="30">Cũ hơn 30 ngày</option>
          <option value="0">Mọi thư mục không còn mở</option>
        </select>
        <button class="btn" type="button" id="prune">Dọn dẹp</button>
      </div>
    </div>
    <div class="files">
      <div class="panel folders" id="folder-list" role="list"></div>
      <div class="panel content" id="folder-content"></div>
    </div>
  </section>
</main>

<dialog id="viewer" aria-label="Xem file">
  <div class="vhead">
    <div class="vt" id="v-title"></div>
    <span class="muted num" id="v-count"></span>
    <div class="right">
      <button class="btn icon ghost" type="button" id="v-prev" aria-label="Ảnh trước"></button>
      <button class="btn icon ghost" type="button" id="v-next" aria-label="Ảnh sau"></button>
      <a class="btn ghost" id="v-open" target="_blank" rel="noreferrer">Mở tab mới</a>
      <button class="btn icon ghost" type="button" id="v-close" aria-label="Đóng"></button>
    </div>
  </div>
  <div class="vbody" id="v-body"></div>
</dialog>

<div class="toast" id="toast" role="status" hidden></div>

<script>
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
};

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function h(tag, attrs, kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids || []) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function iconBtn(icon, label, onclick, cls) {
  return h("button", { class: "btn icon ghost " + (cls || ""), type: "button", "aria-label": label, title: label, html: ICONS[icon], onclick });
}

function pill(run) {
  if (run.running) return h("span", { class: "pill run" }, [h("i", { class: "spin", "aria-hidden": "true" }), "ĐANG CHẠY"]);
  if (!run.done) return h("span", { class: "pill none", text: "TRỐNG" });
  return run.failed
    ? h("span", { class: "pill bad", html: ICONS.cross }, ["LỖI"])
    : h("span", { class: "pill ok", html: ICONS.check }, ["ĐẠT"]);
}

async function api(path, body) {
  const init = body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-ui": "1" },
    body: JSON.stringify(body),
  };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const enc = encodeURIComponent;
const fileUrl = (rel) => "/files/" + rel.split("/").map(enc).join("/");
const extUrl = (path) => "/external?p=" + enc(path);
const firstLine = (s) => String(s || "").split("\n")[0];

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 45) return "vừa xong";
  if (s < 3600) return Math.round(s / 60) + " phút trước";
  if (s < 86400) return Math.round(s / 3600) + " giờ trước";
  return new Date(t).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const fullTime = (t) => new Date(t).toLocaleString("vi-VN");
const dur = (ms) => ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
function size(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function normalizeUrl(v) {
  v = v.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v;
}
// "alice-2026-11-10T08-30-00" -> session and when.
function folderParts(name) {
  const m = /^(.*)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(name);
  if (!m) return { session: name, when: null };
  return { session: m[1], when: new Date(m[2] + "-" + m[3] + "-" + m[4] + "T" + m[5] + ":" + m[6] + ":" + m[7] + "Z").getTime() };
}

let toastTimer;
function toast(msg, bad) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (bad ? " bad" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 6000 : 2500);
}

function online(ok) {
  $("#dot").className = "dot" + (ok ? "" : " off");
  $("#status").textContent = !ok ? "Mất kết nối với server" : live ? "Đang theo dõi trực tiếp" : "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
}

const state = { view: "", sessions: null, runs: null, runsKey: "", assets: null, folder: null, runFilter: "all", runSession: "", expanded: new Set() };

/* ---------- Router ---------- */

function route() {
  const hash = location.hash.slice(1) || "sessions";
  const [view, ...rest] = hash.split("/");
  state.view = ["sessions", "runs", "files"].includes(view) ? view : "sessions";
  for (const v of ["sessions", "runs", "files"]) $("#view-" + v).hidden = v !== state.view;
  for (const a of $$("nav a")) {
    if (a.dataset.view === state.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (state.view === "sessions") loadSessions();
  if (state.view === "runs") loadRuns();
  if (state.view === "files") {
    state.folder = rest.length ? decodeURIComponent(rest.join("/")) : null;
    loadAssets();
  }
}
window.addEventListener("hashchange", route);
const go = (hash) => { location.hash = hash; };

/* ---------- Sessions ---------- */

const cards = new Map();

async function loadSessions() {
  try {
    state.sessions = await api("/api/sessions");
    online(true);
  } catch (e) {
    online(false);
    return;
  }
  renderSessions();
}

function renderSessions() {
  const d = state.sessions;
  $("#n-sessions").textContent = d.sessions.length;
  $("#session-meta").textContent = "Mặc định mở " + (d.defaultHeadless ? "headless" : "có cửa sổ") + " · Evidence lưu ở " + d.evidenceRoot;
  const list = $("#session-list");
  const ids = new Set(d.sessions.map((s) => s.id));
  for (const [id, c] of cards) if (!ids.has(id)) { c.el.remove(); cards.delete(id); }
  d.sessions.forEach((s, i) => {
    let c = cards.get(s.id);
    if (!c) { c = buildCard(s.id); cards.set(s.id, c); }
    if (list.children[i] !== c.el) list.insertBefore(c.el, list.children[i] || null);
    updateCard(c, s, d.active);
  });
  $("#session-empty").hidden = d.sessions.length > 0;
  refreshShots();
}

function buildCard(id) {
  const c = { id, loading: false };
  c.img = h("img", { alt: "" , hidden: true });
  c.noshot = h("div", { class: "noshot", text: "Đang tải ảnh" });
  c.thumb = h("button", { class: "thumb", type: "button", "aria-label": "Xem lớn trang của session " + id, onclick: () => openLive(id) },
    [c.img, c.noshot, h("span", { class: "live", text: "Trực tiếp" })]);
  c.name = h("h2", { class: "name", text: id });
  c.tags = h("div", { class: "tags" });
  c.title = h("div", { class: "title" });
  c.url = h("a", { class: "url mono", target: "_blank", rel: "noreferrer" });
  c.tabs = h("div", { class: "tabs", role: "group", "aria-label": "Các tab" });
  c.run = h("div", { class: "lastrun" });
  c.stats = h("div", { class: "stats" });
  c.input = h("input", { class: "input mono", type: "text", placeholder: "Nhập URL rồi Enter", "aria-label": "Mở URL trong session " + id, autocomplete: "off" });
  const form = h("form", { class: "go", onsubmit: (e) => {
    e.preventDefault();
    if (!c.input.value.trim()) return;
    act(id, "navigate", { url: normalizeUrl(c.input.value) }).then((ok) => { if (ok) c.input.value = ""; });
  } }, [c.input, h("button", { class: "btn", type: "submit", text: "Mở" })]);
  c.useBtn = h("button", { class: "btn ghost", type: "button", text: "Mặc định", title: "Đặt làm session mặc định: tool không ghi session sẽ dùng session này", onclick: () => act(id, "use") });
  const actions = h("div", { class: "actions" }, [
    iconBtn("back", "Quay lại trang trước", () => act(id, "back")),
    iconBtn("reload", "Tải lại trang", () => act(id, "reload")),
    h("button", { class: "btn ghost", type: "button", text: "Báo cáo", onclick: () => makeReport(id) }),
    h("button", { class: "btn ghost", type: "button", text: "File", onclick: () => go("files/" + enc(c.folder)) }),
    h("span", { class: "grow" }),
    c.useBtn,
    h("button", { class: "btn ghost danger", type: "button", text: "Đóng", onclick: () => closeSessionUi(id) }),
  ]);
  c.el = h("article", { class: "panel card" }, [
    c.thumb,
    h("div", { class: "body" }, [
      h("div", { class: "head" }, [c.name, c.tags]),
      h("div", { class: "page" }, [c.title, c.url]),
      c.tabs, c.run, c.stats,
      h("div", { class: "foot" }, [form, actions]),
    ]),
  ]);
  return c;
}

function tag(text, cls, title) {
  return h("span", { class: "tag " + (cls || ""), text, title });
}

function updateCard(c, s, active) {
  c.folder = s.evidenceFolder;
  c.hasPage = s.tabs.length > 0;
  const tags = [];
  if (s.id === active) tags.push(tag("Mặc định", "accent", "Tool không ghi session sẽ dùng session này"));
  if (s.isolation === "cdp") tags.push(tag("Chrome của bạn"));
  else if (s.shared) tags.push(tag(s.instances > 1 ? "Dùng chung · " + s.instances + " instance" : "Dùng chung được", "", "Mọi instance MCP đều điều khiển được session này"));
  else tags.push(tag("Riêng instance", "", "Chỉ instance đã mở mới điều khiển được"));
  if (!s.here) tags.push(tag("Instance khác"));
  if (s.isolation === "context") tags.push(tag("Context"));
  tags.push(tag(s.headless ? "Headless" : "Có cửa sổ"));
  if (s.tracing) tags.push(tag("Đang ghi trace", "warn"));
  if (s.video) tags.push(tag("Quay video", "warn"));
  c.tags.replaceChildren(...tags);
  c.useBtn.hidden = s.id === active;

  const cur = s.tabs.find((t) => t.current) || s.tabs[0];
  c.title.textContent = cur ? (cur.title || "Không có tiêu đề") : "Không có tab nào";
  c.url.textContent = cur ? cur.url : "";
  c.url.href = cur && /^https?:/.test(cur.url) ? cur.url : "#";
  c.url.title = cur ? cur.url : "";
  if (s.tabs.length > 1) {
    c.tabs.hidden = false;
    c.tabs.replaceChildren(...s.tabs.map((t, i) => h("button", {
      type: "button", "aria-current": String(t === cur), title: t.url,
      text: (i + 1) + ". " + (t.title || t.url),
      onclick: () => act(s.id, "tab", { index: i }),
    })));
  } else c.tabs.hidden = true;

  const r = s.lastRun;
  c.running = !!(r && r.running);
  if (r && r.running) {
    const at = r.current ? r.current.i : r.done;
    c.run.replaceChildren(
      pill(r),
      h("span", { class: "num", text: r.id + " · bước " + (at + 1) + "/" + r.total + " · " + r.passed + " đạt" }),
      h("a", { href: "#runs", text: "Xem", onclick: () => state.expanded.add(s.evidenceFolder + "/" + r.id) }),
      r.current && h("div", { class: "now", title: r.current.label, text: "Đang làm: " + r.current.label }),
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(r.total), "aria-valuenow": String(r.done), "aria-label": "Tiến độ flow" },
        [h("i", { style: "width:" + Math.round(100 * r.done / Math.max(1, r.total)) + "%" })]),
    );
  } else if (r) {
    const parts = [pill(r), h("span", { text: r.id + " · " + r.passed + "/" + r.total + " bước đạt · " + ago(r.started), title: "Flow gần nhất, chạy lúc " + fullTime(r.started) }),
      h("a", { href: "#runs", text: "Xem", onclick: () => state.expanded.add(s.evidenceFolder + "/" + r.id) })];
    if (r.failed) parts.push(h("div", { class: "err", title: r.failed.error, text: "Bước " + r.failed.i + ": " + r.failed.label + " - " + firstLine(r.failed.error) }));
    c.run.replaceChildren(...parts);
  } else c.run.replaceChildren(h("span", { class: "muted", text: "Chưa chạy flow nào" }));

  const stat = (label, n, bad) => h("span", {}, [label + " ", h("b", { class: bad ? "bad" : "", text: n == null ? "-" : String(n) })]);
  c.stats.replaceChildren(
    stat("Lỗi console", s.consoleErrors, s.consoleErrors > 0),
    stat("Request lỗi", s.failedRequests, s.failedRequests > 0),
    stat("Số flow", s.runs, false),
  );
}

// A card whose flow is running refreshes about every 1.5 s, the rest every 4 s.
const SHOT_IDLE_MS = 4000;
const SHOT_BUSY_MS = 1500;

function refreshShots() {
  if (state.view !== "sessions" || document.hidden || viewer.open) return;
  const now = Date.now();
  for (const c of cards.values()) {
    if (!c.hasPage) { c.img.hidden = true; c.noshot.hidden = false; c.noshot.textContent = "Chưa có trang"; continue; }
    if (c.loading || now - (c.shotAt || 0) < (c.running ? SHOT_BUSY_MS : SHOT_IDLE_MS) - 100) continue;
    c.loading = true;
    c.shotAt = now;
    const im = new Image();
    im.onload = () => { c.img.src = im.src; c.img.hidden = false; c.noshot.hidden = true; c.loading = false; };
    im.onerror = () => { if (c.img.hidden) c.noshot.textContent = "Không chụp được trang"; c.loading = false; };
    im.src = "/api/sessions/" + enc(c.id) + "/shot?t=" + Date.now();
  }
}

async function act(id, action, body) {
  try {
    await api("/api/sessions/" + enc(id) + "/" + action, body || {});
    loadSessions();
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

async function makeReport(id) {
  try {
    const r = await api("/api/sessions/" + enc(id) + "/report", {});
    if (r.report) window.open(fileUrl(r.report), "_blank", "noopener");
  } catch (e) { toast(e.message, true); }
}

async function closeSessionUi(id) {
  const s = state.sessions.sessions.find((x) => x.id === id);
  const others = s && s.instances > 1 ? " Session đang được " + s.instances + " instance dùng; trình duyệt chỉ tắt khi instance cuối cùng nhả ra." : "";
  if (!confirm("Đóng session \"" + id + "\"?" + others)) return;
  if (await act(id, "close")) toast("Đã đóng session " + id);
}

function toggleOpenForm(show) {
  const form = $("#open-form");
  form.hidden = !show;
  $("#open-toggle").setAttribute("aria-expanded", String(show));
  if (show) form.elements.id.focus();
}
$("#open-toggle").onclick = () => toggleOpenForm($("#open-form").hidden);
$("#open-empty").onclick = () => toggleOpenForm(true);
$("#open-cancel").onclick = () => toggleOpenForm(false);
$("#open-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $("button[type=submit]", f);
  const body = { id: f.elements.id.value.trim(), isolation: f.elements.isolation.value };
  if (f.elements.url.value.trim()) body.url = normalizeUrl(f.elements.url.value);
  if (f.elements.headless.value) body.headless = f.elements.headless.value === "true";
  btn.disabled = true;
  btn.textContent = "Đang mở";
  try {
    const r = await api("/api/sessions", body);
    toast(r.attached ? "Đã nối vào session " + r.id + " của instance khác" : "Đã mở session " + r.id);
    f.reset();
    toggleOpenForm(false);
    loadSessions();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Mở";
  }
};

let liveTimer;
function openLive(id) {
  const img = h("img", { alt: "Trang hiện tại của session " + id });
  const tick = () => { img.src = "/api/sessions/" + enc(id) + "/shot?t=" + Date.now(); };
  tick();
  showViewer({ title: id + " (trực tiếp, tự làm mới)", node: img, open: null });
  liveTimer = setInterval(tick, 2000);
}

/* ---------- Runs ---------- */

async function loadRuns() {
  let data;
  try {
    data = await api("/api/runs");
    online(true);
  } catch (e) {
    online(false);
    return;
  }
  state.runs = data.runs;
  updateRunCount();
  // Re-rendering would collapse what the user is reading; only do it on change.
  const key = JSON.stringify(data.runs.map((r) => [r.folder, r.id, r.done, r.passed, r.report, r.running, r.current && r.current.i]));
  if (key === state.runsKey) return;
  state.runsKey = key;
  renderRuns();
}

function updateRunCount() {
  const bad = state.runs.filter((r) => r.failed).length;
  const n = $("#n-runs");
  n.textContent = bad ? bad + " lỗi" : String(state.runs.length);
  n.className = "count" + (bad ? " bad" : "");
}

function renderRuns() {
  const runs = state.runs || [];
  const sessions = [...new Set(runs.map((r) => r.session))].sort();
  const sel = $("#run-session");
  sel.replaceChildren(h("option", { value: "", text: "Mọi session" }), ...sessions.map((s) => h("option", { value: s, text: s })));
  sel.value = sessions.includes(state.runSession) ? state.runSession : "";
  const shown = runs.filter((r) =>
    (!sel.value || r.session === sel.value) &&
    (state.runFilter === "all" || (state.runFilter === "bad" ? !!r.failed : r.done && !r.failed && !r.running)));
  const bad = runs.filter((r) => r.failed).length;
  const running = runs.filter((r) => r.running).length;
  $("#runs-meta").textContent = runs.length
    ? runs.length + " lần chạy gần nhất · " + (running ? running + " đang chạy · " : "") + bad + " lỗi · " + (runs.length - bad - running) + " đạt hoặc trống"
    : "";
  $("#run-list").replaceChildren(...shown.map(runItem));
  $("#runs-empty").hidden = runs.length > 0;
  if (runs.length && !shown.length) $("#run-list").append(h("div", { class: "panel empty" }, [h("p", { text: "Không có lần chạy nào khớp bộ lọc." })]));
}

function runItem(r) {
  const key = r.folder + "/" + r.id;
  const open = state.expanded.has(key);
  const head = h("button", { class: "run-head", type: "button", "aria-expanded": String(open), onclick: () => {
    if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
    renderRuns();
  } }, [
    pill(r),
    h("span", { class: "run-name" }, [h("b", { text: r.session }), h("span", { class: "muted", text: " · " + r.id })]),
    h("span", { class: "strip hide-sm", "aria-hidden": "true" }, stripOf(r)),
    h("span", { class: "num", text: r.passed + "/" + r.total + " bước" }),
    h("span", { class: "muted num hide-sm", text: dur(r.running ? Date.now() - r.started : r.ms) }),
    h("span", { class: "muted hide-sm", text: ago(r.started), title: fullTime(r.started) }),
    h("span", { html: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' }),
  ]);
  const err = r.failed && h("div", { class: "run-err" }, ["Bước " + r.failed.i + " ", h("b", { text: r.failed.label }), ": " + firstLine(r.failed.error)]);
  const now = r.running && r.current && h("div", { class: "run-err", style: "color:var(--accent)" }, ["Đang làm bước " + r.current.i + ": ", h("b", { text: r.current.label })]);
  return h("article", { class: "panel run" + (r.running ? " running" : r.failed ? " failed" : "") }, [head, err, now, open && runDetail(r)]);
}

// One square per planned step: done ones by result, the running one pulsing,
// the rest (not reached, or skipped after a failure) grey.
function stripOf(r) {
  const cells = r.steps.map((s) => h("i", { class: s.ok ? "" : "bad", title: "#" + s.i + " " + s.label }));
  for (let i = r.steps.length; i < r.total; i++) {
    const current = r.running && r.current && r.current.i === i;
    cells.push(h("i", { class: current ? "now" : "todo", title: "#" + i + (current ? " " + r.current.label : r.running ? " chưa chạy" : " không chạy") }));
  }
  return cells;
}

function thumbImg(thumb, full) {
  const img = h("img", { src: thumb || full, alt: "", loading: "lazy", decoding: "async" });
  if (thumb) img.addEventListener("error", () => { if (img.src.indexOf(full) < 0) img.src = full; }, { once: true });
  return img;
}

function runDetail(r) {
  const shots = r.steps.filter((s) => s.shot).map((s) => ({ title: "#" + s.i + " " + s.label, url: fileUrl(s.shot), kind: "image" }));
  const links = h("div", { class: "links" }, [
    r.report && h("a", { class: "btn", href: fileUrl(r.report), target: "_blank", rel: "noreferrer", text: "Mở báo cáo" }),
    h("button", { class: "btn ghost", type: "button", text: "Thư mục evidence", onclick: () => go("files/" + enc(r.folder)) }),
    h("span", { class: "muted", style: "align-self:center", text: fullTime(r.started) + (r.open ? " · session vẫn đang mở" : "") }),
  ]);
  const steps = r.steps.map((s) => {
    const idx = shots.findIndex((x) => x.url === (s.shot && fileUrl(s.shot)));
    const media = s.shot
      ? h("button", { class: "shot", type: "button", "aria-label": "Xem lớn ảnh bước " + s.i, onclick: () => showGallery(shots, idx) },
          [thumbImg(s.thumb && fileUrl(s.thumb), fileUrl(s.shot))])
      : null;
    return h("figure", { class: "step" + (s.ok ? "" : " bad") }, [
      media,
      h("figcaption", {}, [
        h("div", { class: "lbl", text: "#" + s.i + " " + s.label }),
        h("div", { class: "meta" }, [
          h("span", { class: "pill " + (s.ok ? "ok" : "bad"), html: s.ok ? ICONS.check : ICONS.cross }, [s.ok ? "ĐẠT" : "LỖI"]),
          h("span", { class: "num", text: dur(s.ms) }),
          s.session && s.session !== r.session && h("span", { text: "session " + s.session }),
        ]),
        s.error && h("div", { class: "error", text: s.error }),
      ]),
    ]);
  });
  return h("div", { class: "run-detail" }, [links, h("div", { class: "steps" }, steps)]);
}

for (const b of $$("#run-filter button")) b.onclick = () => {
  state.runFilter = b.dataset.v;
  for (const x of $$("#run-filter button")) x.setAttribute("aria-pressed", String(x === b));
  renderRuns();
};
$("#run-session").onchange = (e) => { state.runSession = e.target.value; renderRuns(); };

/* ---------- Files ---------- */

async function loadAssets() {
  try {
    state.assets = await api("/api/assets");
    online(true);
  } catch (e) {
    online(false);
    return;
  }
  renderFolders();
  renderFolder();
}

const EXTERNAL = "__external__";

function renderFolders() {
  const a = state.assets;
  const showEmpty = $("#show-empty").checked;
  const folders = a.folders.filter((f) => showEmpty || f.files > 0 || f.session);
  const total = a.folders.reduce((n, f) => n + f.size, 0);
  $("#files-meta").textContent = a.root + " · " + a.folders.length + " thư mục · " + size(total);
  if (!state.folder || (state.folder !== EXTERNAL && !a.folders.some((f) => f.name === state.folder))) {
    state.folder = folders[0] ? folders[0].name : a.external.length ? EXTERNAL : null;
  }
  const items = [];
  if (a.external.length) {
    items.push(h("button", { class: "folder", type: "button", role: "listitem", "aria-current": String(state.folder === EXTERNAL), onclick: () => go("files/" + EXTERNAL) }, [
      h("div", { class: "row" }, [h("span", { class: "fname", text: "Lưu ngoài thư mục evidence" })]),
      h("div", { class: "fmeta", text: a.external.length + " file do tool ghi (ảnh, PDF, file tải về)" }),
    ]));
  }
  for (const f of folders) {
    const p = folderParts(f.name);
    const meta = [f.files + " file", size(f.size), ago(f.mtime)];
    if (f.failed) meta.push(f.failed + " ảnh lỗi");
    items.push(h("button", { class: "folder", type: "button", role: "listitem", "aria-current": String(state.folder === f.name), title: f.name, onclick: () => go("files/" + enc(f.name)) }, [
      h("div", { class: "row" }, [h("span", { class: "fname", text: p.session }), f.session && tag("Đang mở", "accent")]),
      h("div", { class: "fmeta", text: meta.join(" · ") }),
    ]));
  }
  const hidden = a.folders.length - folders.length;
  if (hidden) items.push(h("div", { class: "folder fmeta", style: "cursor:default", text: "Đã ẩn " + hidden + " thư mục rỗng" }));
  if (!items.length) items.push(h("div", { class: "empty", text: "Chưa có file nào" }));
  $("#folder-list").replaceChildren(...items);
}

async function renderFolder() {
  const box = $("#folder-content");
  const a = state.assets;
  if (!state.folder) {
    box.replaceChildren(h("div", { class: "empty" }, [h("h2", { text: "Chưa có evidence" }), h("p", { text: "Ảnh từng bước, báo cáo, video và trace của các session sẽ nằm ở đây." })]));
    return;
  }
  if (state.folder === EXTERNAL) {
    box.replaceChildren(
      h("div", { class: "content-head" }, [h("h2", { text: "Lưu ngoài thư mục evidence" })]),
      fileGroups(a.external.map((f) => ({ ...f, name: f.path, url: extUrl(f.path), external: true }))),
    );
    return;
  }
  const folder = a.folders.find((f) => f.name === state.folder);
  let files;
  try {
    files = (await api("/api/assets/" + enc(state.folder))).files;
  } catch (e) {
    box.replaceChildren(h("div", { class: "empty", text: e.message }));
    return;
  }
  const p = folderParts(folder.name);
  const head = h("div", { class: "content-head" }, [
    h("div", {}, [h("h2", { text: p.session }), h("div", { class: "muted mono", text: folder.name })]),
    folder.session && tag("Session đang mở", "accent"),
    h("div", { class: "right" }, [
      folder.hasReport && h("a", { class: "btn", href: fileUrl(folder.name + "/report.html"), target: "_blank", rel: "noreferrer", text: "Mở báo cáo" }),
      h("button", { class: "btn ghost danger", type: "button", text: "Xoá thư mục", disabled: !!folder.session,
        title: folder.session ? "Đóng session trước khi xoá thư mục" : null,
        onclick: () => remove({ path: folder.name }, "thư mục " + folder.name) }),
    ]),
  ]);
  const prefix = folder.name + "/";
  box.replaceChildren(head, fileGroups(files.map((f) => ({ ...f, name: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path, url: fileUrl(f.path) }))));
}

function fileGroups(files) {
  const wrap = h("div");
  if (!files.length) {
    wrap.append(h("div", { class: "empty", text: "Thư mục này chưa có file nào." }));
    return wrap;
  }
  const images = files.filter((f) => f.kind === "image");
  const gallery = images.map((f) => ({ title: f.name, url: f.url, kind: "image" }));
  const byDir = new Map();
  images.forEach((f, i) => {
    const dir = f.name.includes("/") ? f.name.slice(0, f.name.lastIndexOf("/")) : "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push([f, i]);
  });
  for (const [dir, list] of byDir) {
    wrap.append(h("div", { class: "group" }, [
      h("h3", { text: (dir || "Ảnh") + " · " + list.length }),
      h("div", { class: "grid" }, list.map(([f, i]) => {
        const base = f.name.slice(f.name.lastIndexOf("/") + 1);
        return h("figure", { class: "tile" + (/FAILED/.test(base) ? " bad" : "") }, [
          h("button", { type: "button", "aria-label": "Xem lớn " + base, onclick: () => showGallery(gallery, i) }, [thumbImg(f.thumb && (f.external ? null : fileUrl(f.thumb)), f.url)]),
          h("figcaption", { title: f.name, text: base }),
        ]);
      })),
    ]));
  }
  const others = files.filter((f) => f.kind !== "image");
  if (others.length) {
    const kinds = { video: "Video", report: "Báo cáo", trace: "Trace", har: "HAR", pdf: "PDF", other: "File" };
    wrap.append(h("div", { class: "group" }, [
      h("h3", { text: "File khác · " + others.length }),
      h("div", { class: "rows" }, others.map((f) => h("div", { class: "frow" }, [
        h("span", { class: "tag", text: kinds[f.kind] || "File" }),
        f.kind === "video" || f.kind === "pdf" || f.kind === "report"
          ? h("a", { class: "fn mono", href: "#", text: f.name, onclick: (e) => { e.preventDefault(); showFile(f); } })
          : h("span", { class: "fn mono", text: f.name }),
        h("span", { class: "muted num hide-sm", text: size(f.size) }),
        h("span", { class: "muted hide-sm", text: ago(f.mtime), title: fullTime(f.mtime) }),
        h("span", { class: "acts" }, [
          h("a", { class: "btn icon ghost", href: f.url, target: "_blank", rel: "noreferrer", "aria-label": "Mở " + f.name, title: "Mở trong tab mới", html: ICONS.open }),
          h("a", { class: "btn icon ghost", href: f.url + (f.url.includes("?") ? "&" : "?") + "download", "aria-label": "Tải " + f.name, title: "Tải về", html: ICONS.download }),
          iconBtn("trash", "Xoá " + f.name, () => remove(f.external ? { external: f.path } : { path: f.path }, f.name), "danger"),
        ]),
      ]))),
    ]));
  }
  return wrap;
}

async function remove(body, label) {
  if (!confirm("Xoá " + label + "? Không khôi phục được.")) return;
  try {
    await api("/api/assets/delete", body);
    toast("Đã xoá " + label);
    loadAssets();
  } catch (e) { toast(e.message, true); }
}

$("#show-empty").onchange = () => renderFolders();
$("#prune").onclick = async () => {
  const days = Number($("#prune-days").value);
  const scope = days ? "không còn mở và cũ hơn " + days + " ngày" : "không thuộc session nào đang mở";
  if (!confirm("Xoá mọi thư mục evidence " + scope + "?")) return;
  try {
    const r = await api("/api/assets/prune", { olderThanDays: days });
    toast(r.removed.length ? "Đã xoá " + r.removed.length + " thư mục" : "Không có thư mục nào cần dọn");
    loadAssets();
  } catch (e) { toast(e.message, true); }
};

/* ---------- Viewer ---------- */

const viewer = $("#viewer");
$("#v-prev").innerHTML = ICONS.back;
$("#v-next").innerHTML = ICONS.next;
$("#v-close").innerHTML = ICONS.close;
$("#v-close").onclick = () => viewer.close();
viewer.addEventListener("close", () => { clearInterval(liveTimer); $("#v-body").replaceChildren(); });
viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
let gallery = null;

function showViewer(o) {
  $("#v-title").textContent = o.title;
  $("#v-body").replaceChildren(o.node);
  const open = $("#v-open");
  open.hidden = !o.open;
  if (o.open) open.href = o.open;
  const multi = gallery && gallery.items.length > 1;
  $("#v-prev").hidden = $("#v-next").hidden = !multi;
  $("#v-count").textContent = multi ? (gallery.i + 1) + " / " + gallery.items.length : "";
  if (!viewer.open) viewer.showModal();
}

function showGallery(items, i) {
  gallery = { items, i };
  const it = items[i];
  showViewer({ title: it.title, node: h("img", { src: it.url, alt: it.title }), open: it.url });
}
function step(d) {
  if (!gallery || gallery.items.length < 2) return;
  showGallery(gallery.items, (gallery.i + d + gallery.items.length) % gallery.items.length);
}
$("#v-prev").onclick = () => step(-1);
$("#v-next").onclick = () => step(1);
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

function showFile(f) {
  gallery = null;
  const node = f.kind === "video"
    ? h("video", { src: f.url, controls: true, autoplay: true })
    : h("iframe", { src: f.url, title: f.name, sandbox: "allow-popups allow-same-origin" });
  showViewer({ title: f.name, node, open: f.url });
}

/* ---------- Updates ---------- */

// One fetch in flight per kind; a change arriving meanwhile queues one more.
function coalesce(load) {
  let busy = false, again = false;
  return async function run() {
    if (busy) { again = true; return; }
    busy = true;
    try { await load(); } finally { busy = false; if (again) { again = false; run(); } }
  };
}
const refreshSessions = coalesce(loadSessions);
const refreshRuns = coalesce(loadRuns);
// Re-listing files mid-flow would reload the grid on every step.
let assetsAt = 0;
function refreshAssets() {
  if (Date.now() - assetsAt < 3000) return;
  assetsAt = Date.now();
  loadAssets();
}

// The server pushes a change whenever any instance opens or closes a session,
// starts a flow, finishes a step or logs an error.
let live = false;
const events = new EventSource("/api/events");
events.onopen = () => { live = true; online(true); };
events.onerror = () => { live = false; online(false); };
events.addEventListener("change", (e) => {
  const what = JSON.parse(e.data);
  online(true);
  if (document.hidden) return;
  if (what.runs) refreshRuns();
  // Also off the session view: the nav count and a card's last run follow it.
  if (what.sessions || what.runs) refreshSessions();
  if (state.view === "files" && what.runs) refreshAssets();
});

route();
refreshRuns();
if (state.view !== "sessions") refreshSessions();
// Tabs and URLs change without touching the store, so the session view still
// re-reads slowly; live pictures follow their own pace.
setInterval(() => {
  if (document.hidden || viewer.open) return;
  if (state.view === "sessions") refreshSessions();
  if (!live) refreshRuns();
}, 5000);
setInterval(refreshShots, 500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) route(); });
</script>
</body>
</html>`;
