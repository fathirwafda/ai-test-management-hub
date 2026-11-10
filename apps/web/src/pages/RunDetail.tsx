import {
  RESULT_STATUSES,
  TRIAGE_LABELS,
  type Attachment,
  type ResultStatus,
  type Run,
  type RunDetail,
  type RunItem,
  type RunSummaryResponse,
  type TriageResponse,
} from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useRun } from "../api/hooks";
import { EvidenceItem } from "../components/Evidence";
import { useProjectId } from "../components/Layout";
import {
  AiLabel,
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Loading,
  PageHeader,
  ResultBar,
  STATUS_LABELS,
  StatusBadge,
} from "../components/ui";
import { formatDate, formatDuration, formatPercent, getTesterName } from "../lib/format";

const VERDICT: Record<string, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "success" },
  ready_with_risks: { label: "Ready with risks", tone: "warning" },
  not_ready: { label: "Not ready", tone: "danger" },
};

function useInvalidateRun(runId: number) {
  const qc = useQueryClient();
  const projectId = useProjectId();
  return async () => {
    await qc.invalidateQueries({ queryKey: keys.run(runId) });
    await qc.invalidateQueries({ queryKey: keys.runs(projectId) });
    await qc.invalidateQueries({ queryKey: keys.dashboard(projectId) });
  };
}

