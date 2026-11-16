import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import App from "./App.jsx";
import { workspaceId } from "./workspace.js";

// React Flow needs real DOM measuring; the header test never draws a diagram, so a stub is enough.
vi.mock("@xyflow/react", async () => ({
  Position: {}, MarkerType: {}, Handle: () => null, Background: () => null, Controls: () => null, ReactFlowProvider: ({ children }) => children,
  useReactFlow: () => ({ fitView: () => {} }), useNodesState: (i) => [i, () => {}, () => {}], useEdgesState: (i) => [i, () => {}, () => {}], ReactFlow: () => null,
}));

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { cleanup(); });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const DIAGRAM = { schema: "diagram-studio/1", id: "elicitation-actors", title: "Who talks to whom", groups: { person: { label: "p", color: "dark" } }, nodes: [{ id: "person", label: "Person", group: "person", x: 0, y: 40 }], edges: [] };
const SPEC = { protocol: "2025-11-25", read: "2026-10-22", pages: [], notRead: [], draftDifferences: [], findings: {} };
const INFO = { mode: "mock", source: "mock", realAvailable: false, realReason: "x", modes: ["mock", "live"], live: { available: false, reason: "x" }, simulated: true };
function mockShelf(payload) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const clean = url.split("?")[0];
    const body = clean === "/api/shelf" ? payload : clean === "/api/scenarios" ? { scenarios: [] } : clean === "/api/diagram" ? DIAGRAM : clean === "/api/spec" ? SPEC : clean === "/api/info" ? INFO : clean === "/api/talk-track" ? { talkTrack: [] } : {};
    return { ok: true, status: 200, json: async () => body };
  });
  return calls;
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, once, and no other lab's", async () => {
    const calls = mockShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "mcp-elicitation-lab", verification: mark("verified", "Verified", { note: "Every scenario run on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scenario run on the mock"));
    // same per-request header as the Shelf link
    const shelfCalls = calls.filter((c) => c.url === "/api/shelf");
    expect(shelfCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of shelfCalls) expect(c.headers["x-workspace"]).toBe(workspaceId());
  });

  it("shows nothing when the lab is opened on its own port ({ shelfUrl } only) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "mcp-elicitation-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "mcp-elicitation-lab", verification: mark("none", "") }] }]) {
      mockShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      await waitFor(() => expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument()); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
