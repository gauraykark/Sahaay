// 30-day trend graph — hand-rolled inline SVG.
//
// No chart library on purpose. This is a PWA that has to install over a weak
// connection; Recharts or Chart.js would add a few hundred KB to serve one
// line. An SVG path costs nothing and renders identically offline.
//
// Days with no sessions stay null and BREAK the line rather than interpolating
// across the gap. On a clinical screen a continuous line implies continuous
// data, and inventing that would be a small lie in the one place it matters.

const WIDTH = 720;
const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 30 };

function buildSegments(points) {
  // Split into runs of consecutive non-null days.
  const segments = [];
  let current = [];

  points.forEach((point, index) => {
    if (point.score === null || point.score === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ ...point, index });
    }
  });
  if (current.length) segments.push(current);

  return segments;
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

  const segments = buildSegments(data);
  const withData = data.filter((d) => d.score !== null);
  const last = withData[withData.length - 1];

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

        {/* Area fill under each run, then the line on top */}
        {segments.map((segment, index) => {
          if (segment.length < 2) return null;
          const line = segment
            .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.index)} ${y(p.score)}`)
            .join(" ");
          const area =
            `${line} L ${x(segment[segment.length - 1].index)} ${y(0)} ` +
            `L ${x(segment[0].index)} ${y(0)} Z`;

          return (
            <g key={index}>
              <path d={area} fill="#247a72" fillOpacity="0.07" />
              <path
                d={line}
                fill="none"
                stroke="#247a72"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Single-day runs would otherwise be invisible */}
        {segments
          .filter((segment) => segment.length === 1)
          .map((segment) => (
            <circle
              key={segment[0].index}
              cx={x(segment[0].index)}
              cy={y(segment[0].score)}
              r="3"
              fill="#247a72"
            />
          ))}

        {/* Emphasise where the patient is now */}
        {last ? (
          <circle
            cx={x(data.indexOf(last))}
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
