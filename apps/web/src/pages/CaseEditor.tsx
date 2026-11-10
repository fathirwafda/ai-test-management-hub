import {
  CASE_STATUSES,
  CASE_TYPES,
  PLATFORMS,
  PRIORITIES,
  type CaseStatus,
  type CaseType,
  type Platform,
  type Priority,
  type TestCase,
  type TestStep,
} from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useCase, useCaseHistory, useSuites } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { StepsEditor } from "../components/StepsEditor";
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDate } from "../lib/format";

interface FormState {
  title: string;
  suiteId: number | null;
  platform: Platform;
  type: CaseType;
  priority: Priority;
  status: CaseStatus;
  tags: string;
  automationRef: string;
  requirement: string;
  description: string;
  preconditions: string;
  steps: TestStep[];
}

const blank = (suiteId: number | null): FormState => ({
  title: "",
  suiteId,
  platform: "Web",
  type: "manual",
  priority: "medium",
  status: "draft",
  tags: "",
  automationRef: "",
  requirement: "",
  description: "",
  preconditions: "",
  steps: [{ action: "", expected: "" }],
});

const fromCase = (c: TestCase): FormState => ({
  title: c.title,
  suiteId: c.suiteId,
  platform: c.platform,
  type: c.type,
  priority: c.priority,
  status: c.status,
  tags: c.tags.join(", "),
  automationRef: c.automationRef ?? "",
  requirement: c.requirement,
  description: c.description,
  preconditions: c.preconditions,
  steps: c.steps,
});

function toPayload(f: FormState) {
  return {
    title: f.title,
    suiteId: f.suiteId,
    platform: f.platform,
    type: f.type,
    priority: f.priority,
    status: f.status,
    tags: f.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    automationRef: f.type === "automated" && f.automationRef.trim() ? f.automationRef.trim() : null,
    requirement: f.requirement,
    description: f.description,
    preconditions: f.preconditions,
    steps: f.steps.filter((s) => s.action.trim()),
  };
}

