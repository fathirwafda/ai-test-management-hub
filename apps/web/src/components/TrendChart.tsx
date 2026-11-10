import type { TrendPoint } from "@hub/shared";
import { Link } from "react-router";
import { formatDate, formatPercent } from "../lib/format";

const W = 560;
const H = 200;
const PAD = { top: 28, right: 24, bottom: 36, left: 44 };

/** Pass-rate line over the most recent runs (oldest left). A table carries the same data for screen readers. */
export function TrendChart({ points, projectId }: { points: TrendPoint[]; projectId: number }) {
  const plotted = points.filter((p) => p.passRate !== null);
  if (plotted.length === 0) return <p className="empty">Execute a run to see the pass-rate trend.</p>;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (rate: number) => PAD.top + (1 - rate) * innerH;
  const coords = points
    .map((p, i) => (p.passRate === null ? null : { x: x(i), y: y(p.passRate), p }))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="trend-title" preserveAspectRatio="xMidYMid meet">
        <title id="trend-title">Pass rate of the last {points.length} runs</title>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {t * 100}%
            </text>
          </g>
        ))}
        <path d={path} className="line" />
        {coords.map((c) => (
          <g key={c.p.runId}>
            <circle cx={c.x} cy={c.y} r={4.5} className="dot">
              <title>
                {c.p.name}: {formatPercent(c.p.passRate, 1)}
              </title>
            </circle>
            <text x={c.x} y={c.y - 10} textAnchor="middle" className="value">
              {formatPercent(c.p.passRate)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.runId} x={x(i)} y={H - 12} textAnchor="middle" className="axis">
            {formatDate(p.createdAt)}
          </text>
        ))}
      </svg>
      <table className="sr-only">
        <caption>Pass rate per run</caption>
        <thead>
          <tr>
            <th>Run</th>
            <th>Pass rate</th>
            <th>Executed</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.runId}>
              <td>
                <Link to={`/p/${projectId}/runs/${p.runId}`}>{p.name}</Link>
              </td>
              <td>{formatPercent(p.passRate, 1)}</td>
              <td>
                {p.executed}/{p.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
