import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import App, { BANNER } from "./App.jsx";
import { buildGraph, linkOf } from "./FlowDiagram.jsx";
import { forgetWorkspace, workspaceId } from "./workspace.js";

// React Flow measures the DOM, which jsdom does not have: a small stand-in that keeps real node state, so a drag (a click on a box moves it +50)
// and Reset can be tested. The real library is exercised in the browser check.
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  const move = (cur, changes) => cur.map((n) => { const c = changes.find((x) => x.id === n.id); return c ? { ...n, position: c.position } : n; });
  return {
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" }, MarkerType: { ArrowClosed: "arrowclosed" },
    Handle: () => null, Background: () => null, Controls: () => null, ReactFlowProvider: ({ children }) => children, useReactFlow: () => ({ fitView: () => {} }),
    useNodesState: (init) => { const [nodes, setNodes] = React.useState(init); return [nodes, setNodes, (changes) => setNodes((cur) => move(cur, changes))]; },
    useEdgesState: (init) => { const [edges, setEdges] = React.useState(init); return [edges, setEdges, () => {}]; },
    ReactFlow: ({ nodes, edges, onNodesChange }) => (
      <div data-testid="rf">
        {nodes.map((n) => <button key={n.id} type="button" data-testid={`node-${n.id}`} data-x={n.position.x} data-color={n.data.color} onClick={() => onNodesChange([{ id: n.id, position: { x: n.position.x + 50, y: n.position.y } }])}>{n.data.label}</button>)}
        {edges.map((e) => <span key={e.id} data-testid={`edge-${e.id}`} data-class={e.className}>{e.label}</span>)}
      </div>
    ),
  };
});
afterEach(() => { cleanup(); window.location.hash = ""; });