function History({ caseId, projectId }: { caseId: number; projectId: number }) {
  const history = useCaseHistory(caseId);
  if (history.isPending) return <Loading />;
  if (!history.data?.length) return <Empty>Not part of any run yet.</Empty>;
  return (
    <ul className="history-list">
      {history.data.map((h) => (
        <li key={h.runId}>
          <Link to={`/p/${projectId}/runs/${h.runId}`}>{h.runName}</Link>
          <StatusBadge status={h.status} />
          <span className="hint">{formatDate(h.executedAt ?? h.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CaseEditorPage() {
  const projectId = useProjectId();
  const { caseId } = useParams();
  const id = caseId ? Number(caseId) : null;
  const [search] = useSearchParams();
  const existing = useCase(id);

  if (id && existing.isPending) return <Loading />;
  if (id && existing.isError) return <Alert>{errorMessage(existing.error)}</Alert>;
  const c = id ? existing.data : undefined;
  // Remount the form when another case is loaded, so its state starts from that case.
  return (
    <CaseForm
      key={c ? String(c.id) : "new"}
      projectId={projectId}
      existing={c}
      initial={c ? fromCase(c) : blank(search.get("suiteId") ? Number(search.get("suiteId")) : null)}
    />
  );
}

function CaseForm({
  projectId,
  existing: c,
  initial,
}: {
  projectId: number;
  existing: TestCase | undefined;
  initial: FormState;
}) {
  const id = c?.id ?? null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suites = useSuites(projectId);
  const [form, setForm] = useState<FormState>(initial);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const invalidate = async (c: TestCase) => {
    qc.setQueryData(keys.case(c.id), c);
    await qc.invalidateQueries({ queryKey: keys.cases(projectId) });
    await qc.invalidateQueries({ queryKey: keys.suites(projectId) });
    await qc.invalidateQueries({ queryKey: keys.tags(projectId) });
    await qc.invalidateQueries({ queryKey: keys.dashboard(projectId) });
  };

  const save = useMutation({
    mutationFn: (markReviewed: boolean) =>
      id
        ? api.patch<TestCase>(`/api/cases/${id}`, {
            ...toPayload(form),
            ...(markReviewed ? { needsReview: false } : {}),
          })
        : api.post<TestCase>(`/api/projects/${projectId}/cases`, toPayload(form)),
    onSuccess: async (c) => {
      await invalidate(c);
      setSaved(true);
      if (!id) void navigate(`/p/${projectId}/cases/${c.id}`, { replace: true });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/cases/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.cases(projectId) });
      void navigate(`/p/${projectId}/cases`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(false);
  };

  return (
    <>
      <PageHeader
        title={c ? `${c.key} · ${c.title}` : "New test case"}
        subtitle={
          c
            ? `Created ${formatDate(c.createdAt)} · updated ${formatDate(c.updatedAt, true)} · source: ${c.source}`
            : undefined
        }
        actions={
          <Link to={`/p/${projectId}/cases`} className="btn btn-ghost">
            ← Back to cases
          </Link>
        }
      />
      {c?.needsReview && (
        <Alert tone="warning">
          This case was created automatically from an imported result. Check the title, platform and steps, then save
          and mark it reviewed.
        </Alert>
      )}
      <div className="editor-layout">
        <form className="card form" onSubmit={submit} aria-label="Test case">
          <Field label="Title">
            {(fid) => (
              <input
                id={fid}
                required
                maxLength={300}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            )}
          </Field>
          <div className="form-grid">
            <Field label="Suite">
              {(fid) => (
                <select
                  id={fid}
                  value={form.suiteId ?? ""}
                  onChange={(e) => set("suiteId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No suite</option>
                  {suites.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Platform">
              {(fid) => (
                <select id={fid} value={form.platform} onChange={(e) => set("platform", e.target.value as Platform)}>
                  {PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Type">
              {(fid) => (
                <select id={fid} value={form.type} onChange={(e) => set("type", e.target.value as CaseType)}>
                  {CASE_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Priority">
              {(fid) => (
                <select id={fid} value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Status">
              {(fid) => (
                <select id={fid} value={form.status} onChange={(e) => set("status", e.target.value as CaseStatus)}>
                  {CASE_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Tags" hint="Comma separated, e.g. checkout, smoke">
              {(fid) => <input id={fid} value={form.tags} onChange={(e) => set("tags", e.target.value)} />}
            </Field>
          </div>
          {form.type === "automated" && (
            <Field
              label="Automation reference"
              hint="Used to map imported results: classname#method (JUnit) or file#Describe > title (Playwright)."
            >
              {(fid) => (
                <input
                  id={fid}
                  className="mono"
                  placeholder="com.shop.api.CartApiTest#addsItem or e2e/cart.spec.ts#Cart > adds item"
                  value={form.automationRef}
                  onChange={(e) => set("automationRef", e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Linked requirement / story">
            {(fid) => (
              <textarea
                id={fid}
                rows={2}
                value={form.requirement}
                onChange={(e) => set("requirement", e.target.value)}
              />
            )}
          </Field>
          <div className="form-grid two">
            <Field label="Description">
              {(fid) => (
                <textarea
                  id={fid}
                  rows={3}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              )}
            </Field>
            <Field label="Preconditions">
              {(fid) => (
                <textarea
                  id={fid}
                  rows={3}
                  value={form.preconditions}
                  onChange={(e) => set("preconditions", e.target.value)}
                />
              )}
            </Field>
          </div>
          <StepsEditor steps={form.steps} onChange={(s) => set("steps", s)} />

          {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
          {remove.isError && <Alert>{errorMessage(remove.error)}</Alert>}
          {saved && <Alert tone="success">Saved.</Alert>}
          <div className="row">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {id ? "Save changes" : "Create case"}
            </Button>
            {c?.needsReview && (
              <Button onClick={() => save.mutate(true)} disabled={save.isPending}>
                Save and mark reviewed
              </Button>
            )}
            {c && (
              <Button
                variant="danger"
                className="push-right"
                onClick={() => {
                  if (window.confirm(`Delete ${c.key}? Cases with results cannot be deleted; deprecate them instead.`))
                    remove.mutate();
                }}
              >
                Delete
              </Button>
            )}
          </div>
        </form>
        {c && (
          <Card title="Result history">
            <History caseId={c.id} projectId={projectId} />
            {c.automationRef && (
              <p className="hint">
                Automation: <code>{c.automationRef}</code>
              </p>
            )}
            <div className="row wrap">
              {c.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
