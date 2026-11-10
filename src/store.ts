import { mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";

// One database shared by every instance on this machine, whichever MCP client
// started it: the sessions they can attach to, who is using each one, and the
// flow history and console messages the reports are built from.
export const DB_PATH = process.env.BROWSER_DB || join(homedir(), ".mcp-simple-browser", "data.db");

export interface SessionRow {
  id: string;
  // Null for a session only its own instance can drive (context isolation).
  cdpUrl: string | null;
  browserPid: number | null;
  // False for a Chrome the user started and attached to: it is never killed.
  owned: boolean;
  tempDir: string | null;
  evidenceDir: string;
  options: Record<string, unknown>;
  ownerPid: number;
  created: number;
}

export interface StoredConsole {
  seq: number;
  t: number;
  type: string;
  text: string;
  url?: string;
}

let db: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  // Two instances may create or migrate the file at once: the busy timeout has
  // to be in place before the first statement that takes a lock, and the
  // connection is kept only once it is fully set up, so a failed first call is
  // retried from scratch instead of leaving a half-made one behind.
  const conn = new DatabaseSync(DB_PATH);
  try {
    init(conn);
  } catch (err) {
    conn.close();
    throw err;
  }
  db = conn;
  return db;
}

function init(conn: DatabaseSync): void {
  conn.exec("PRAGMA busy_timeout = 5000");
  conn.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      cdp_url TEXT,
      browser_pid INTEGER,
      owned INTEGER NOT NULL,
      temp_dir TEXT,
      evidence_dir TEXT NOT NULL,
      options TEXT NOT NULL,
      owner_pid INTEGER NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holders (
      session_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      PRIMARY KEY (session_id, pid)
    );
    CREATE TABLE IF NOT EXISTS locks (
      session_id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      evidence_dir TEXT NOT NULL,
      id TEXT NOT NULL,
      dir TEXT NOT NULL,
      started INTEGER NOT NULL,
      PRIMARY KEY (evidence_dir, id)
    );
    CREATE TABLE IF NOT EXISTS steps (
      evidence_dir TEXT NOT NULL,
      run_id TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS steps_run ON steps (evidence_dir, run_id);
    CREATE TABLE IF NOT EXISTS console (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_dir TEXT NOT NULL,
      t INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT
    );
    CREATE INDEX IF NOT EXISTS console_dir ON console (evidence_dir, seq);
  `);
  // Progress columns came later; a database from an older version gains them.
  const columns = new Set((conn.prepare("PRAGMA table_info(runs)").all() as Row[]).map((c) => c.name as string));
  for (const [name, type] of [["total", "INTEGER"], ["pid", "INTEGER"], ["finished", "INTEGER"], ["current", "TEXT"]]) {
    if (columns.has(name)) continue;
    try {
      conn.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
}

function sql(text: string): StatementSync {
  let statement = statements.get(text);
  if (!statement) {
    statement = open().prepare(text);
    statements.set(text, statement);
  }
  return statement;
}

// BEGIN IMMEDIATE takes the write lock up front, so a read-then-write cannot
// interleave with another instance doing the same.
function transaction<T>(fn: () => T): T {
  open().exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    open().exec("COMMIT");
    return result;
  } catch (err) {
    open().exec("ROLLBACK");
    throw err;
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

type Row = Record<string, unknown>;

function toSession(row: Row): SessionRow {
  return {
    id: row.id as string,
    cdpUrl: (row.cdp_url as string | null) ?? null,
    browserPid: (row.browser_pid as number | null) ?? null,
    owned: row.owned === 1,
    tempDir: (row.temp_dir as string | null) ?? null,
    evidenceDir: row.evidence_dir as string,
    options: JSON.parse(row.options as string),
    ownerPid: row.owner_pid as number,
    created: row.created as number,
  };
}

export function findSessionRow(id: string): SessionRow | undefined {
  const row = sql("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
  return row ? toSession(row) : undefined;
}

export function allSessionRows(): Array<SessionRow & { holders: number[] }> {
  const rows = sql("SELECT * FROM sessions ORDER BY created").all() as Row[];
  return rows.map((row) => ({
    ...toSession(row),
    holders: (sql("SELECT pid FROM holders WHERE session_id = ?").all(row.id as string) as Row[]).map((h) => h.pid as number),
  }));
}

// Registers a session this instance just started. Returns false when another
// instance registered the same id first; the caller then attaches to that one.
export function registerSession(row: SessionRow): boolean {
  return transaction(() => {
    const { changes } = sql(
      `INSERT OR IGNORE INTO sessions (id, cdp_url, browser_pid, owned, temp_dir, evidence_dir, options, owner_pid, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.cdpUrl, row.browserPid, row.owned ? 1 : 0, row.tempDir, row.evidenceDir, JSON.stringify(row.options), row.ownerPid, row.created);
    if (changes === 0) return false;
    sql("INSERT OR IGNORE INTO holders (session_id, pid) VALUES (?, ?)").run(row.id, process.pid);
    return true;
  });
}

