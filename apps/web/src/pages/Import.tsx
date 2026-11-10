import { PLATFORMS, type ImportSummary } from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import { useRuns, useSuites } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { Alert, Badge, Button, Card, Field, PageHeader } from "../components/ui";

export function ImportPage() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const runs = useRuns(projectId);
  const suites = useSuites(projectId);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("auto");
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [runId, setRunId] = useState("");
  const [runName, setRunName] = useState("");
  const [environment, setEnvironment] = useState("ci");
  const [build, setBuild] = useState("");
  const [platform, setPlatform] = useState<string>("API");
  const [suiteId, setSuiteId] = useState("");

  const openRuns = runs.data?.filter((r) => r.status === "open") ?? [];

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("format", format);
      form.append("platform", platform);
      if (suiteId) form.append("suiteId", suiteId);
      if (target === "existing" && runId) form.append("runId", runId);
      else {
        form.append("runName", runName);
        form.append("environment", environment);
        form.append("build", build);
      }
      form.append("file", file!, file!.name);
      return api.upload<ImportSummary>(`/api/projects/${projectId}/imports`, form);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const result = submit.data;

  return (
    <>
      <PageHeader
        title="Import automated results"
        subtitle="JUnit XML (Maven Surefire, TestNG, REST Assured, Selenium, Appium, pytest, Jest) or Playwright JSON reporter output."
      />
      <div className="editor-layout">
        <form className="card form" onSubmit={onSubmit} aria-label="Import results">
          <Field
            label="Report file"
            hint="Results map to cases by case key in the test title (e.g. [TC-12]) or by automation reference."
          >
            {(id) => (
              <input
                id={id}
                type="file"
                accept=".xml,.json,application/xml,application/json,text/xml"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          <div className="form-grid two">
            <Field label="Format">
              {(id) => (
                <select id={id} value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="auto">Detect automatically</option>
                  <option value="junit">JUnit XML</option>
                  <option value="playwright">Playwright JSON</option>
                </select>
              )}
            </Field>
            <Field label="Platform for new cases" hint="Used when a result matches no case.">
              {(id) => (
                <select id={id} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Suite for new cases">
            {(id) => (
              <select id={id} value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                <option value="">No suite</option>
                {suites.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="check-group">
            <legend>Target run</legend>
            <label className="check">
              <input type="radio" name="target" checked={target === "new"} onChange={() => setTarget("new")} /> Create a
              new run
            </label>
            <label className="check">
              <input
                type="radio"
                name="target"
                checked={target === "existing"}
                disabled={openRuns.length === 0}
                onChange={() => setTarget("existing")}
              />{" "}
              Add to an open run
            </label>
          </fieldset>
          {target === "new" ? (
            <div className="form-grid">
              <Field label="Run name" hint="Defaults to the format and time.">
                {(id) => (
                  <input
                    id={id}
                    value={runName}
                    placeholder="API regression (CI)"
                    onChange={(e) => setRunName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Environment">
                {(id) => <input id={id} value={environment} onChange={(e) => setEnvironment(e.target.value)} />}
              </Field>
              <Field label="Build">
                {(id) => <input id={id} value={build} onChange={(e) => setBuild(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <Field label="Open run">
              {(id) => (
                <select id={id} value={runId} required onChange={(e) => setRunId(e.target.value)}>
                  <option value="">Choose a run…</option>
                  {openRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {submit.isError && <Alert>{errorMessage(submit.error)}</Alert>}
          <div className="row">
            <Button type="submit" variant="primary" disabled={!file || submit.isPending}>
              {submit.isPending ? "Importing…" : "Import results"}
            </Button>
          </div>
        </form>

        <div className="stack">
          {result && (
            <Card title="Import complete" data-testid="import-summary">
              <dl className="kv">
                <div>
                  <dt>Format</dt>
                  <dd>{result.format}</dd>
                </div>
                <div>
                  <dt>Results</dt>
                  <dd data-testid="import-total">{result.total}</dd>
                </div>
                <div>
                  <dt>Mapped to cases</dt>
                  <dd data-testid="import-mapped">{result.mapped}</dd>
                </div>
                <div>
                  <dt>New draft cases</dt>
                  <dd data-testid="import-created">{result.created}</dd>
                </div>
              </dl>
              <p>
                {Object.entries(result.results)
                  .filter(([, n]) => n > 0)
                  .map(([s, n]) => `${n} ${s}`)
                  .join(" · ")}
              </p>
              {result.warnings.map((w) => (
                <Alert key={w} tone="warning">
                  {w}
                </Alert>
              ))}
              {result.createdCases.length > 0 && (
                <ul className="preview-list">
                  {result.createdCases.map((c) => (
                    <li key={c.id}>
                      <Link to={`/p/${projectId}/cases/${c.id}`}>
                        <span className="mono">{c.key}</span> {c.title}
                      </Link>{" "}
                      <Badge tone="warning">needs review</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="btn btn-primary" to={`/p/${projectId}/runs/${result.runId}`}>
                Open run
              </Link>
            </Card>
          )}
          <Card title="From CI">
            <p className="hint">Post results straight from a pipeline (see the README for a GitHub Actions example):</p>
            <pre className="log">{`curl -fsS -X POST \\
  -F file=@target/surefire-reports/TEST-results.xml \\
  -F runName="CI #\${GITHUB_RUN_NUMBER}" \\
  -F environment=staging -F build=\${GITHUB_SHA::7} \\
  ${window.location.origin}/api/projects/${projectId}/imports`}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}
