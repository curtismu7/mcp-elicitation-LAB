import { workspaceFetch } from "./workspace.js";

async function j(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.reason || body.error || `HTTP ${res.status}`), { code: body.error });
  return body;
}
const get = (url) => workspaceFetch(url, { method: "GET" }).then(j);
const post = (url, body) => workspaceFetch(url, { method: "POST", body: JSON.stringify(body ?? {}) }).then(j);
export const getScenarios = () => get("/api/scenarios");
export const getSpec = () => get("/api/spec");
export const getInfo = () => get("/api/info");
export const getDiagram = (name) => get(`/api/diagram?name=${encodeURIComponent(name)}`);
export const getTalkTrack = () => get("/api/talk-track");
export const startRun = (body) => post("/api/runs", body);
export const respond = (id, action, content) => post(`/api/runs/${id}/respond`, { action, content });
export const resetServer = () => post("/api/reset", {});
