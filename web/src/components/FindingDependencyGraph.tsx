import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { formatIamServiceDisplayName } from "../lib/findingDisplay";
import "../styles/dependency-graph.css";

type GraphNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  tone: "source" | "center" | "target";
};

const PILL_H = 28;
const PILL_W_SIDE = 108;
const PILL_W_CENTER = 148;
const MIN_NODE_GAP = 20;
const ROW_GAP = PILL_H + MIN_NODE_GAP;
const COL_GAP = PILL_W_SIDE + MIN_NODE_GAP;
const SIDE_OFFSET = 188;
const ROWS_PER_COL = 8;
const CANVAS_PAD = 88;

function pillTextColor(tone: GraphNode["tone"]) {
  return tone === "center" ? "#1e1b4b" : "#3f3f46";
}

function pillWidth(tone: GraphNode["tone"]) {
  return tone === "center" ? PILL_W_CENTER : PILL_W_SIDE;
}

type SideLayout = {
  nodes: GraphNode[];
  extentX: number;
  extentY: number;
};

/** Spoke columns — fixed vertical spacing so wide pills never overlap on an arc. */
function placeInColumns(
  items: string[],
  side: "left" | "right",
  prefix: string,
  tone: "source" | "target",
  cx: number,
  cy: number,
): SideLayout {
  if (items.length === 0) return { nodes: [], extentX: 0, extentY: 0 };

  const colCount = Math.ceil(items.length / ROWS_PER_COL);
  const nodes: GraphNode[] = [];
  let extentX = SIDE_OFFSET + PILL_W_SIDE / 2;
  let extentY = PILL_H / 2;

  items.forEach((raw, index) => {
    const col = Math.floor(index / ROWS_PER_COL);
    const row = index % ROWS_PER_COL;
    const itemsInCol = Math.min(ROWS_PER_COL, items.length - col * ROWS_PER_COL);
    const colHeight = Math.max(0, (itemsInCol - 1) * ROW_GAP);
    const y = cy - colHeight / 2 + row * ROW_GAP;
    const columnOffset = SIDE_OFFSET + col * COL_GAP;
    const x = side === "left" ? cx - columnOffset : cx + columnOffset;

    extentX = Math.max(extentX, columnOffset + PILL_W_SIDE / 2);
    extentY = Math.max(extentY, Math.abs(y - cy) + PILL_H / 2);

    const label = tone === "target" ? formatIamServiceDisplayName(raw) : raw.trim();
    nodes.push({
      id: `${prefix}-${index}`,
      label,
      x,
      y,
      tone,
    });
  });

  return { nodes, extentX, extentY };
}

function buildWheelLayout(resourceLabel: string, principals: string[], services: string[]) {
  const extentX = Math.max(
    SIDE_OFFSET + Math.ceil(Math.max(principals.length, 1) / ROWS_PER_COL) * COL_GAP,
    SIDE_OFFSET + PILL_W_SIDE / 2,
  );
  const maxRows = Math.max(
    Math.min(principals.length, ROWS_PER_COL),
    Math.min(services.length, ROWS_PER_COL),
    1,
  );
  const extentY = Math.max(((maxRows - 1) * ROW_GAP) / 2 + PILL_H / 2, PILL_H / 2);

  const cx = extentX + CANVAS_PAD;
  const cy = extentY + CANVAS_PAD;

  const principalLayout = placeInColumns(principals, "left", "principal", "source", cx, cy);
  const serviceLayout = placeInColumns(services, "right", "service", "target", cx, cy);

  const nodes: GraphNode[] = [
    {
      id: "resource",
      label: resourceLabel.trim(),
      x: cx,
      y: cy,
      tone: "center",
    },
    ...principalLayout.nodes,
    ...serviceLayout.nodes,
  ];

  const layoutExtentX = Math.max(principalLayout.extentX, serviceLayout.extentX, SIDE_OFFSET);
  const layoutExtentY = Math.max(principalLayout.extentY, serviceLayout.extentY, PILL_H / 2);
  const width = cx + layoutExtentX + CANVAS_PAD;
  const height = cy + layoutExtentY + CANVAS_PAD;

  const center = nodes[0]!;
  const edges = nodes
    .filter((n) => n.tone !== "center")
    .map((n) => ({ from: n.tone === "source" ? n : center, to: n.tone === "source" ? center : n }));

  return { nodes, edges, width, height, cx, cy };
}

