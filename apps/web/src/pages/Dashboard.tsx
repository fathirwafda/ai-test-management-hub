import { CASE_STATUSES, CASE_TYPES } from "@hub/shared";
import { Link } from "react-router";
import { useDashboard } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { TrendChart } from "../components/TrendChart";
import { Alert, Badge, Card, Empty, Loading, Meter, PageHeader, ResultBar } from "../components/ui";
import { formatPercent } from "../lib/format";

function Stat({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="stat stat-link">
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function DashboardPage() {
  const projectId = useProjectId();
  const { data, isPending, isError } = useDashboard(projectId);
  if (isPending) return <Loading />;
  if (isError) return <Alert>Could not load the dashboard.</Alert>;
  const { totals, latestRun } = data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Coverage, results and stability across this project's runs." />
      <div className="stats" data-testid="dashboard-stats">
        <Stat label="Active cases" value={String(totals.activeCases)} hint={`${totals.cases} in total`} />
        <Stat
          label="Automation coverage"
          value={formatPercent(data.overallAutomationRate)}
          hint={`${totals.byType.automated} automated · ${totals.byType.manual} manual`}
        />
        <Stat
          label="Latest pass rate"
          value={formatPercent(latestRun?.passRate ?? null)}
          hint={latestRun?.name ?? "no runs yet"}
          {...(latestRun ? { to: `/p/${projectId}/runs/${latestRun.id}` } : {})}
        />
        <Stat label="Test runs" value={String(totals.runs)} to={`/p/${projectId}/runs`} />
        <Stat
          label="Needs review"
          value={String(totals.needsReview)}
          hint="auto-created by import"
          to={`/p/${projectId}/cases?needsReview=true`}
        />
      </div>

      <div className="grid-2">
        <Card title="Pass-rate trend" className="span-2-md">
          <TrendChart points={data.trend} projectId={projectId} />
          <p className="hint">
            Pass rate = passed / (passed + failed + blocked + retest). Skipped and untested are excluded.
          </p>
        </Card>

        <Card title="Automation coverage by platform">
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col" className="num">
                  Automated
                </th>
                <th scope="col" className="num">
                  Manual
                </th>
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.coverage.map((row) => (
                <tr key={row.platform}>
                  <th scope="row">{row.platform}</th>
                  <td className="num">{row.automated}</td>
                  <td className="num">{row.manual}</td>
                  <td>
                    <div className="meter-row">
                      <Meter value={row.automationRate} label={`${row.platform} automation coverage`} />
                      <span>{formatPercent(row.automationRate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Active cases only (deprecated excluded).</p>
        </Card>

        <Card title="Flaky candidates">
          {data.flaky.length === 0 ? (
            <Empty>No case flipped between passed and failed twice or more in recent runs.</Empty>
          ) : (
            <ul className="flaky-list">
              {data.flaky.map((f) => (
                <li key={f.caseId}>
                  <Link to={`/p/${projectId}/cases/${f.caseId}`}>
                    <strong>{f.key}</strong> {f.title}
                  </Link>
                  <div className="history" aria-label={`History: ${f.history.join(", ")}`}>
                    {f.history.map((h, i) => (
                      <span key={i} className={`dot dot-${h}`} title={h} />
                    ))}
                    <span className="hint">
                      {f.flips} flips · {f.platform}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">A case is listed when it flips pass↔fail at least twice in its last 10 executions.</p>
        </Card>

        <Card title="Cases by status and type">
          <dl className="kv">
            {CASE_STATUSES.map((s) => (
              <div key={s}>
                <dt>{s}</dt>
                <dd>{totals.byStatus[s]}</dd>
              </div>
            ))}
            {CASE_TYPES.map((t) => (
              <div key={t}>
                <dt>{t}</dt>
                <dd>{totals.byType[t]}</dd>
              </div>
            ))}
          </dl>
          <div className="row wrap">
            {Object.entries(totals.byPlatform).map(([p, n]) => (
              <Badge key={p}>
                {p}: {n}
              </Badge>
            ))}
          </div>
        </Card>

        <Card
          title="Latest run"
          actions={latestRun && <Link to={`/p/${projectId}/runs/${latestRun.id}`}>Open run</Link>}
        >
          {latestRun ? (
            <>
              <p className="run-name">{latestRun.name}</p>
              <ResultBar counts={latestRun.counts} height={14} />
              <p className="hint">
                {latestRun.counts.passed} passed · {latestRun.counts.failed} failed · {latestRun.counts.blocked} blocked
                · {latestRun.counts.untested} untested
              </p>
            </>
          ) : (
            <Empty>
              No runs yet. <Link to={`/p/${projectId}/runs/new`}>Start one</Link> or{" "}
              <Link to={`/p/${projectId}/import`}>import results</Link>.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
