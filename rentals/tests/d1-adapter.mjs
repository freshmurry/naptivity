// ============================================================================
// d1-adapter.mjs (TEST ONLY) — a D1-compatible adapter over node:sqlite.
// Lets the integration tests run the Worker's real SQL against a real
// SQLite database in-process. Not shipped in the Worker bundle path.
// ============================================================================
import { DatabaseSync } from "node:sqlite";

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  function prepare(sql) {
    let params = [];
    const api = {
      bind(...p) { params = p.map((v) => (v === undefined ? null : v)); return api; },
      async run() {
        const r = db.prepare(sql).run(...params);
        return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
      },
      async first(col) {
        const row = db.prepare(sql).get(...params);
        if (row == null) return null;
        return col ? row[col] : row;
      },
      async all() {
        return { success: true, results: db.prepare(sql).all(...params) };
      },
    };
    return api;
  }
  return {
    prepare,
    async exec(sql) { db.exec(sql); return { success: true }; },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}