function GraphPill({ node }: { node: GraphNode }) {
  const fill =
    node.tone === "center" ? "#eef2ff" : node.tone === "source" ? "#f4f4f5" : "#eff6ff";
  const stroke =
    node.tone === "center" ? "#a5b4fc" : node.tone === "source" ? "#d4d4d8" : "#bfdbfe";
  const w = pillWidth(node.tone);
  const h = 28;
  const clipId = `dep-graph-clip-${node.id}`;

  return (
    <g>
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
      <clipPath id={clipId}>
        <rect x={node.x - w / 2} y={node.y - h / 2} width={w} height={h} rx={8} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <foreignObject x={node.x - w / 2} y={node.y - h / 2} width={w} height={h}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            className="flex h-full w-full min-w-0 items-center justify-center px-2"
            style={{ boxSizing: "border-box" }}
          >
            <span
              title={node.label}
              className="block min-w-0 max-w-full truncate text-center text-[11px] font-semibold leading-none"
              style={{ color: pillTextColor(node.tone) }}
            >
              {node.label}
            </span>
          </div>
        </foreignObject>
      </g>
    </g>
  );
}

export function FindingDependencyGraph({
  resourceLabel,
  trustPrincipals = [],
  services = [],
}: {
  resourceLabel: string;
  trustPrincipals?: string[];
  services?: string[];
}) {
  const principals = trustPrincipals;
  const targets = services;

  const layout = useMemo(
    () => buildWheelLayout(resourceLabel, principals, targets),
    [resourceLabel, principals, targets],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);

  const centerView = useCallback(
    (nextZoom: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      setPan({
        x: viewport.clientWidth / 2 - layout.cx * nextZoom,
        y: viewport.clientHeight / 2 - layout.cy * nextZoom,
      });
    },
    [layout.cx, layout.cy],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    centerView(1);
  }, [centerView]);

  useEffect(() => {
    resetView();
  }, [layout.width, layout.height, layout.cx, layout.cy, resetView]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    setPan({
      x: dragRef.current.panX + (event.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (event.clientY - dragRef.current.startY),
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    const nextZoom = Math.min(2.5, Math.max(0.35, zoom * delta));
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const graphX = (pointerX - pan.x) / zoom;
    const graphY = (pointerY - pan.y) / zoom;

    setZoom(nextZoom);
    setPan({
      x: pointerX - graphX * nextZoom,
      y: pointerY - graphY * nextZoom,
    });
  };

  if (principals.length === 0 && targets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-meta text-zinc-500">
        No trust or service links to graph for this resource yet.
      </div>
    );
  }

  return (
    <div className="dep-graph">
      <div className="dep-graph-header">
        <p className="dep-graph-title">Dependency map</p>
        <div className="dep-graph-meta">
          <span>
            {principals.length} trusted · {targets.length} services
          </span>
          <button type="button" className="dep-graph-reset" onClick={resetView}>
            Reset view
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`dep-graph-viewport${dragging ? " is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        role="application"
        aria-label="Draggable dependency map. Drag to pan, scroll to zoom."
      >
        <div
          className="dep-graph-canvas"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="dep-graph-svg"
            role="img"
            aria-hidden
          >
            {layout.edges.map((edge, i) => (
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
            {layout.nodes.map((node) => (
              <GraphPill key={node.id} node={node} />
            ))}
          </svg>
        </div>
      </div>

      <div className="dep-graph-footer">
        <p className="dep-graph-legend">
          {principals.length > 0 ? "Trusted by → role" : null}
          {principals.length > 0 && targets.length > 0 ? " · " : null}
          {targets.length > 0 ? "role → services used" : null}
        </p>
        <p className="dep-graph-controls">Drag to pan · Scroll to zoom</p>
      </div>
    </div>
  );
}
