import { RESULT_STATUSES, type ResultStatus, type RunCounts } from "@hub/shared";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return <button type={type} className={`btn btn-${variant}${size ? ` btn-${size}` : ""} ${className}`} {...props} />;
}

export function Card({
  title,
  actions,
  children,
  className = "",
  ...rest
}: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string } & Record<
  `data-${string}`,
  string
>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const STATUS_LABELS: Record<ResultStatus, string> = {
  untested: "Untested",
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked",
  skipped: "Skipped",
  retest: "Retest",
};

export function StatusBadge({ status }: { status: ResultStatus }) {
  return (
    <span className={`status status-${status}`} data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Stacked bar of result statuses, with a text equivalent for screen readers. */
export function ResultBar({ counts, height = 10 }: { counts: RunCounts; height?: number }) {
  const label = RESULT_STATUSES.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  return (
    <div className="result-bar" style={{ height }} role="img" aria-label={label || "no cases"}>
      {RESULT_STATUSES.filter((s) => counts[s] > 0).map((s) => (
        <span
          key={s}
          className={`seg seg-${s}`}
          style={{ flexGrow: counts[s] }}
          title={`${STATUS_LABELS[s]}: ${counts[s]}`}
        />
      ))}
    </div>
  );
}

export function Meter({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}…
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Label used on every AI output so nobody mistakes a suggestion for a verified result. */
export function AiLabel({ provider, model, repaired }: { provider: string; model: string; repaired?: boolean }) {
  return (
    <span className="ai-label">
      <span aria-hidden="true">✦</span> AI suggestion · {provider === "mock" ? "offline mock" : "Claude"} ({model})
      {repaired ? " · repaired once" : ""}
    </span>
  );
}