function TriagePanel({ item, closed }: { item: RunItem; closed: boolean }) {
  const invalidate = useInvalidateRun(item.runId);
  const suggest = useMutation({ mutationFn: () => api.post<TriageResponse>(`/api/run-items/${item.id}/triage`) });
  const accept = useMutation({
    mutationFn: (s: TriageResponse["suggestion"]) =>
      api.patch<RunItem>(`/api/run-items/${item.id}`, {
        triage: { category: s.category, summary: s.summary, acceptedBy: getTesterName() },
      }),
    onSuccess: async () => {
      suggest.reset();
      await invalidate();
    },
  });

  if (!["failed", "blocked", "retest"].includes(item.status)) return null;
  const s = suggest.data?.suggestion;

  return (
    <section className="triage" aria-label="Failure triage">
      <div className="row">
        <h3>Failure triage</h3>
        {!closed && (
          <Button size="sm" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
            {suggest.isPending ? "Thinking…" : "✦ Suggest cause"}
          </Button>
        )}
      </div>
      {item.triage && (
        <p className="saved-triage">
          <Badge tone="ai">{TRIAGE_LABELS[item.triage.category]}</Badge> {item.triage.summary}{" "}
          <span className="hint">
            (AI-suggested, accepted{item.triage.acceptedBy ? ` by ${item.triage.acceptedBy}` : ""}
            {item.triage.acceptedAt ? ` on ${formatDate(item.triage.acceptedAt)}` : ""})
          </span>
        </p>
      )}
      {suggest.isError && <Alert>{errorMessage(suggest.error)}</Alert>}
      {s && suggest.data && (
        <div className="ai-card" data-testid="triage-suggestion">
          <AiLabel {...suggest.data.meta} />
          <p>
            Likely cause: <Badge tone="ai">{TRIAGE_LABELS[s.category]}</Badge>{" "}
            <span className="hint">confidence {s.confidence}</span>
          </p>
          <p>
            <strong>{s.summary}</strong>
          </p>
          <p>{s.reasoning}</p>
          {s.signals.length > 0 && (
            <>
              <h4>Signals</h4>
              <ul>
                {s.signals.map((x) => (
                  <li key={x}>
                    <code>{x}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Suggested next steps</h4>
          <ul>
            {s.nextSteps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="row">
            <Button variant="primary" size="sm" onClick={() => accept.mutate(s)} disabled={accept.isPending}>
              Accept and save to result
            </Button>
            <Button size="sm" variant="ghost" onClick={() => suggest.reset()}>
              Dismiss
            </Button>
          </div>
          {accept.isError && <Alert>{errorMessage(accept.error)}</Alert>}
        </div>
      )}
    </section>
  );
}

function ItemPanel({ item, closed, projectId }: { item: RunItem; closed: boolean; projectId: number }) {
  const invalidate = useInvalidateRun(item.runId);
  const [status, setStatus] = useState<ResultStatus>(item.status);
  const [comment, setComment] = useState(item.comment);
  const [seconds, setSeconds] = useState(item.durationMs === null ? "" : String(item.durationMs / 1000));
  const [executedBy, setExecutedBy] = useState(item.executedBy || getTesterName());
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<RunItem>(`/api/run-items/${item.id}`, {
        status,
        comment,
        executedBy,
        durationMs: seconds.trim() === "" ? null : Math.round(Number(seconds) * 1000),
      }),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      return api.upload<Attachment[]>(`/api/run-items/${item.id}/attachments`, form);
    },
    onSuccess: async () => {
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      await invalidate();
    },
  });

  const removeFile = useMutation({
    mutationFn: (id: number) => api.delete(`/api/attachments/${id}`),
    onSuccess: invalidate,
  });

  const dirty =
    status !== item.status ||
    comment !== item.comment ||
    executedBy !== item.executedBy ||
    seconds !== (item.durationMs === null ? "" : String(item.durationMs / 1000));

  return (
    <Card
      className="item-panel"
      data-testid="item-panel"
      title={
        <>
          <span className="mono">{item.caseKey}</span> {item.caseTitle}
        </>
      }
      actions={<Link to={`/p/${projectId}/cases/${item.caseId}`}>Open case</Link>}
    >
      <p className="hint">
        {item.platform} · {item.type} · {item.priority}
        {item.automationRef && (
          <>
            {" · "}
            <code>{item.automationRef}</code>
          </>
        )}
      </p>

      <fieldset className="status-picker" disabled={closed}>
        <legend>Result</legend>
        {RESULT_STATUSES.map((s) => (
          <label key={s} className={`status-option status-${s}${status === s ? " selected" : ""}`}>
            <input
              type="radio"
              name={`status-${item.id}`}
              value={s}
              checked={status === s}
              onChange={() => setStatus(s)}
            />
            {STATUS_LABELS[s]}
          </label>
        ))}
      </fieldset>

      <div className="form-grid two">
        <Field label="Executed by">
          {(id) => (
            <input id={id} value={executedBy} disabled={closed} onChange={(e) => setExecutedBy(e.target.value)} />
          )}
        </Field>
        <Field label="Duration (seconds)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              step="0.1"
              value={seconds}
              disabled={closed}
              onChange={(e) => setSeconds(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Comment">
        {(id) => (
          <textarea id={id} rows={3} value={comment} disabled={closed} onChange={(e) => setComment(e.target.value)} />
        )}
      </Field>
      {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
      {!closed && (
        <div className="row">
          <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            Save result
          </Button>
          {item.executedAt && <span className="hint">Last executed {formatDate(item.executedAt, true)}</span>}
        </div>
      )}

      {(item.failureMessage || item.failureDetails) && (
        <section aria-label="Failure output">
          <h3>Failure output</h3>
          {item.failureMessage && <pre className="log error">{item.failureMessage}</pre>}
          {item.failureDetails && (
            <details>
              <summary>Details, stack trace and logs</summary>
              <pre className="log">{item.failureDetails}</pre>
            </details>
          )}
        </section>
      )}

      <TriagePanel item={item} closed={closed} />

      <section aria-label="Evidence">
        <h3>Evidence ({item.attachments.length})</h3>
        {item.attachments.length === 0 && <p className="hint">No evidence attached.</p>}
        <ul className="evidence-list">
          {item.attachments.map((a) => (
            <EvidenceItem key={a.id} attachment={a} onDelete={closed ? undefined : () => removeFile.mutate(a.id)} />
          ))}
        </ul>
        {!closed && (
          <div className="upload">
            <label htmlFor={`evidence-${item.id}`}>Attach screenshots, video, logs, HAR or any file</label>
            <input
              id={`evidence-${item.id}`}
              ref={fileInput}
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <Button size="sm" onClick={() => upload.mutate()} disabled={files.length === 0 || upload.isPending}>
              {upload.isPending ? "Uploading…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}
        {upload.isError && <Alert>{errorMessage(upload.error)}</Alert>}
        {removeFile.isError && <Alert>{errorMessage(removeFile.error)}</Alert>}
      </section>
    </Card>
  );
}

function SummaryPanel({ run }: { run: RunDetail }) {
  const invalidate = useInvalidateRun(run.id);
  const summary = useMutation({ mutationFn: () => api.post<RunSummaryResponse>(`/api/runs/${run.id}/summary`) });
  const saveNotes = useMutation({
    mutationFn: (text: string) =>
      api.patch<Run>(`/api/runs/${run.id}`, { notes: run.notes ? `${run.notes}\n\n${text}` : text }),
    onSuccess: async () => {
      summary.reset();
      await invalidate();
    },
  });
  const s = summary.data?.summary;
  const asText = s
    ? [
        `Release readiness (AI-suggested, reviewed by ${getTesterName() || "a tester"}): ${VERDICT[s.verdict]!.label}`,
        s.headline,
        ...s.highlights.map((h) => `- ${h}`),
        ...s.risks.map((r) => `- Risk: ${r}`),
        s.recommendation,
      ].join("\n")
    : "";

  return (
    <Card
      title="Release-readiness summary"
      actions={
        <Button size="sm" onClick={() => summary.mutate()} disabled={summary.isPending}>
          {summary.isPending ? "Thinking…" : "✦ Summarise run"}
        </Button>
      }
    >
      {run.notes ? (
        <pre className="notes">{run.notes}</pre>
      ) : (
        !s && <p className="hint">Generate a draft summary for the release meeting, then edit and save it as notes.</p>
      )}
      {summary.isError && <Alert>{errorMessage(summary.error)}</Alert>}
      {s && summary.data && (
        <div className="ai-card" data-testid="run-summary">
          <AiLabel {...summary.data.meta} />
          <p>
            <Badge tone={VERDICT[s.verdict]!.tone}>{VERDICT[s.verdict]!.label}</Badge> <strong>{s.headline}</strong>
          </p>
          <ul>
            {s.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          {s.risks.length > 0 && (
            <>
              <h4>Risks</h4>
              <ul>
                {s.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <p>{s.recommendation}</p>
          <div className="row">
            <Button size="sm" variant="primary" onClick={() => saveNotes.mutate(asText)} disabled={saveNotes.isPending}>
              Save to run notes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(asText)}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => summary.reset()}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function RunDetailPage() {
  const projectId = useProjectId();
  const runId = Number(useParams().runId);
  const run = useRun(runId);
  const invalidate = useInvalidateRun(runId);
  const [params, setParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<ResultStatus | "">("");

  const setStatus = useMutation({
    mutationFn: (action: "close" | "reopen") => api.post<Run>(`/api/runs/${runId}/${action}`),
    onSuccess: invalidate,
  });

  if (run.isPending) return <Loading />;
  if (run.isError) return <Alert>{errorMessage(run.error)}</Alert>;
  const r = run.data;
  const closed = r.status === "closed";
  const selectedId = Number(params.get("item")) || null;
  const selected = r.items.find((i) => i.id === selectedId) ?? null;
  const visible = statusFilter ? r.items.filter((i) => i.status === statusFilter) : r.items;
  const select = (id: number) => {
    const next = new URLSearchParams(params);
    next.set("item", String(id));
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={r.name}
        subtitle={
          <>
            {r.environment || "no environment"} · build <span className="mono">{r.build || "–"}</span> · created{" "}
            {formatDate(r.createdAt, true)} · <Badge tone={closed ? "muted" : "success"}>{r.status}</Badge>
          </>
        }
        actions={
          <>
            <a className="btn btn-ghost" href={`/api/runs/${r.id}/report?format=md&download=1`}>
              Markdown
            </a>
            <a className="btn btn-ghost" href={`/api/runs/${r.id}/report?format=html`} target="_blank" rel="noreferrer">
              HTML
            </a>
            <a className="btn btn-ghost" href={`/api/runs/${r.id}/report?format=csv`}>
              CSV
            </a>
            <Button onClick={() => setStatus.mutate(closed ? "reopen" : "close")} disabled={setStatus.isPending}>
              {closed ? "Reopen run" : "Close run"}
            </Button>
          </>
        }
      />
      {setStatus.isError && <Alert>{errorMessage(setStatus.error)}</Alert>}
      {closed && <Alert tone="info">This run is closed. Reopen it to change results or evidence.</Alert>}

      <div className="run-summary-row">
        <Card className="run-progress">
          <div className="run-figures">
            <div>
              <span className="stat-label">Progress</span>
              <span className="stat-value" data-testid="run-progress">
                {formatPercent(r.progress)}
              </span>
              <span className="stat-hint">
                {r.counts.total - r.counts.untested}/{r.counts.total} executed
              </span>
            </div>
            <div>
              <span className="stat-label">Pass rate</span>
              <span className="stat-value" data-testid="run-pass-rate">
                {formatPercent(r.passRate, 1)}
              </span>
              <span className="stat-hint">of executed (skipped excluded)</span>
            </div>
          </div>
          <ResultBar counts={r.counts} height={14} />
          <div className="legend">
            {RESULT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`legend-item${statusFilter === s ? " active" : ""}`}
                aria-pressed={statusFilter === s}
                onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              >
                <span className={`swatch seg-${s}`} aria-hidden="true" /> {STATUS_LABELS[s]} {r.counts[s]}
              </button>
            ))}
          </div>
        </Card>
        <SummaryPanel run={r} />
      </div>

      <div className="run-layout">
        <div className="table-wrap">
          {visible.length === 0 ? (
            <Empty>No items with this status.</Empty>
          ) : (
            <table className="table" data-testid="run-items">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Case</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="num">
                    Time
                  </th>
                  <th scope="col" className="num" aria-label="Evidence files">
                    📎
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr
                    key={i.id}
                    className={`clickable${selected?.id === i.id ? " selected" : ""}`}
                    onClick={() => select(i.id)}
                  >
                    <td className="mono">{i.caseKey}</td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => select(i.id)}
                        aria-current={selected?.id === i.id}
                      >
                        {i.caseTitle}
                      </button>
                      {i.triage && (
                        <>
                          {" "}
                          <Badge tone="ai">{TRIAGE_LABELS[i.triage.category]}</Badge>
                        </>
                      )}
                    </td>
                    <td>{i.platform}</td>
                    <td>
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="num">{formatDuration(i.durationMs)}</td>
                    <td className="num">{i.attachments.length || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          {selected ? (
            <ItemPanel key={selected.id} item={selected} closed={closed} projectId={projectId} />
          ) : (
            <Card>
              <Empty>Select a case to record its result and attach evidence.</Empty>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
