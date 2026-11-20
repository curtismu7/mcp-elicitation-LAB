import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState } from "@xyflow/react";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "./diagram-kit/DiagramKit.jsx";
import { boxPassport, slotPoint } from "./diagram-kit/diagramKit.js";
import "./diagram-kit/diagram-kit.css";
import { REFIT_EVENT, useFitOnResize } from "./useFitOnResize.js";

// Who talks to whom. The nodes and edges come from diagram-studio/1 data loaded by name from the server (rule 17); nothing is drawn from hand-built
// nodes here. Boxes are draggable, and Reset puts every box back where the data says. An edge lights up when a message has crossed it;
// `shown` is how many messages of the run are revealed.
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];
const SLOTS = [["l", Position.Left], ["r", Position.Right], ["t", Position.Top], ["b", Position.Bottom]];
const FIT = { padding: 0.12 };

function Box({ data }) {
  return (
    <div className={`flow-node flow-node--${data.color}`}>
      {SLOTS.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}1`} type="source" position={pos} className="flow-handle" />
          <Handle id={`t-${k}1`} type="target" position={pos} className="flow-handle" />
        </span>
      ))}
      {data.label}
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };

// The curve only: every label is drawn by the diagram kit's EdgeLabels, in a layer above the boxes,
// placed so no two labels overlap and none sits on a box (the shared standard, UI patterns §8c).
const edgeTypes = { arrow: ArrowNoLabel };

// The sides of two boxes that face each other, so an arrow leaves toward its target.
function sides(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}

export const linkOf = (m) => (m.dir === "client→server" || m.dir === "server→client" ? "client-server" : m.dir === "person" ? "person-client" : m.dir === "browser" ? "browser-server" : m.dir === "client" && m.kind === "browser" ? "client-browser" : null);

// The graph for the diagram document, with the links the first `shown` messages crossed lit and counted.
export function buildGraph(diagram, transcript, shown) {
  const nodes = diagram.nodes.map((n) => ({ id: n.id, type: "box", position: { x: n.x, y: n.y }, data: { label: n.label, color: diagram.groups[n.group].color } }));
  const at = Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const seen = {};
  transcript.slice(0, shown).forEach((m) => { const k = linkOf(m); if (k) { seen[k] = { n: (seen[k]?.n ?? 0) + 1, last: m }; } });
  const edges = diagram.edges.map((e) => {
    const key = `${e.source}-${e.target}`;
    const s = seen[key];
    const [a, b] = sides(at[e.source], at[e.target]);
    const state = !s ? "idle" : s.last.kind === "error" ? "error" : "seen";
    return { id: key, source: e.source, target: e.target, type: "arrow", sourceHandle: `s-${a}1`, targetHandle: `t-${b}1`,
      className: `flow-edge flow-edge--${state}`, markerEnd: { type: MarkerType.ArrowClosed }, data: { text: s ? `${s.n} message${s.n > 1 ? "s" : ""}` : e.label ?? "", active: !!s && transcript[shown - 1] === s.last } };
  });
  return { nodes, edges };
}

// One label item per arrow, for the kit's EdgeLabels layer (above the boxes, never overlapping).
export function toLabelItems(edges, active) {
  return edges.map((e) => ({ id: e.id, text: e.data.text, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, active: e.data.active, dim: !!active && !e.data.active }));
}

export const labelPointFor = (box, handle) => slotPoint(box, String(handle));

function Canvas({ diagram, transcript, shown, resetKey }) {
  const ref = useRef(null);
  const graph = useMemo(() => buildGraph(diagram, transcript, shown), [diagram, transcript, shown]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  useFitOnResize(ref, FIT);
  // A new message re-lights the links but keeps wherever the person dragged the boxes.
  useEffect(() => { setNodes((cur) => graph.nodes.map((n) => ({ ...n, position: cur.find((c) => c.id === n.id)?.position ?? n.position }))); setEdges(graph.edges); }, [graph, setNodes, setEdges]);
  // Reset puts every box back where the diagram data says.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setOpen(null); setNodes(graph.nodes); setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 0); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click a box and it expands in place with its details (the shared diagram kit's Passport, §8c).
  const [open, setOpen] = useState(null);
  const kitGraph = useMemo(() => ({
    nodes: diagram.nodes.map((n) => ({ id: n.id, label: n.label, group: n.group })),
    edges: diagram.edges.map((e) => ({ source: e.source, target: e.target, label: e.label ?? "" })),
    groups: diagram.groups,
  }), [diagram]);
  const passportFor = useMemo(() => (nid) => boxPassport(kitGraph, nid), [kitGraph]);
  const withPassport = useMemo(() => nodes.map((n) => ({
    ...n, zIndex: n.id === open ? 10 : undefined, className: n.id === open ? "dk-open" : undefined,
    data: { ...n.data, passport: n.id === open ? passportFor(n.id) : null },
  })), [nodes, open, passportFor]);
  const items = useMemo(() => toLabelItems(edges, open != null || shown > 0), [edges, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useMemo(() => ({
    open: (nid) => setOpen(nid),
    close: () => setOpen(null),
    link: (nid) => { const u = new URL(window.location.href); u.searchParams.set("box", nid); return u.toString(); },
  }), []);
  return (
    <div ref={ref} className="flow" data-testid="flow">
      <PassportActions.Provider value={actions}>
        <ReactFlow nodes={withPassport} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
          fitView fitViewOptions={FIT} nodesDraggable nodesConnectable={false} minZoom={0.3} proOptions={{ hideAttribution: true }}>
          <Background /><Controls showInteractive={false} />
          <EdgeLabels items={items} pointFor={labelPointFor} fallback={{ w: 170, h: 40 }} />
          <FitOpen open={open} closePadding={0.12} />
        </ReactFlow>
      </PassportActions.Provider>
    </div>
  );
}

export default function FlowDiagram({ diagram, transcript, shown, resetKey }) {
  if (!diagram) return <p className="muted">Loading the diagram...</p>;
  return (
    <section aria-label={diagram.title}>
      <p className="muted">{diagram.title}. Drag any box; drag the background to pan. Reset puts the boxes back.</p>
      <ReactFlowProvider><Canvas diagram={diagram} transcript={transcript} shown={shown} resetKey={resetKey} /></ReactFlowProvider>
    </section>
  );
}
