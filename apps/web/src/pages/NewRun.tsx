import { CASE_TYPES, PLATFORMS, type Run } from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useCases, useSuites, useTags } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { Alert, Button, Card, Field, PageHeader } from "../components/ui";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function CheckGroup({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="check-group">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o} className="check">
          <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(toggle(value, o))} />
          {o}
        </label>
      ))}
      {options.length === 0 && <span className="hint">none</span>}
    </fieldset>
  );
}

export function NewRunPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suites = useSuites(projectId);
  const tags = useTags(projectId);

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("staging");
  const [build, setBuild] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [suiteId, setSuiteId] = useState<number | undefined>(undefined);
  const [includeDrafts, setIncludeDrafts] = useState(false);

  const statuses = includeDrafts ? ["ready", "draft"] : ["ready"];
  const filter = { platforms, types, tags: tagFilter, suiteId, statuses };
  const preview = useCases(projectId, filter);

  const create = useMutation({
    mutationFn: () => api.post<Run>(`/api/projects/${projectId}/runs`, { name, environment, build, filter }),
    onSuccess: async (run) => {
      await qc.invalidateQueries({ queryKey: keys.runs(projectId) });
      await qc.invalidateQueries({ queryKey: keys.dashboard(projectId) });
      void navigate(`/p/${projectId}/runs/${run.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const count = preview.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="New test run"
        subtitle="Pick the cases by platform, type, tag or suite. Deprecated cases are never included."
        actions={
          <Link to={`/p/${projectId}/runs`} className="btn btn-ghost">
            ← Back to runs
          </Link>
        }
      />
      <form className="editor-layout" onSubmit={submit} aria-label="New test run">
        <div className="card form">
          <Field label="Run name">
            {(id) => (
              <input
                id={id}
                required
                value={name}
                placeholder="e.g. Release 2.6.0 regression"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <div className="form-grid two">
            <Field label="Environment">
              {(id) => <input id={id} value={environment} onChange={(e) => setEnvironment(e.target.value)} />}
            </Field>
            <Field label="Build / version">
              {(id) => (
                <input id={id} value={build} placeholder="e.g. 2.6.0-rc.1" onChange={(e) => setBuild(e.target.value)} />
              )}
            </Field>
          </div>
          <CheckGroup legend="Platforms (none = all)" options={PLATFORMS} value={platforms} onChange={setPlatforms} />
          <CheckGroup legend="Types (none = all)" options={CASE_TYPES} value={types} onChange={setTypes} />
          <CheckGroup legend="Tags (any of)" options={tags.data ?? []} value={tagFilter} onChange={setTagFilter} />
          <div className="form-grid two">
            <Field label="Suite">
              {(id) => (
                <select
                  id={id}
                  value={suiteId ?? ""}
                  onChange={(e) => setSuiteId(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="">All suites</option>
                  {suites.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <label className="check align-end">
              <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
              Include draft cases
            </label>
          </div>
          {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
          <div className="row">
            <Button type="submit" variant="primary" disabled={!name.trim() || count === 0 || create.isPending}>
              Create run with {count} case{count === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
        <Card title={`Selected cases (${count})`}>
          <ul className="preview-list" aria-live="polite" data-testid="run-preview">
            {preview.data?.slice(0, 40).map((c) => (
              <li key={c.id}>
                <span className="mono">{c.key}</span> {c.title} <span className="hint">· {c.platform}</span>
              </li>
            ))}
            {count > 40 && <li className="hint">…and {count - 40} more</li>}
          </ul>
        </Card>
      </form>
    </>
  );
}
