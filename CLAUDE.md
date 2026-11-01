# mcp-elicitation-LAB

Tester-tier standalone app (catalog D37), mock only. An MCP server mid-tool-call asks the person for more input: form mode, URL mode, accept/decline/cancel, -32042, and the spec's safety rules. Rules: `~/Development/STANDALONE-RULES.md`.

- Run: `npm ci && npm run build && npm start` (http://127.0.0.1:6800). Test: `npm test` (server vitest, web vitest, `node --test scripts/*.test.mjs`). Preflight `npm run doctor`. Reset `npm run reset`. Smoke `npm run smoke` against a running lab. Talk track `npm run talk-track`. Content pack `npm run content-pack`. Docker: `HOST_PORT=6800 docker compose up --build -d`. Node 26 only.
- Ports 6800-6849 only. Never 8080, 5173, 3900, 4000, 4400, 4510, 4600-4601, 18080/19080/19090.
- Layout: `server/src` (`engine.js` = the mock client + driver, `servers.js` = the mock server whose tools are async generators, `scenarios.js` = data, `lint.js` = spec-sourced findings, `schema.js`, `url.js`, `safety.js`, `netguard.js`, `workspaces.js`, `doctor.js`, `health.js`, `talkTrack.js` = talk-track data, `diagramData.js` + `server/diagrams/*.json` = diagram-studio/1 data), `web/src` (App, ClientDialog, Transcript, Findings, FlowDiagram = ReactFlow, TalkTrack), `scripts`, `docs`.
- Mock only. The header Mock | Live toggle shows on the page; Live is refused with a message (`LIVE_REFUSAL` in `config.js`) and `MEL_LAB_MODE=live` refuses to start. Settings: the one shared `~/Development/.env` (`STANDALONE_ENV` overrides), read by `settings.js` with `util.parseEnv`, taking only `MEL_LAB_MODE`; never a bare `MODE`; no per-app `.env`.
- State is per workspace: the `X-Workspace` header (default `default`); a malformed id is a 400.
- The rules that bite:
  - EVERY spec claim must come from a page that was actually fetched and read. Only the 2025-11-25 and draft elicitation pages were read; security_best_practices, authorization and mrtr were NOT: say UNVERIFIED. A new finding needs a `cite` starting `2025-11-25 > ` and a test.
  - Nothing is ever fetched. A URL is analysed and shown (`url.js` is pure). Do not add a network call, and do not make the lab client open anything. Hosts in shipped text are `.example` / `.invalid` only (the spec page links are the one exception: shown, never fetched).
  - Lab behaviour the spec does not define (cancelling an unrenderable form, ending a malformed -32042) must be labelled as lab behaviour on screen.
  - The scenario data pins what each run must produce (`expect.findings`, `outcomeIncludes`); tests, `npm run doctor` and `npm run smoke` all read it.
  - The talk track, the page and `docs/talk-track.md` come from `talkTrack.js`; run `npm run talk-track` after editing it (a test fails on drift). Same for `content-pack.json` (`npm run content-pack`).
  - Diagrams are diagram-studio/1 data loaded by name (rule 17), ReactFlow, movable boxes, Simulate again, Reset (restores positions), speed control. No mermaid. App CSS uses tokens only (no colour literals, no purple, no italics); `web/src/styles/standalone-ui.css` is the shared stylesheet, byte-for-byte: never edit it.
  - Run buttons use `aria-disabled`, not `disabled`, so focus is kept. P / Esc presenter keys ignore modifier keys and fields.
  - Do not use `process.env.MODE`, EC `generateKeyPair`, or any k8s/SE code (deferred by the owner).
  - Never write into another repo.
- Never commit `.env`. Commits end with the Co-Authored-By trailer; the gitleaks pre-commit hook runs on every commit. Run check-drift, check-css and conformance by hand.
