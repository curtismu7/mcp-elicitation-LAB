# MCP Elicitation LAB

An MCP server in the middle of a tool call needs more from the person, and asks the client for it in form mode or URL mode. This lab runs 19 scenarios against a mock server and a mock client that follows the spec's rules, shows the raw JSON-RPC of every message, builds the dialog a compliant client must show, and reports findings when a server breaks a MUST or SHOULD.

Tier: Tester
Repo: https://github.com/curtismu7/mcp-elicitation-LAB
Catalog: D37

Catalog D37 ("MCP elicitation lab") is an existing row of the demo catalog, not a placeholder. The catalog lists its kind as Demo; this README declares Tester because the app probes and scores a server's behaviour against the spec rather than telling a customer story.

**Spec basis.** MCP revision **2025-11-25**, plus the current draft as a labelled difference. Both elicitation pages were read in full on 2026-10-22. `basic/security_best_practices`, `basic/authorization` and `basic/patterns/mrtr` were NOT read, so anything about them is UNVERIFIED. Real clients (do they implement URL mode?) were not probed. See `docs/safety.md`.

## What is simulated

**Mock mode (the only mode).** The MCP server and the MCP client are both mocks written for this lab, running inside one process. Nothing is fetched, opened or sent anywhere: a URL in a scenario is analysed and shown, never requested, and a netguard refuses every non-loopback socket, DNS lookup, fetch and UDP send or connect. "Opens the URL in a secure browser view" is narration, not behaviour. The phishing scenarios model the attack the spec describes with a mock identity check; they exploit nothing.

**Live mode (not available).** There is no real MCP server or client to connect to, so the header's Live button answers with a message and the lab stays on Mock. Setting `MEL_LAB_MODE=live` makes the server refuse to start, with the same message. If Live is ever added it will be owner-run.

What it shows:

- **Form mode:** accept, decline, cancel, client-side validation before anything is sent, and an empty capability meaning form only.
- **URL mode:** a secret goes to the server's own page and not through the client, `-32042 URLElicitationRequired` then a retry, declining consent, a client that did not declare URL mode, a stray completion notification.
- **Servers that break rules, on purpose:** a password in a form, a nested schema, a link in a form, a URL with a credential and a token, a Punycode host over http, a mode the client never declared, a malformed `-32042`.
- **Phishing:** Alice triggers the elicitation, Bob opens the link. A server that does not verify the person binds Bob's account to Alice's session; one that does, refuses.
- **Diagram:** ReactFlow, drawn from diagram-studio/1 data loaded by name: movable boxes, Simulate again, speed, Reset (restores box positions).
- **Talk track and presenter mode:** `docs/talk-track.md`, the page and the presenter notes are all rendered from one data file.

What is the lab's own behaviour (the spec does not define it) is labelled "lab behaviour" on screen: cancelling a form the client cannot render, and ending a malformed `-32042`.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode needs no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/curtismu7/mcp-elicitation-LAB.git
cd mcp-elicitation-LAB
npm ci
npm run build
npm start
```

Open http://127.0.0.1:6800/ . For development with hot reload: `npm run dev` (the API on 6800, the Vite dev server on http://127.0.0.1:6801/).

## Settings file

All standalone apps read one optional settings file, `~/Development/.env` (mode 600). Set `STANDALONE_ENV` to use another path. This lab takes **one** key from it and ignores everything else (it parses the file with `util.parseEnv` and copies only its own key); no value is ever printed:

- `MEL_LAB_MODE` (optional): `mock` (the default). `live` is refused with a message. A bare `MODE` is never read.

The shared file holds no `PORT`. Run-time knobs go in the shell, not in the file: `PORT` (see below) and `MEL_LAB_BIND` (loopback unless you set it on purpose; the container does). `LAB_ALLOWED_HOSTS` is a comma list of host names (no ports) the lab answers to besides loopback, as `<name>:<PORT>`; unset means loopback only. Docker defaults it to the name the family lab-proxy sends in Host (see `docker-compose.yml`), and on that Host only a write whose Origin equals `X-Forwarded-Proto://X-Forwarded-Host` counts as same-origin. The lab holds no credentials for anything, so no secret belongs in the file.

## Ports, and what to do if the port is taken

Ports: MCP Elicitation LAB listens on 6800 (set with PORT, default 6800). The Vite dev server uses 6801 (set with VITE_PORT). The Docker host port is HOST_PORT, default 6800.
Port range for this app: 6800-6849.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6800 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, either stop it or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
   Those are taken by other demos or other tools.

The server refuses a PORT outside 6800-6849 or on that reserved list.

## Mock and live modes

The header has a **Mock | Live** toggle on the page, with the current mode beside it ("Mode: mock") and the same mode named in the banner, which also shows in presenter mode. Mock is on. Clicking Live shows why it is not available and changes nothing: no request is made and the banner still says MOCK. The server answers `GET /api/info` with `mode: "mock"` and the reason Live is refused.

## Health, doctor and reset

```
npm run doctor   # Node, mode, bind, port range, every scenario behaves as declared, citations, diagram data, talk track, netguard, one real HTTP run, port free
npm run reset    # forgets every run in the default workspace; settings are kept
npm run smoke    # drives every scenario through a RUNNING lab over HTTP (BASE_URL=http://127.0.0.1:6800)
```

The app answers `GET /api/health` with `demo-health/1` (public, GET only, no detail; the state comes from the same checks as the doctor). **Reset** in the header does the same as the script for your own workspace, and also puts the diagram boxes back where the data says. Each browser tab has its own workspace (`X-Workspace`, default `default`), so one tab's Reset never touches another's.

## Docker (optional)

```
HOST_PORT=6800 docker compose up --build -d
```

Publishes to 127.0.0.1 only (a test pins it). The container is read-only, drops all capabilities, runs as a non-root user and needs nothing else. Docker on OrbStack, never Docker Desktop.

## Tests

```
npm test
```

Runs the server (vitest), the web UI (vitest) and the repo checks (`node --test scripts/*.test.mjs`). On Node 26, 103 pass: 59 server, 17 web and 27 repo checks. The browser logs the deliberate 4xx answers a negative scenario provokes as console messages; that is expected. Also by hand, with the family's shared standards kit: its `check-drift.sh .` and `check-css.sh .`, and its `conformance.mjs . --new` (not yet run in CI; rule 18 warns because the SE k8s build is deferred).

## Troubleshooting

- **The port is taken:** see "Ports, and what to do if the port is taken" above.
- **`refusing to start: mode`:** `MEL_LAB_MODE` is set to `live` (or something else). This lab has only Mock; unset it.
- **The page says "Could not load" or the diagram is empty:** the API is not running, or you opened the Vite dev server without the API. Run `npm start` and open port 6800, or `npm run dev`.
- **A request is refused with 403 `bad_host` or `cross_origin`:** the lab only answers a loopback Host (or a `LAB_ALLOWED_HOSTS` name, which is how the family lab-proxy reaches it) and same-origin writes. Open it as http://127.0.0.1:6800/ or through the family launcher, and do not put any other proxy in front.
- **Docker health stays "starting":** run `docker compose logs`; the container needs port 6800 free inside and `HOST_PORT` free on the host.

## Ownership

- Owner: the Ping SE demo family owner (see the repo settings).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.