export function addHolder(id: string): void {
  sql("INSERT OR IGNORE INTO holders (session_id, pid) VALUES (?, ?)").run(id, process.pid);
}

export function deleteSessionRow(id: string): void {
  transaction(() => {
    sql("DELETE FROM sessions WHERE id = ?").run(id);
    sql("DELETE FROM holders WHERE session_id = ?").run(id);
    sql("DELETE FROM locks WHERE session_id = ?").run(id);
  });
}

// Drops this instance from the session and reports whether anyone is left.
// Synchronous, so it also works from the process "exit" handler.
export function releaseHolder(id: string): { row: SessionRow | undefined; others: number } {
  return transaction(() => {
    sql("DELETE FROM holders WHERE session_id = ? AND pid = ?").run(id, process.pid);
    const row = findSessionRow(id);
    const pids = (sql("SELECT pid FROM holders WHERE session_id = ?").all(id) as Row[]).map((h) => h.pid as number);
    const others = pids.filter((pid) => alive(pid));
    for (const pid of pids) if (!alive(pid)) sql("DELETE FROM holders WHERE session_id = ? AND pid = ?").run(id, pid);
    return { row, others: others.length };
  });
}

// A session is gone once its browser is, and abandoned once no live instance
// holds it, e.g. after its last client was killed without a chance to clean up.
export function reap(kill: (row: SessionRow) => void): void {
  for (const row of allSessionRows()) {
    const browserGone = row.browserPid !== null && !alive(row.browserPid);
    const held = row.holders.some((pid) => alive(pid));
    if (!browserGone && held) continue;
    if (!browserGone && row.owned) kill(row);
    if (row.tempDir) rmSync(row.tempDir, { recursive: true, force: true, maxRetries: 3 });
    deleteSessionRow(row.id);
  }
  for (const lock of sql("SELECT session_id, pid FROM locks").all() as Row[]) {
    if (!alive(lock.pid as number)) sql("DELETE FROM locks WHERE session_id = ? AND pid = ?").run(lock.session_id as string, lock.pid as number);
  }
}

// One instance drives a session at a time. The lock is per process, so calls
// from the same client share it; it expires so a hung holder cannot block forever.
export function tryLock(id: string, ms: number): { ok: true } | { ok: false; pid: number } {
  return transaction(() => {
    const now = Date.now();
    const held = sql("SELECT pid, until FROM locks WHERE session_id = ?").get(id) as Row | undefined;
    if (held && held.pid !== process.pid && (held.until as number) > now && alive(held.pid as number)) {
      return { ok: false, pid: held.pid as number };
    }
    sql("INSERT OR REPLACE INTO locks (session_id, pid, until) VALUES (?, ?, ?)").run(id, process.pid, now + ms);
    return { ok: true };
  });
}

export function unlock(id: string): void {
  sql("DELETE FROM locks WHERE session_id = ? AND pid = ?").run(id, process.pid);
}

export function insertRun(evidenceDir: string, makeDir: (id: string) => string, started: number, total: number): { id: string; dir: string } {
  return transaction(() => {
    const { n } = sql("SELECT COUNT(*) AS n FROM runs WHERE evidence_dir = ?").get(evidenceDir) as { n: number };
    const id = `run-${String(n + 1).padStart(2, "0")}`;
    const dir = makeDir(id);
    sql("INSERT INTO runs (evidence_dir, id, dir, started, total, pid) VALUES (?, ?, ?, ?, ?, ?)").run(evidenceDir, id, dir, started, total, process.pid);
    return { id, dir };
  });
}

// What the flow is doing right now, as "<index>\t<label>".
export function setRunCurrent(evidenceDir: string, runId: string, index: number, label: string): void {
  sql("UPDATE runs SET current = ? WHERE evidence_dir = ? AND id = ?").run(`${index}\t${label}`, evidenceDir, runId);
}

export function finishRun(evidenceDir: string, runId: string): void {
  sql("UPDATE runs SET finished = ?, current = NULL WHERE evidence_dir = ? AND id = ?").run(Date.now(), evidenceDir, runId);
}

export interface RunProgress {
  total: number | null;
  // A run whose instance died mid-flow never finishes; it is not running either.
  running: boolean;
  current: { i: number; label: string } | null;
}

function progressOf(run: Row): RunProgress {
  const running = run.finished == null && typeof run.pid === "number" && alive(run.pid);
  const [i, label] = running && typeof run.current === "string" ? run.current.split("\t") : [];
  return {
    total: (run.total as number | null) ?? null,
    running,
    current: label !== undefined ? { i: Number(i), label } : null,
  };
}

