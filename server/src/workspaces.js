import { createLab } from './engine.js';

// Rule 13: state belongs to a workspace. The browser sends its id in X-Workspace (default "default"); each browser tab picks its own,
// so one visitor's runs and Reset never touch another's. Reset clears the current workspace only. Bounded in count and idle time.
export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';

// The id from the request, or null when it is malformed (refused with 400 rather than echoed back).
export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : null;
}

export function createWorkspaces({ now = () => new Date(), max = 200, idleMs = 2 * 60 * 60 * 1000 } = {}) {
  const spaces = new Map(); // workspaceId -> { lab, seen }
  function get(workspaceId) {
    const t = now().getTime();
    for (const [k, v] of spaces) if (t - v.seen > idleMs) spaces.delete(k); // idle ones go first
    let s = spaces.get(workspaceId);
    if (!s) {
      s = { lab: createLab({ now }), seen: t };
      while (spaces.size >= max) spaces.delete(spaces.keys().next().value); // then the least recently used
    }
    s.seen = t;
    spaces.delete(workspaceId); spaces.set(workspaceId, s); // most recently used goes last
    return s.lab;
  }
  return { get, size: () => spaces.size };
}
