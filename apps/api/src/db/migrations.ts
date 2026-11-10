/**
 * Forward-only SQL migrations. Each runs once, in order, inside a transaction; the applied ids are kept in
 * the `schema_migrations` table. Add a new entry to change the schema, never edit an applied one.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial schema",
    sql: /* sql */ `
      CREATE TABLE projects (
        id               INTEGER PRIMARY KEY,
        name             TEXT NOT NULL,
        description      TEXT NOT NULL DEFAULT '',
        next_case_number INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL
      );

      CREATE TABLE suites (
        id          INTEGER PRIMARY KEY,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        UNIQUE (project_id, name)
      );

      CREATE TABLE test_cases (
        id                  INTEGER PRIMARY KEY,
        project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        suite_id            INTEGER REFERENCES suites(id) ON DELETE SET NULL,
        number              INTEGER NOT NULL,
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        preconditions       TEXT NOT NULL DEFAULT '',
        steps               TEXT NOT NULL DEFAULT '[]',
        priority            TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')),
        tags                TEXT NOT NULL DEFAULT '[]',
        platform            TEXT NOT NULL CHECK (platform IN ('API','Web','Mobile-Android','Mobile-iOS')),
        type                TEXT NOT NULL CHECK (type IN ('manual','automated')),
        automation_ref      TEXT,
        automation_ref_norm TEXT,
        requirement         TEXT NOT NULL DEFAULT '',
        status              TEXT NOT NULL CHECK (status IN ('draft','ready','deprecated')),
        source              TEXT NOT NULL CHECK (source IN ('manual','import','ai')),
        needs_review        INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE (project_id, number)
      );
      CREATE INDEX idx_cases_project ON test_cases(project_id, suite_id);
      CREATE INDEX idx_cases_ref ON test_cases(project_id, automation_ref_norm);

      CREATE TABLE runs (
        id          INTEGER PRIMARY KEY,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT '',
        build       TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        closed_at   TEXT
      );
      CREATE INDEX idx_runs_project ON runs(project_id, created_at);

      CREATE TABLE run_items (
        id              INTEGER PRIMARY KEY,
        run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_id         INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'untested'
                        CHECK (status IN ('untested','passed','failed','blocked','skipped','retest')),
        comment         TEXT NOT NULL DEFAULT '',
        duration_ms     INTEGER,
        executed_by     TEXT NOT NULL DEFAULT '',
        executed_at     TEXT,
        failure_message TEXT NOT NULL DEFAULT '',
        failure_details TEXT NOT NULL DEFAULT '',
        triage          TEXT,
        UNIQUE (run_id, case_id)
      );
      CREATE INDEX idx_items_case ON run_items(case_id);

      CREATE TABLE attachments (
        id            INTEGER PRIMARY KEY,
        run_item_id   INTEGER NOT NULL REFERENCES run_items(id) ON DELETE CASCADE,
        file_name     TEXT NOT NULL,
        mime_type     TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL DEFAULT 0,
        kind          TEXT NOT NULL CHECK (kind IN ('image','video','text','file')),
        storage_key   TEXT,
        external_path TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_item ON attachments(run_item_id);
    `,
  },
];
