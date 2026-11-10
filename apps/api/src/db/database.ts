import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations, type Migration } from "./migrations.js";

export type Db = Database.Database;

/** Opens (and creates) the SQLite file, or an in-memory database for ":memory:". */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate(db: Db, list: Migration[] = migrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((r) => (r as { id: number }).id),
  );
  const ran: number[] = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    })();
    ran.push(m.id);
  }
  return ran;
}
