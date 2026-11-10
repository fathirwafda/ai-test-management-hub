import { Link, useNavigate } from "react-router";
import { useRuns } from "../api/hooks";
import { useProjectId } from "../components/Layout";
import { Alert, Badge, Empty, Loading, PageHeader, ResultBar } from "../components/ui";
import { formatDate, formatPercent } from "../lib/format";

export function RunsPage() {
  const projectId = useProjectId();
  const runs = useRuns(projectId);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Test runs"
        subtitle="Executions of a selection of cases against an environment and build."
        actions={
          <>
            <Link to={`/p/${projectId}/import`} className="btn btn-secondary">
              Import results
            </Link>
            <Link to={`/p/${projectId}/runs/new`} className="btn btn-primary">
              New run
            </Link>
          </>
        }
      />
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <Alert>Could not load runs.</Alert>
      ) : runs.data.length === 0 ? (
        <Empty>No runs yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="runs-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Environment / build</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ width: "22%" }}>
                  Progress
                </th>
                <th scope="col" className="num">
                  Pass rate
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => void navigate(`/p/${projectId}/runs/${r.id}`)}>
                  <td>
                    <Link to={`/p/${projectId}/runs/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      {r.name}
                    </Link>
                    {r.source === "import" && (
                      <>
                        {" "}
                        <Badge tone="info">imported</Badge>
                      </>
                    )}
                  </td>
                  <td>
                    {r.environment || "–"} · <span className="mono">{r.build || "–"}</span>
                  </td>
                  <td>{formatDate(r.createdAt, true)}</td>
                  <td>
                    <Badge tone={r.status === "open" ? "success" : "muted"}>{r.status}</Badge>
                  </td>
                  <td>
                    <ResultBar counts={r.counts} />
                    <span className="hint">
                      {r.counts.total - r.counts.untested}/{r.counts.total} executed
                    </span>
                  </td>
                  <td className="num strong">{formatPercent(r.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
