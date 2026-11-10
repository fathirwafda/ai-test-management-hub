import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { migrate, openDatabase } from "../db/database.js";
import { EvidenceStore } from "../lib/evidence-store.js";
import { createStore } from "../repos/store.js";
import { SeedClock, seedDemo } from "./demo.js";

/**
 * npm run seed            -> resets DATA_DIR's database and uploads, then loads the demo project
 * node dist/seed/run.js   -> same, from the built output (used by the E2E web server)
 */
const config = loadConfig();
const reset = process.argv.includes("--reset");

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

if (reset) {
  for (const target of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`, config.uploadDir]) {
    // Only ever delete inside the data directory.
    if (inside(target, config.dataDir)) fs.rmSync(target, { recursive: true, force: true });
  }
}

const db = openDatabase(config.dbFile);
migrate(db);
const store = createStore(db);
if (store.projects.list().length > 0) {
  console.log("Database already has projects; run with --reset to replace them with the demo data.");
  db.close();
  process.exit(0);
}
const clock = new SeedClock(new Date());
const evidence = new EvidenceStore(config.uploadDir);
await evidence.init();
const { projectId } = await seedDemo(createStore(db, clock), evidence, clock);
const counts = store.projects.get(projectId);
console.log(`Seeded "${counts.name}": ${counts.caseCount} cases, ${counts.runCount} runs. Database: ${config.dbFile}`);
db.close();
