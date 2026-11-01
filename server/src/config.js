// Deployment configuration. MEL_LAB_MODE is the one lab-specific setting (the shared settings file may carry it). A bare MODE is NOT read:
// the shared file is read by every standalone app, and another app's MODE must not switch this one.
// This lab has no live mode: the MCP server and the MCP client are both mocks inside the process, so there is nothing real to connect to.
// Asking for live is refused with an honest message, never silently ignored.
export const MODES = ['mock', 'live'];
export const LIVE_REFUSAL = 'Live mode is not available in this lab. The MCP server and the MCP client here are both mocks inside this app, so there is no real server or client to connect to. It stays on Mock, and nothing was sent anywhere.';

export function modeFrom(env = process.env) {
  const raw = env.MEL_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (m === 'live') throw new Error(LIVE_REFUSAL);
  if (m !== 'mock') throw new Error(`MEL_LAB_MODE=${String(m).slice(0, 20)} is not available: this lab only has mock`);
  return m;
}
