import {
  CASE_TYPES,
  PLATFORMS,
  PRIORITIES,
  type GenerateCasesResponse,
  type GeneratedCase,
  type Platform,
  type TestCase,
  type TestStep,
} from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useAiStatus, useSuites } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { AiLabel, Alert, Button, Card, Field, PageHeader } from "../components/ui";

const EXAMPLE = `As a shopper, I want to apply a discount code at checkout so that I pay less for my order.

Acceptance criteria:
- A valid code reduces the order total by the advertised amount
- When the code is expired, an inline error "This code has expired" is shown and the total does not change
- Only one code can be applied per order
- The discount line should look consistent with the order summary design`;

interface Draft extends GeneratedCase {
  include: boolean;
  stepsText: string;
}

const toText = (steps: GeneratedCase["steps"]) => steps.map((s) => `${s.keyword} ${s.text}`).join("\n");

/** Given/When lines become actions; each Then line becomes the expected result of the step before it. */
export function gwtToSteps(text: string): TestStep[] {
  const steps: TestStep[] = [];
  for (const raw of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^then\b/i.test(raw) && steps.length > 0 && !steps.at(-1)!.expected) {
      steps.at(-1)!.expected = raw;
    } else if (/^and\b/i.test(raw) && steps.length > 0 && steps.at(-1)!.expected) {
      steps.at(-1)!.expected += `\n${raw}`;
    } else {
      steps.push({ action: raw, expected: "" });
    }
  }
  return steps;
}

