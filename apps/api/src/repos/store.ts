import type { Db } from "../db/database.js";
import { AttachmentRepo } from "./attachments.js";
import { CaseRepo } from "./cases.js";
import { systemClock, type Clock, type RepoContext } from "./context.js";
import { ProjectRepo, SuiteRepo } from "./projects.js";
import { RunRepo } from "./runs.js";

export interface Store {
  ctx: RepoContext;
  projects: ProjectRepo;
  suites: SuiteRepo;
  cases: CaseRepo;
  runs: RunRepo;
  attachments: AttachmentRepo;
  transaction<T>(fn: () => T): T;
}

export function createStore(db: Db, clock: Clock = systemClock): Store {
  const ctx: RepoContext = { db, clock };
  const projects = new ProjectRepo(ctx);
  return {
    ctx,
    projects,
    suites: new SuiteRepo(ctx),
    cases: new CaseRepo(ctx, projects),
    runs: new RunRepo(ctx),
    attachments: new AttachmentRepo(ctx),
    transaction: (fn) => db.transaction(fn)(),
  };
}
