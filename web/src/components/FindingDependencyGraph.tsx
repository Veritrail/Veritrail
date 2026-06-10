function shortLabel(value: string, max = 22) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

type GraphNode = { id: string; label: string; x: number; y: number; tone: "source" | "center" | "target" };

export function FindingDependencyGraph({
  resourceLabel,
  trustPrincipals = [],
  services = [],
}: {
  resourceLabel: string;
  trustPrincipals?: string[];
  services?: string[];
}) {
  const principals = trustPrincipals.slice(0, 4);
  const targets = services.slice(0, 5);
  const width = 520;
  const height = Math.max(168, 44 + Math.max(principals.length, targets.length, 1) * 34);
  const centerX = width / 2;
  const centerY = height / 2;

  const nodes: GraphNode[] = [
    {
      id: "resource",
      label: shortLabel(resourceLabel, 28),
      x: centerX,
      y: centerY,
      tone: "center",
    },
  ];

  principals.forEach((principal, index) => {
    const y = principals.length === 1 ? centerY : 28 + index * ((height - 56) / Math.max(principals.length - 1, 1));
    nodes.push({
      id: `principal-${index}`,
      label: shortLabel(principal.split("/").pop() ?? principal, 20),
      x: 92,
      y,
      tone: "source",
    });
  });

  targets.forEach((service, index) => {
    const y = targets.length === 1 ? centerY : 28 + index * ((height - 56) / Math.max(targets.length - 1, 1));
    nodes.push({
      id: `service-${index}`,
      label: shortLabel(service, 18),
      x: width - 92,
      y,
      tone: "target",
    });
  });

  const center = nodes.find((n) => n.tone === "center")!;
  const edges = nodes
    .filter((n) => n.tone !== "center")
    .map((n) => ({ from: n.tone === "source" ? n : center, to: n.tone === "source" ? center : n }));

  if (principals.length === 0 && targets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-meta text-zinc-500">
        No trust or service links to graph for this resource yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/80 to-white p-3">
      <p className="mb-2 px-1 text-meta font-medium text-zinc-500">Dependency map</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[20rem]" role="img" aria-label="Resource dependency graph">
        {edges.map((edge, i) => (
          <line
            key={i}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            stroke="rgb(212 212 216 / 0.9)"
            strokeWidth={1.5}
          />
        ))}
        {nodes.map((node) => {
          const fill =
            node.tone === "center"
              ? "#eef2ff"
              : node.tone === "source"
                ? "#f4f4f5"
                : "#eff6ff";
          const stroke =
            node.tone === "center" ? "#a5b4fc" : node.tone === "source" ? "#d4d4d8" : "#bfdbfe";
          const textClass = node.tone === "center" ? "fill-indigo-950" : "fill-zinc-700";
          const w = node.tone === "center" ? 148 : 124;
          const h = 28;
          return (
            <g key={node.id}>
              <rect
                x={node.x - w / 2}
                y={node.y - h / 2}
                width={w}
                height={h}
                rx={8}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
              />
              <text
                x={node.x}
                y={node.y + 4}
                textAnchor="middle"
                className={textClass}
                style={{ fontSize: 11, fontWeight: 600 }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 px-1 text-[11px] text-zinc-400">
        {principals.length > 0 ? "Trusted by → resource" : null}
        {principals.length > 0 && targets.length > 0 ? " · " : null}
        {targets.length > 0 ? "resource → services used" : null}
      </p>
    </div>
  );
}