const SCEN = [
  { id: "form-accept", group: "Form mode", title: "Form: accept", blurb: "b1", tool: "t", spec: ["Form Mode"], expectedFindings: [] },
  { id: "bad-idn-http", group: "Server breaks a rule", title: "Look-alike host", blurb: "b2", tool: "t", spec: ["Safe URL Handling"], expectedFindings: ["url-not-https", "url-punycode"] },
];
const SPEC = { protocol: "2025-11-25", read: "2026-10-22", pages: [{ id: "2025-11-25", url: "https://x.example/a", status: "read in full" }], notRead: ["basic/authorization"], draftDifferences: ["No -32042 in the draft."], findings: {} };
const REASON = "Live mode is not available in this lab. Reason for the test.";
const INFO = { mode: "mock", source: "mock", realAvailable: false, realReason: REASON, modes: ["mock", "live"], live: { available: false, reason: REASON }, simulated: true };
const DIAGRAM = {
  schema: "diagram-studio/1", id: "elicitation-actors", title: "Who talks to whom",
  groups: { person: { label: "p", color: "dark" }, client: { label: "c", color: "blue" }, server: { label: "s", color: "red" }, browser: { label: "b", color: "grey" } },
  nodes: [{ id: "person", label: "Person", group: "person", x: 0, y: 40 }, { id: "client", label: "Client (mock)", group: "client", x: 190, y: 40 }, { id: "server", label: "Server (mock)", group: "server", x: 380, y: 40 }, { id: "browser", label: "Browser", group: "browser", x: 190, y: 190 }],
  edges: [{ source: "person", target: "client", label: "choice", dashed: true }, { source: "client", target: "server", label: "JSON-RPC", dashed: true }, { source: "client", target: "browser", label: "opens URL", dashed: true }, { source: "browser", target: "server", label: "server page", dashed: true }],
};
const TALK = [
  { id: "t-form", title: "Form note", for: ["Form mode"], say: "Say this about forms." },
  { id: "t-rule", title: "Rule note", for: ["Server breaks a rule"], say: "Say this about broken rules." },
  { id: "t-none", title: "Honesty note", for: [], say: "Say this about what is simulated." },
];
const T = (n, dir, kind, extra = {}) => ({ n, dir, kind, json: null, traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`, ...extra });
const FORM_PENDING = { kind: "form", mode: "form", server: { name: "Example MCP", version: "1" }, message: "A few details", buttons: ["accept", "decline", "cancel"], errors: null,
  fields: [{ name: "partySize", label: "Party size", kind: "number", required: true, default: 2, min: 1, max: 12, description: null, options: null, format: null }, { name: "date", label: "Date", kind: "string", required: true, format: "date", default: null, description: null, options: null }],
  compliance: [{ level: "MUST", text: "Shows which server is asking." }] };
const URL_PENDING = { kind: "url", mode: "url", server: { name: "Example MCP", version: "1" }, message: "Sign in", buttons: ["accept", "decline", "cancel"], errors: null, elicitationId: "e1",
  url: { full: "http://xn--exmple-cua.mcp.example/login", valid: true, scheme: "http", host: "xn--exmple-cua.mcp.example", subdomain: "xn--exmple-cua", apex: "mcp.example", warnings: ["The host uses Punycode or non-ASCII characters: it may imitate another site.", "The URL is not HTTPS."] },
  compliance: [{ level: "MUST NOT", text: "Opens nothing without your explicit consent." }] };

function mockApi({ runs = [], gate = null } = {}) {
  const queue = [...runs]; const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers ?? {} });
    const clean = url.split("?")[0];
    if (clean === "/api/mode") { // the server answers rule 19: {source:"real"} is a 409 with the honest reason
      const refused = calls[calls.length - 1].body?.source === "real";
      return { ok: !refused, status: refused ? 409 : 200, json: async () => (refused ? { error: "real_not_available", message: REASON, source: "mock" } : INFO) };
    }
    const body = clean === "/api/shelf" ? { shelfUrl: null } : clean === "/api/scenarios" ? { scenarios: SCEN } : clean === "/api/spec" ? SPEC : clean === "/api/info" ? INFO : clean === "/api/diagram" ? DIAGRAM : clean === "/api/talk-track" ? { talkTrack: TALK } : clean === "/api/reset" ? { reset: true } : queue.shift();
    if (gate && (clean === "/api/runs" || clean.includes("/respond"))) await gate; // a run stays in flight until the test opens the gate
    return { ok: true, status: 200, json: async () => body };
  });
  return calls;
}
const base = { id: "r1", scenarioId: "form-accept", user: "alice", caps: { form: {}, url: {} }, traceId: "a".repeat(32), findings: [], flags: {}, outcome: null };
// The Scenario label renders before getScenarios() resolves, so wait for the scenarios themselves (the options exist only after the fetch).
const ready = () => waitFor(() => { expect(screen.getByLabelText("Scenario")).toBeInTheDocument(); expect(screen.getByRole("option", { name: "Form: accept" })).toBeInTheDocument(); });
const runButton = () => screen.getByRole("button", { name: /^(Run|Running)/ });

describe("App", () => {
  it("shows the banner naming the mode, the grouped scenarios, the talk track and the spec basis", async () => {
    mockApi();
    render(<App />);
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode, simulated/);
    expect(screen.getByTestId("banner")).toHaveTextContent(/ever opened or fetched/);
    expect(await screen.findByRole("group", { name: "Server breaks a rule" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Spec basis/)).toBeInTheDocument());
    expect(screen.getAllByText(/UNVERIFIED/).length).toBeGreaterThanOrEqual(2); // the banner and the spec basis
    await waitFor(() => expect(within(screen.getByTestId("talk-track")).getAllByRole("heading", { level: 3 })).toHaveLength(3));
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("selects the scenario named in the URL hash (the content pack links to it)", async () => {
    window.location.hash = "#scenario-bad-idn-http";
    mockApi();
    render(<App />);
    await ready();
    await waitFor(() => expect(screen.getByLabelText("Scenario")).toHaveValue("bad-idn-http"));
  });

  it("the Mode dropdown is in the header: Mock is on, and Live is refused with the honest reason and changes nothing", async () => {
    mockApi();
    render(<App />);
    await ready();
    const header = screen.getByRole("banner");
    const select = within(header).getByTestId("mode-select");
    expect(select).toHaveValue("mock");
    expect(within(header).getByTestId("mode")).toHaveTextContent("Mode: mock");
    expect(screen.queryByTestId("live-refusal")).not.toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/info", expect.anything()));
    const realOption = within(select).getByRole("option", { name: "Real" });
    expect(realOption).toBeDisabled(); // Real is unavailable
    fireEvent.change(select, { target: { value: "real" } });
    await waitFor(() => expect(screen.getByTestId("live-refusal")).toHaveTextContent(REASON));
    expect(select).toHaveValue("mock"); // still mock
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/);
  });

  it("choosing Real in the Mode dropdown POSTs /api/mode with {source:'real'}, and the 409 reason is shown", async () => {
    const calls = mockApi();
    render(<App />);
    await ready();
    fireEvent.change(within(screen.getByRole("banner")).getByTestId("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(calls.some(({ url, body }) => String(url).endsWith("/api/mode") && body?.source === "real")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("live-refusal")).toHaveTextContent(REASON));
  });

  it("a form: shows the dialog with defaults, shows a blocked submit's error, then the outcome", async () => {
    const parked = { ...base, status: "awaiting_user", pending: FORM_PENDING, transcript: [T(1, "client→server", "request", { method: "initialize" })] };
    const blocked = { ...parked, pending: { ...FORM_PENDING, errors: { partySize: "At most 12" } }, transcript: [...parked.transcript, T(2, "client", "note", { note: "The client blocks sending." })] };
    const done = { ...base, status: "done", pending: null, outcome: "Booked 3 at Harbour Grill", transcript: [T(1, "client→server", "request", { method: "initialize" }), T(2, "person", "ui", { note: "The person submits the form." })] };
    const calls = mockApi({ runs: [parked, blocked, done] });
    render(<App />);
    await ready();
    fireEvent.click(runButton());
    const dialog = await screen.findByRole("group", { name: "Client dialog" });
    expect(dialog).toHaveTextContent("Example MCP");
    expect(screen.getByLabelText(/Party size/)).toHaveValue(2); // default pre-populated
    fireEvent.change(screen.getByLabelText(/Party size/), { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: "2026-12-24" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit/ }));
    await waitFor(() => expect(screen.getByText("At most 12")).toBeInTheDocument());
    expect(calls.find((c) => c.url.includes("/respond")).body).toEqual({ action: "accept", content: { partySize: 99, date: "2026-12-24" } });
    expect(screen.getByLabelText(/Party size/)).toHaveValue(99); // what the person typed is kept, not reset to the default
    fireEvent.change(screen.getByLabelText(/Party size/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit/ }));
    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("Booked 3"));
    expect(screen.queryByRole("group", { name: "Client dialog" })).not.toBeInTheDocument();
  });

  it("a URL: shows the FULL url, the highlighted domain, warnings, and consent buttons; declining sends decline", async () => {
    const parked = { ...base, scenarioId: "bad-idn-http", status: "awaiting_user", pending: URL_PENDING, transcript: [T(1, "client→server", "request", { method: "initialize" })] };
    const done = { ...parked, status: "done", pending: null, outcome: "Client replied: decline.", findings: [{ id: "url-punycode", level: "SHOULD", who: "client", title: "Ambiguous or suspicious host (Punycode)", text: "t", cite: "2025-11-25 > Safe URL Handling (client rules)", detail: "Host xn--exmple-cua.mcp.example" }], transcript: parked.transcript };
    const calls = mockApi({ runs: [parked, done] });
    render(<App />);
    await ready();
    fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "bad-idn-http" } });
    fireEvent.click(runButton());
    const dialog = await screen.findByRole("group", { name: "Client dialog" });
    expect(screen.getByLabelText("Full URL")).toHaveTextContent("http://xn--exmple-cua.mcp.example/login");
    expect(dialog).toHaveTextContent(/Domain:\s*xn--exmple-cua\.mcp\.example/);
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Punycode.*not HTTPS/);
    expect(screen.getByRole("button", { name: /Open this URL/ })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(calls.find((c) => c.url.includes("/respond")).body).toEqual({ action: "decline" }));
    await waitFor(() => expect(screen.getByLabelText("Findings")).toHaveTextContent(/Source: spec 2025-11-25 > Safe URL Handling/));
  });

  it("shows raw JSON-RPC for each message with its traceparent", async () => {
    const done = { ...base, status: "done", pending: null, outcome: "ok", transcript: [T(1, "client→server", "request", { method: "initialize", json: { jsonrpc: "2.0", id: 0, method: "initialize" } })] };
    mockApi({ runs: [done] });
    render(<App />);
    await ready();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByLabelText("Message 1")).toHaveTextContent('"method": "initialize"'));
    expect(screen.getByText(/traceparent 00-/)).toBeInTheDocument();
  });
});

describe("Reset and the diagram", () => {
  it("Reset clears the run, tells the server, announces it, and puts dragged boxes back where the data says", async () => {
    const done = { ...base, status: "done", pending: null, outcome: "ok", transcript: [T(1, "client→server", "request", { method: "initialize", json: { jsonrpc: "2.0", id: 0, method: "initialize" } })] };
    const calls = mockApi({ runs: [done] });
    render(<App />);
    await ready();
    await waitFor(() => expect(screen.getByTestId("node-client")).toBeInTheDocument());
    expect(screen.getByTestId("node-client")).toHaveAttribute("data-x", "190");
    fireEvent.click(screen.getByTestId("node-client")); // drag +50
    expect(screen.getByTestId("node-client")).toHaveAttribute("data-x", "240");
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByLabelText("Protocol transcript")).toBeInTheDocument());
    expect(screen.getByTestId("node-client")).toHaveAttribute("data-x", "240"); // a new message keeps where the person put the box
    fireEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("node-client")).toHaveAttribute("data-x", "190"));
    expect(screen.queryByLabelText("Protocol transcript")).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset")).toBe(true));
    await waitFor(() => expect(screen.getByText(/Reset: your workspace's runs are cleared/)).toBeInTheDocument());
    expect(calls.find((c) => c.url === "/api/reset").headers["x-workspace"]).toBe(workspaceId());
  });

  it("the diagram comes from the server's diagram-studio data, by name", async () => {
    const calls = mockApi();
    render(<App />);
    await ready();
    await waitFor(() => expect(screen.getByTestId("node-person")).toBeInTheDocument());
    expect(calls.find((c) => c.url.startsWith("/api/diagram")).url).toBe("/api/diagram?name=elicitation-actors");
    expect(["person", "client", "server", "browser"].map((id) => screen.getByTestId(`node-${id}`).dataset.color)).toEqual(["dark", "blue", "red", "grey"]);
  });

  it("every API call carries the tab's workspace id", async () => {
    forgetWorkspace();
    const calls = mockApi();
    render(<App />);
    await ready();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(5));
    const ids = new Set(calls.map((c) => c.headers["x-workspace"]));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^w-[0-9a-f]{16}$/);
  });
});

describe("Run buttons keep focus: aria-disabled, not disabled", () => {
  it("Run is aria-disabled while a run is in flight, still focusable, and a second press sends nothing", async () => {
    const done = { ...base, status: "done", pending: null, outcome: "ok", transcript: [T(1, "client→server", "request", { method: "initialize" })] };
    let open; const gate = new Promise((r) => { open = r; });
    const calls = mockApi({ runs: [done], gate });
    render(<App />);
    await ready();
    await waitFor(() => expect(runButton()).not.toHaveAttribute("aria-disabled", "true")); // the scenarios have loaded
    runButton().focus();
    fireEvent.click(runButton());
    await waitFor(() => expect(runButton()).toHaveAttribute("aria-disabled", "true"));
    expect(runButton()).not.toBeDisabled();
    expect(document.activeElement).toBe(runButton());
    fireEvent.click(runButton()); fireEvent.click(runButton());
    expect(calls.filter((c) => c.url === "/api/runs")).toHaveLength(1); // the run is still in flight: the extra presses sent nothing
    open();
    await waitFor(() => expect(runButton()).not.toHaveAttribute("aria-disabled", "true"));
    expect(calls.filter((c) => c.url === "/api/runs")).toHaveLength(1);
  });
  it("Simulate again is aria-disabled until there is a run", async () => {
    mockApi();
    render(<App />);
    await ready();
    expect(screen.getByRole("button", { name: "Simulate again" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Simulate again" })).not.toBeDisabled();
  });
});

describe("Presenter mode", () => {
  const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
  it("P toggles it and Esc leaves it; the banner and the Mock | Live toggle stay; the talk track note matches the scenario's group", async () => {
    mockApi();
    render(<App />);
    await ready();
    await waitFor(() => expect(screen.getByText("Form note", { selector: "h3" })).toBeInTheDocument());
    expect(screen.queryByTestId("presenter-say")).not.toBeInTheDocument();
    press("p");
    const say = await screen.findByTestId("presenter-say");
    expect(say).toHaveTextContent("Say this about forms."); expect(say).not.toHaveTextContent("broken rules");
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER);
    expect(screen.getByTestId("mode-select")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "bad-idn-http" } });
    expect(screen.getByTestId("presenter-say")).toHaveTextContent("Say this about broken rules.");
    press("Escape");
    expect(screen.queryByTestId("presenter-say")).not.toBeInTheDocument();
    expect(screen.getByTestId("banner")).toBeInTheDocument();
    press("P");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    press("Escape");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
  });
  it("ignores a key with a modifier (Ctrl/Cmd/Alt+P) and a P typed into a field", async () => {
    mockApi();
    render(<App />);
    await ready();
    press("p", { ctrlKey: true }); press("p", { metaKey: true }); press("p", { altKey: true });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    press("p", {}, screen.getByLabelText("Scenario"));
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    press("p");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("buildGraph (from the diagram data)", () => {
  const tr = [T(1, "client→server", "request"), T(2, "server→client", "request"), T(3, "person", "ui"), T(4, "client", "browser"), T(5, "browser", "browser"), T(6, "server→client", "error")];
  it("takes its nodes, positions and colours from the data, not from code", () => {
    const g = buildGraph(DIAGRAM, [], 0);
    expect(g.nodes.map((n) => [n.id, n.position.x, n.position.y, n.data.color])).toEqual([["person", 0, 40, "dark"], ["client", 190, 40, "blue"], ["server", 380, 40, "red"], ["browser", 190, 190, "grey"]]);
    expect(g.edges.map((e) => [e.id, e.label, e.className])).toEqual([["person-client", "choice", "flow-edge flow-edge--idle"], ["client-server", "JSON-RPC", "flow-edge flow-edge--idle"], ["client-browser", "opens URL", "flow-edge flow-edge--idle"], ["browser-server", "server page", "flow-edge flow-edge--idle"]]);
  });
  it("lights only the links a revealed message crossed, and counts them", () => {
    const g = buildGraph(DIAGRAM, tr, 3);
    const e = Object.fromEntries(g.edges.map((x) => [x.id, x.label]));
    expect(e).toMatchObject({ "client-server": "2 messages", "person-client": "1 message", "client-browser": "opens URL", "browser-server": "server page" });
  });
  it("marks a link as an error when its last message is an error", () => {
    expect(buildGraph(DIAGRAM, tr, 6).edges.find((x) => x.id === "client-server").className).toBe("flow-edge flow-edge--error");
    expect(buildGraph(DIAGRAM, tr, 2).edges.find((x) => x.id === "client-server").className).toBe("flow-edge flow-edge--seen");
  });
  it("maps every message direction to a link, and ignores server notes", () => {
    expect(["client→server", "server→client", "person", "browser"].map((dir) => linkOf({ dir, kind: "x" }))).toEqual(["client-server", "client-server", "person-client", "browser-server"]);
    expect(linkOf({ dir: "client", kind: "browser" })).toBe("client-browser");
    expect(linkOf({ dir: "server", kind: "note" })).toBeNull();
  });
});
