const W = 240;
const H = 44;
const PAD = 3;

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-11" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-11 text-neutral-400 dark:text-neutral-500"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={`${points} ${lastX},${H} 0,${H}`}
        fill="currentColor"
        opacity="0.08"
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill="currentColor" />
    </svg>
  );
}