export function AiGeneratePage() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const status = useAiStatus();
  const suites = useSuites(projectId);
  const [story, setStory] = useState("");
  const [platformHint, setPlatformHint] = useState("");
  const [model, setModel] = useState("");
  const [maxCases, setMaxCases] = useState(8);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [suiteId, setSuiteId] = useState("");
  const [meta, setMeta] = useState<GenerateCasesResponse["meta"] | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      api.post<GenerateCasesResponse>("/api/ai/generate-cases", {
        story,
        maxCases,
        ...(platformHint ? { platformHint } : {}),
        ...(model ? { model } : {}),
      }),
    onSuccess: (res) => {
      save.reset();
      setMeta(res.meta);
      setDrafts(res.cases.map((c) => ({ ...c, include: true, stepsText: toText(c.steps) })));
    },
  });

  const selected = drafts.filter((d) => d.include);
  const save = useMutation({
    mutationFn: () =>
      api.post<TestCase[]>(`/api/projects/${projectId}/cases/bulk`, {
        cases: selected.map((d) => ({
          title: d.title,
          platform: d.platform,
          priority: d.priority,
          type: d.suggestedType,
          tags: d.tags.filter((t) => /^[a-z0-9][a-z0-9._-]*$/.test(t)),
          steps: gwtToSteps(d.stepsText),
          requirement: story.slice(0, 5000),
          description: `Drafted with AI assistance and reviewed before saving. ${d.rationale}`.slice(0, 5000),
          suiteId: suiteId ? Number(suiteId) : null,
          status: "draft",
          source: "ai",
        })),
      }),
    onSuccess: async () => {
      setDrafts([]);
      await qc.invalidateQueries({ queryKey: ["projects", projectId] });
      await qc.invalidateQueries({ queryKey: keys.dashboard(projectId) });
    },
  });

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    generate.mutate();
  };

  return (
    <>
      <PageHeader
        title="AI test design"
        subtitle="Paste a user story or acceptance criteria. The AI drafts cases; you review, edit and choose what to save."
      />
      <Alert tone="info">
        Suggestions are not saved until you click <strong>Save</strong>. They are a starting point: check every step
        against the real requirement. Provider:{" "}
        <strong>
          {status.data
            ? `${status.data.provider === "mock" ? "offline mock (rule-based)" : "Claude"} · ${status.data.model}`
            : "…"}
        </strong>
      </Alert>

      <form className="card form" onSubmit={submit} aria-label="Generate test cases">
        <Field label="User story / acceptance criteria">
          {(id) => (
            <textarea
              id={id}
              rows={8}
              value={story}
              placeholder="As a … I want … so that …&#10;- criterion 1&#10;- criterion 2"
              onChange={(e) => setStory(e.target.value)}
            />
          )}
        </Field>
        <div className="form-grid">
          <Field label="Default platform">
            {(id) => (
              <select id={id} value={platformHint} onChange={(e) => setPlatformHint(e.target.value)}>
                <option value="">Infer from the story</option>
                {PLATFORMS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Max cases">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={15}
                value={maxCases}
                onChange={(e) => setMaxCases(Number(e.target.value) || 1)}
              />
            )}
          </Field>
          {status.data?.provider === "anthropic" && (
            <Field label="Model">
              {(id) => (
                <select id={id} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Server default ({status.data?.model})</option>
                  {status.data?.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
        {generate.isError && <Alert>{errorMessage(generate.error)}</Alert>}
        <div className="row">
          <Button type="submit" variant="primary" disabled={story.trim().length < 20 || generate.isPending}>
            {generate.isPending ? "Generating…" : "✦ Generate test cases"}
          </Button>
          <Button variant="ghost" onClick={() => setStory(EXAMPLE)}>
            Use example story
          </Button>
        </div>
      </form>

      {save.isSuccess && (
        <Alert tone="success">
          Saved {save.data.length} draft case(s): {save.data.map((c) => c.key).join(", ")}.{" "}
          <Link to={`/p/${projectId}/cases?status=draft`}>Review them in Test cases</Link>.
        </Alert>
      )}

      {drafts.length > 0 && meta && (
        <Card
          title={`Review ${drafts.length} suggested case${drafts.length === 1 ? "" : "s"}`}
          actions={<AiLabel {...meta} />}
          data-testid="ai-suggestions"
        >
          <ol className="draft-list">
            {drafts.map((d, i) => (
              <li key={i} className={`draft${d.include ? "" : " excluded"}`} data-testid="ai-draft">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.include}
                    onChange={(e) => update(i, { include: e.target.checked })}
                  />
                  Include
                </label>
                <div className="draft-body">
                  <Field label={`Title ${i + 1}`}>
                    {(id) => <input id={id} value={d.title} onChange={(e) => update(i, { title: e.target.value })} />}
                  </Field>
                  <div className="form-grid">
                    <Field label="Platform">
                      {(id) => (
                        <select
                          id={id}
                          value={d.platform}
                          onChange={(e) => update(i, { platform: e.target.value as Platform })}
                        >
                          {PLATFORMS.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Priority">
                      {(id) => (
                        <select
                          id={id}
                          value={d.priority}
                          onChange={(e) => update(i, { priority: e.target.value as Draft["priority"] })}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Type (suggested)">
                      {(id) => (
                        <select
                          id={id}
                          value={d.suggestedType}
                          onChange={(e) => update(i, { suggestedType: e.target.value as Draft["suggestedType"] })}
                        >
                          {CASE_TYPES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                  <Field label="Steps (Given / When / Then)">
                    {(id) => (
                      <textarea
                        id={id}
                        rows={Math.max(3, d.steps.length + 1)}
                        className="mono"
                        value={d.stepsText}
                        onChange={(e) => update(i, { stepsText: e.target.value })}
                      />
                    )}
                  </Field>
                  <p className="hint">
                    {d.rationale} {d.tags.length > 0 && <>Tags: {d.tags.join(", ")}</>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="row">
            <Field label="Save into suite" className="inline">
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
            <Button variant="primary" onClick={() => save.mutate()} disabled={selected.length === 0 || save.isPending}>
              Save {selected.length} selected as draft case{selected.length === 1 ? "" : "s"}
            </Button>
            <Button variant="ghost" onClick={() => setDrafts([])}>
              Discard all
            </Button>
          </div>
          {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
        </Card>
      )}
    </>
  );
}
