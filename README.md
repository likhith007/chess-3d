# Chess

Real-time multiplayer chess in the browser: click **Play**, get matched with another player, and play.
The server is authoritative and validates every move.

## Tech stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js | 24.x LTS (`.nvmrc`: 24.21.0) | Event loop is ideal for many idle, chatty sockets. Runs `.ts` directly via built-in type stripping, so there's no server build step |
| Language | TypeScript | 5.9.3 | Types are shared by client and server (`src/shared`) |
| WebSockets | `ws` | 8.22.0 | Fastest, leanest mainstream Node WS server. 1000+ sockets on one core is routine |
| Chess rules | `chess.js` | 1.4.0 | Battle-tested move generation and draw/mate detection |
| Client bundler | Vite | 8.3.4 | Dev server with WS proxy. The production bundle is ~1.5 KB gzipped |
| Tests | Vitest | 5.0.4 | Fast, ESM-native, runs TS directly |

All versions are pinned exactly (`.npmrc` has `save-exact=true`), and `package-lock.json` pins transitive deps.
Use `npm ci` to install exactly what's locked.

## Quick start (Docker)

```bash
docker compose up --build
```

Open http://localhost:8080 in two browser windows and press **Play** in both.
A game needs **two players**. With only one window, you'll wait in the queue and the board stays dimmed.
To use a different host port, run `WEB_PORT=9000 docker compose up --build`.
Stop it with `Ctrl+C`, or with `docker compose down` if you started it with `-d`.

| Container | Image | Role |
|---|---|---|
| `web` | `nginx:1.30.5-alpine` | Serves the built client and proxies `/ws` to `server`. The only published port (8080) |
| `server` | `node:24.21.0-alpine3.24` | Game server. Runs as the non-root `node` user, has a `/healthz` healthcheck, and installs prod deps only |

`docker/nginx.conf` raises `worker_connections` to 4096 (each proxied WebSocket uses two connections),
and compose raises the open-file limit to 65536 so 1000+ sockets fit.

## Local development

```bash
nvm use            # Node 24
npm ci
npm run dev:server # ws://localhost:8080/ws
npm run dev:client # http://localhost:5173 (proxies /ws to the server)
```

Open two browser windows at http://localhost:5173 and press **Play** in both.

| Script | What it does |
|---|---|
| `npm start` | Run the server (`PORT`, `HOST` env vars; default `0.0.0.0:8080`) |
| `npm run build:client` | Build the static client to `dist/client/` |
| `npm test` | Run all tests (future specs show as `todo`) |
| `npm run test:memory` | Run only the memory-leak suite (~10s) |
| `npm run typecheck` | `tsc --noEmit` |

## Project layout

```
src/
  shared/protocol.ts   message types + untrusted-input parser (used by both sides)
  shared/board.ts      FEN -> board map helpers
  server/game.ts       Game: one match, pure logic (turns, legality, results)
  server/matchmaker.ts FIFO pairing queue
  server/server.ts     HTTP + WebSocket server, sessions, heartbeats
  server/index.ts      process entrypoint
  client/selection.ts  click-to-move state machine (unit tested)
  client/reconnect.ts  reconnect backoff (unit tested)
  client/              Vite app (vanilla TS, DOM board)
docker/                server + web Dockerfiles, nginx.conf
docker-compose.yml     one-command stack
tests/
  unit/                protocol, board, game, legal moves/check, matchmaker, selection, reconnect
  integration/         real sockets against a server on an ephemeral port
  memory/              leak tests: state drains, heap after GC, listeners, heartbeat, shutdown handles
  future/              it.todo specs: throughput, edge cases
docs/TESTING_ROADMAP.md
```

## Protocol

JSON text frames on `/ws`.

- Client → server: `hello {name, token?}` (must be first), `join_queue`, `move {from, to, promotion?}`,
  `legal_moves {from}`, `resign`
- Server → client: `welcome {name, token}`, `queued`,
  `game_start {gameId, color, fen, white, black, moves, lastMove, check, opponentConnected}`,
  `opponent_status {connected}`, `move_made {from, to, san, fen, check}`, `legal_moves {from, to[]}`,
  `game_over {result, reason}`, `error {message}`

### Legal moves and check
- Selecting a piece asks the server (authoritative for the rules) for its legal moves. Empty
  destination squares get a dot, and capturable pieces get a ring. This covers every piece type, castling,
  en passant and promotion, and excludes moves that would leave the king in check.
- After every move the server reports whether the side to move is in check. Both boards shake,
  the checked king's square turns red, and the status line says "Check!". The check state is
  restored after a refresh or reconnect.

`GET /healthz` returns `200 ok`.

### Sessions and reconnects
- Each browser tab asks for a name (1–20 letters, numbers, spaces, `_ . -`). The server answers with a
  secret session **token**. The client stores `{name, token}` in `sessionStorage`, which is per tab and
  survives a refresh, so two windows in the same browser are two different players.
- If the socket drops, the client reconnects automatically (exponential backoff with jitter, max 10s)
  and sends `hello` with its token. If the player was in a game, the server replies with a `game_start`
  snapshot (including the move history) and the game continues.
- The opponent sees `opponent_status {connected:false}`. If the player isn't back within
  **30s** (`reconnectGraceMs`), they forfeit (`reason: "abandoned"`).
- Opening the same session in a second tab takes it over. The old tab is closed with code `4000`
  and doesn't reconnect.
- Sessions live in server memory only, so restarting the server forgets them. There are no accounts or passwords yet.

## Performance notes (1000 concurrent users target)

- Per-message deflate is **off**. Messages are under 100 bytes, and compression costs CPU plus about 300 KB of memory per socket.
- `maxPayload` is 1 KB, so oversized frames are rejected before they're parsed.
- A heartbeat ping every 30s terminates dead sockets so sessions don't leak.
- State is held in `Map`s/`Set`s with O(1) lookup and removal, and finished games are deleted right away.
- Leak tests run in `npm test`. Load testing is still open, see `docs/TESTING_ROADMAP.md`.

### Scaling beyond one node
State is in memory in a single process. To scale horizontally, you'd need sticky routing per game
plus a shared matchmaking queue and pub/sub (e.g. Redis). This is out of scope for now.

## Status

- [x] Matchmaking, server-validated moves, checkmate/stalemate/draw detection, resign, disconnect forfeit
- [x] Player names, per-tab sessions, refresh/reconnect resumes the game (30s grace)
- [x] Legal-move dots for every piece, check detection with board shake
- [x] Unit + integration tests (TDD)
- [x] Docker Compose stack (nginx + Node)
- [x] Memory-leak tests (`tests/memory/`)
- [ ] Throughput and edge-case tests (`tests/future/`, for future work)
- [ ] Clocks / time controls, promotion picker, rate limiting, accounts/ratings
