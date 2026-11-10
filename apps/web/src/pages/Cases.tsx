import { CASE_STATUSES, CASE_TYPES, PLATFORMS, type Suite } from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useCases, useSuites, useTags, type CaseListFilter } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { Alert, Badge, Button, Empty, Loading, PageHeader } from "../components/ui";

const PRIORITY_TONE: Record<string, string> = { critical: "danger", high: "warning", medium: "neutral", low: "muted" };

function SuiteList({
  projectId,
  selected,
  onSelect,
}: {
  projectId: number;
  selected: number | undefined;
  onSelect: (id?: number) => void;
}) {
  const suites = useSuites(projectId);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Suite>(`/api/projects/${projectId}/suites`, { name }),
    onSuccess: async () => {
      setName("");
      await qc.invalidateQueries({ queryKey: keys.suites(projectId) });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <nav className="suite-list" aria-label="Test suites">
      <h2 className="card-title">Suites</h2>
      <ul>
        <li>
          <button type="button" className={selected === undefined ? "active" : ""} onClick={() => onSelect(undefined)}>
            All cases
          </button>
        </li>
        {suites.data?.map((s) => (
          <li key={s.id}>
            <button type="button" className={selected === s.id ? "active" : ""} onClick={() => onSelect(s.id)}>
              <span>{s.name}</span>
              <span className="count">{s.caseCount}</span>
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="inline-form">
        <label htmlFor="new-suite" className="sr-only">
          New suite name
        </label>
        <input id="new-suite" placeholder="New suite…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
          Add
        </Button>
      </form>
      {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
    </nav>
  );
}

export function CasesPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tags = useTags(projectId);

  const get = (k: string) => params.get(k) ?? "";
  const filter: CaseListFilter = {
    suiteId: params.get("suiteId") ? Number(params.get("suiteId")) : undefined,
    q: get("q"),
    platforms: get("platform") ? [get("platform")] : [],
    types: get("type") ? [get("type")] : [],
    statuses: get("status") ? [get("status")] : [],
    tags: get("tag") ? [get("tag")] : [],
    needsReview: params.get("needsReview") === "true" ? true : undefined,
  };
  const cases = useCases(projectId, filter);

  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Test cases"
        subtitle="Organise cases in suites; filter by platform, type, status or tag."
        actions={
          <>
            <Link to={`/p/${projectId}/ai`} className="btn btn-secondary">
              ✦ Generate with AI
            </Link>
            <Link
              to={`/p/${projectId}/cases/new${filter.suiteId ? `?suiteId=${filter.suiteId}` : ""}`}
              className="btn btn-primary"
            >
              New case
            </Link>
          </>
        }
      />
      <div className="with-sidebar">
        <SuiteList
          projectId={projectId}
          selected={filter.suiteId}
          onSelect={(id) => set("suiteId", id ? String(id) : undefined)}
        />
        <div className="stack">
          <div className="filters" role="search">
            <input
              aria-label="Search cases"
              type="search"
              placeholder="Search title, key (TC-12) or automation ref"
              value={get("q")}
              onChange={(e) => set("q", e.target.value)}
            />
            <select aria-label="Platform" value={get("platform")} onChange={(e) => set("platform", e.target.value)}>
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select aria-label="Type" value={get("type")} onChange={(e) => set("type", e.target.value)}>
              <option value="">All types</option>
              {CASE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select aria-label="Status" value={get("status")} onChange={(e) => set("status", e.target.value)}>
              <option value="">All statuses</option>
              {CASE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select aria-label="Tag" value={get("tag")} onChange={(e) => set("tag", e.target.value)}>
              <option value="">All tags</option>
              {tags.data?.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {filter.needsReview && (
              <Button size="sm" variant="ghost" onClick={() => set("needsReview", undefined)}>
                Needs review ✕
              </Button>
            )}
          </div>

          {cases.isPending ? (
            <Loading />
          ) : cases.isError ? (
            <Alert>{errorMessage(cases.error)}</Alert>
          ) : cases.data.length === 0 ? (
            <Empty>No cases match these filters.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table" data-testid="cases-table">
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Title</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Type</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.data.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => void navigate(`/p/${projectId}/cases/${c.id}`)}>
                      <td className="mono">{c.key}</td>
                      <td>
                        <Link to={`/p/${projectId}/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                          {c.title}
                        </Link>
                        {c.needsReview && (
                          <>
                            {" "}
                            <Badge tone="warning" title="Created automatically from an import">
                              needs review
                            </Badge>
                          </>
                        )}
                        {c.source === "ai" && (
                          <>
                            {" "}
                            <Badge tone="ai">AI draft</Badge>
                          </>
                        )}
                      </td>
                      <td>{c.platform}</td>
                      <td>
                        <Badge tone={c.type === "automated" ? "info" : "neutral"}>{c.type}</Badge>
                      </td>
                      <td>
                        <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>
                      </td>
                      <td>
                        <span className={`case-status case-status-${c.status}`}>{c.status}</span>
                      </td>
                      <td className="tags">{c.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cases.data && <p className="hint">{cases.data.length} case(s)</p>}
        </div>
      </div>
    </>
  );
}
