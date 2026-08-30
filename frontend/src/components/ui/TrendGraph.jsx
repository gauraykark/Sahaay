// 30-day trend graph — hand-rolled inline SVG.
//
// No chart library on purpose. This is a PWA that has to install over a weak
// connection; Recharts or Chart.js would add a few hundred KB to serve one
// line. An SVG path costs nothing and renders identically offline.
//
// Days with no sessions are still not invented — but the line is no longer
// broken into free-floating islands either, which read as a rendering fault
// rather than as missing data. Measured days are joined by a solid line;
// spans crossing days with no session are joined by a DASHED line. The shape
// of the trend stays readable, and the dash says plainly that nothing was
// measured in between.

const WIDTH = 720;
const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 30 };

/** The measured days only, each carrying its index in the full series. */
function measuredPoints(points) {
  return points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.score !== null && point.score !== undefined);
}

/**
 * One link per adjacent pair of measured days. `gap` is true when the two
 * days are not consecutive, i.e. the line is spanning unmeasured time.
 */
function buildLinks(measured) {
  const links = [];
  for (let i = 1; i < measured.length; i += 1) {
    const from = measured[i - 1];
    const to = measured[i];
    links.push({ from, to, gap: to.index - from.index > 1 });
  }
  return links;
}

export default function TrendGraph({ data = [] }) {
  if (!data.length) {
    return (
      <p className="text-sm text-neutral-400 py-8 text-center">
        No sessions in the last 30 days.
      </p>
    );
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index) => PAD.left + (index / Math.max(1, data.length - 1)) * plotWidth;
  const y = (score) => PAD.top + (1 - score / 100) * plotHeight;

  const measured = measuredPoints(data);
  const links = buildLinks(measured);
  const last = measured[measured.length - 1];

  // One area under the whole measured run, so the fill doesn't fragment.
  const areaPath = measured.length
    ? `M ${x(measured[0].index)} ${y(measured[0].score)} ` +
      measured
        .slice(1)
        .map((p) => `L ${x(p.index)} ${y(p.score)}`)
        .join(" ") +
      ` L ${x(measured[measured.length - 1].index)} ${y(0)}` +
      ` L ${x(measured[0].index)} ${y(0)} Z`
    : null;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full min-w-[520px] h-auto"
        role="img"
        aria-label={`Performance over the last 30 days. Latest ${last?.score ?? "no"} percent.`}
      >
        {/* Horizontal guides at 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e7e5e4"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#a8a29e"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* One continuous area under the measured run */}
        {areaPath && <path d={areaPath} fill="#247a72" fillOpacity="0.07" />}

        {/* Solid between consecutive days, dashed across unmeasured spans */}
        {links.map((link) => (
          <line
            key={`${link.from.index}-${link.to.index}`}
            x1={x(link.from.index)}
            y1={y(link.from.score)}
            x2={x(link.to.index)}
            y2={y(link.to.score)}
            stroke="#247a72"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={link.gap ? "4 4" : undefined}
            strokeOpacity={link.gap ? 0.55 : 1}
          />
        ))}

        {/* Every measured day gets a dot, so single days are never invisible */}
        {measured.map((point) => (
          <circle
            key={point.index}
            cx={x(point.index)}
            cy={y(point.score)}
            r="2.5"
            fill="#247a72"
          />
        ))}

        {/* Emphasise where the patient is now */}
        {last ? (
          <circle
            cx={x(last.index)}
            cy={y(last.score)}
            r="4"
            fill="#247a72"
            stroke="#ffffff"
            strokeWidth="2"
          />
        ) : null}

        {/* Only the ends get date labels — 30 ticks would be unreadable */}
        <text x={PAD.left} y={HEIGHT - 4} fontSize="11" fill="#a8a29e">
          {data[0]?.date?.slice(5)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 4}
          fontSize="11"
          fill="#a8a29e"
          textAnchor="end"
        >
          {data[data.length - 1]?.date?.slice(5)}
        </text>
      </svg>
    </div>
  );
}