// Changes whenever any instance opens or closes a session, starts a run,
// records a step or logs to the console; cheap enough to poll every second.
export function changeStamp(): { sessions: string; runs: string } {
  const row = sql(`SELECT
      (SELECT COUNT(*) FROM sessions) AS s, (SELECT COUNT(*) FROM holders) AS h,
      (SELECT COUNT(*) FROM runs) AS r, (SELECT COUNT(finished) FROM runs) AS f,
      (SELECT IFNULL(MAX(rowid), 0) FROM steps) AS st, (SELECT IFNULL(MAX(seq), 0) FROM console) AS c,
      (SELECT IFNULL(group_concat(current, '|'), '') FROM runs WHERE finished IS NULL) AS cur`).get() as Row;
  return { sessions: `${row.s}:${row.h}:${row.c}`, runs: `${row.r}:${row.f}:${row.st}:${row.cur}` };
}

export function insertStep(evidenceDir: string, runId: string, record: object): void {
  sql("INSERT INTO steps (evidence_dir, run_id, record) VALUES (?, ?, ?)").run(evidenceDir, runId, JSON.stringify(record));
}

export function loadRuns<T>(evidenceDir: string): Array<{ id: string; dir: string; started: number; steps: T[] } & RunProgress> {
  const runs = sql("SELECT id, dir, started, total, pid, finished, current FROM runs WHERE evidence_dir = ? ORDER BY started").all(evidenceDir) as Row[];
  return runs.map((run) => ({
    id: run.id as string,
    dir: run.dir as string,
    started: run.started as number,
    ...progressOf(run),
    steps: (sql("SELECT record FROM steps WHERE evidence_dir = ? AND run_id = ? ORDER BY rowid").all(evidenceDir, run.id as string) as Row[])
      .map((step) => JSON.parse(step.record as string) as T),
  }));
}

// The latest runs across every session, closed ones included.
export function recentRuns<T>(limit: number): Array<{ evidenceDir: string; id: string; dir: string; started: number; steps: T[] } & RunProgress> {
  const runs = sql("SELECT evidence_dir, id, dir, started, total, pid, finished, current FROM runs ORDER BY started DESC LIMIT ?").all(limit) as Row[];
  return runs.map((run) => ({
    evidenceDir: run.evidence_dir as string,
    id: run.id as string,
    dir: run.dir as string,
    started: run.started as number,
    ...progressOf(run),
    steps: (sql("SELECT record FROM steps WHERE evidence_dir = ? AND run_id = ? ORDER BY rowid").all(run.evidence_dir as string, run.id as string) as Row[])
      .map((step) => JSON.parse(step.record as string) as T),
  }));
}

export function insertConsole(evidenceDir: string, entries: Array<{ t: number; type: string; text: string; url?: string }>): void {
  if (!entries.length) return;
  transaction(() => {
    const insert = sql("INSERT INTO console (evidence_dir, t, type, text, url) VALUES (?, ?, ?, ?, ?)");
    for (const e of entries) insert.run(evidenceDir, e.t, e.type, e.text, e.url ?? null);
    // A chatty page would otherwise grow the table without bound.
    sql(`DELETE FROM console WHERE evidence_dir = ? AND seq <= (
           SELECT seq FROM console WHERE evidence_dir = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)`)
      .run(evidenceDir, evidenceDir, CONSOLE_KEEP);
  });
}

const CONSOLE_KEEP = 2000;

export function consoleErrorCount(evidenceDir: string): number {
  const { n } = sql("SELECT COUNT(*) AS n FROM console WHERE evidence_dir = ? AND type LIKE '%error%'").get(evidenceDir) as { n: number };
  return n;
}

// Rows that only describe a folder's flows and console; gone with the folder.
export function forgetEvidence(evidenceDir: string): void {
  transaction(() => {
    sql("DELETE FROM runs WHERE evidence_dir = ?").run(evidenceDir);
    sql("DELETE FROM steps WHERE evidence_dir = ?").run(evidenceDir);
    sql("DELETE FROM console WHERE evidence_dir = ?").run(evidenceDir);
  });
}

export function consoleSince(evidenceDir: string, seq: number): StoredConsole[] {
  const rows = sql("SELECT seq, t, type, text, url FROM console WHERE evidence_dir = ? AND seq > ? ORDER BY seq").all(evidenceDir, seq) as Row[];
  return rows.map((row) => ({
    seq: row.seq as number,
    t: row.t as number,
    type: row.type as string,
    text: row.text as string,
    ...(row.url ? { url: row.url as string } : {}),
  }));
}
