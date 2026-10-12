# Testing roadmap (for future work)

The bare-minimum game is implemented and covered by `tests/unit` and `tests/integration`.
The specs in `tests/future/` are `it.todo` placeholders. Implement them one at a time, TDD style:
turn a todo into a real (failing) test, then change `src/` until it passes.

## 1. Memory leaks (`tests/memory/memory-leaks.test.ts`): ✅ implemented

All 7 specs are implemented. They found one real bug: `server.close()` terminated in-game sockets
*after* clearing grace timers, so each one started a fresh 30s timer that outlived the server.

How they work:
- Use `server.stats()` (`connections`, `queued`, `games`) as the first, cheap leak oracle.
  Every map must drain to zero once all clients leave.
- For heap checks, run with `--expose-gc`, call `global.gc()` a few times, and compare
  `process.memoryUsage().heapUsed` before and after N games. Assert a tolerance, not equality.
- `startServer({ heartbeatMs })` can be set low (e.g. 50ms) to test dead-socket cleanup quickly.
  To simulate a dead peer, stop the client from answering pings (`ws.pong = () => {}` or pause the socket).

## 2. Throughput (`tests/future/throughput.test.ts`)
Target: **1000 concurrent users on one Node process.**
- Reuse `tests/helpers/test-client.ts`. You may need to raise `ulimit -n` locally.
- Measure move round-trip latency (send `move`, wait for `move_made`) and report p50/p99.
- Measure event-loop delay with `perf_hooks.monitorEventLoopDelay()`.
- Keep load tests out of the default `npm test` run if they get slow (add a `test:load` script).

## 3. Edge cases (`tests/future/edge-cases.test.ts`)
Known gaps in the current implementation that these tests should drive:
| Gap | Where | Likely fix |
|---|---|---|
| No rate limiting | `server.ts` message handler | token bucket per session |
| No backpressure | `send()` in `server.ts` | drop/close when `ws.bufferedAmount` exceeds a threshold |
| No clocks or idle timeout, so a game can stall forever | `Game` / `server.ts` | time controls with server-side timers |
| Sessions are in memory only, so a server restart drops every game | `server.ts` | persist sessions/games (e.g. Redis) |
| No limit on hello attempts or sessions per IP | `server.ts` | per-IP caps |
| Client always auto-promotes to queen | `src/client/main.ts` | promotion picker |
| Single process, in-memory state | whole server | see README "Scaling beyond one node" |
