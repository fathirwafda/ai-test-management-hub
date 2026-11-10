import type { TestStep } from "@hub/shared";
import { Button } from "./ui";

/** Editable list of steps (action + expected result). */
export function StepsEditor({ steps, onChange }: { steps: TestStep[]; onChange: (steps: TestStep[]) => void }) {
  const update = (i: number, patch: Partial<TestStep>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    onChange(next);
  };

  return (
    <fieldset className="steps">
      <legend>Steps</legend>
      {steps.length === 0 && <p className="hint">No steps yet.</p>}
      <ol>
        {steps.map((s, i) => (
          <li key={i} className="step">
            <div className="step-fields">
              <label>
                <span className="sr-only">Step {i + 1} action</span>
                <textarea
                  rows={2}
                  placeholder="Action"
                  value={s.action}
                  onChange={(e) => update(i, { action: e.target.value })}
                />
              </label>
              <label>
                <span className="sr-only">Step {i + 1} expected result</span>
                <textarea
                  rows={2}
                  placeholder="Expected result"
                  value={s.expected}
                  onChange={(e) => update(i, { expected: e.target.value })}
                />
              </label>
            </div>
            <div className="step-actions">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move step ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move step ${i + 1} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove step ${i + 1}`}
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button size="sm" onClick={() => onChange([...steps, { action: "", expected: "" }])}>
        + Add step
      </Button>
    </fieldset>
  );
}
