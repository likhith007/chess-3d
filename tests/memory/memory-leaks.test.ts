import { createHook } from 'node:async_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type ChessServer, type ServerOptions } from '../../src/server/server.ts';
import { TestClient } from '../helpers/test-client.ts';

// Requires --expose-gc (set in vitest.config.ts via test.execArgv).
const gc = globalThis.gc;
if (!gc) throw new Error('memory tests need node --expose-gc');

/** macOS only queues 128 pending connections (kern.ipc.somaxconn), so connect in small batches. */
const BATCH = 50;

let server: ChessServer | null = null;
const open = new Set<TestClient>();

async function start(opts: Partial<ServerOptions> = {}): Promise<ChessServer> {
  server = await startServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 50, ...opts });
  return server;
}

afterEach(async () => {
  await Promise.all([...open].map((c) => c.close()));
  open.clear();
  await server?.close();
  server = null;
});

async function connect(name = 'p', opts: { hello?: boolean; autoPong?: boolean } = {}): Promise<TestClient> {
  const c = await TestClient.connect(`ws://127.0.0.1:${server!.port}/ws`, { autoPong: opts.autoPong });
  open.add(c);
  if (opts.hello ?? true) {
    c.send({ type: 'hello', name });
    await c.next('welcome');
  }
  return c;
}

async function close(...clients: TestClient[]): Promise<void> {
  await Promise.all(clients.map((c) => c.close()));
  for (const c of clients) open.delete(c);
}

/** Matches two already-identified clients and returns them as [white, black]. */
async function pair(a: TestClient, b: TestClient): Promise<[TestClient, TestClient]> {
  a.send({ type: 'join_queue' });
  await a.next('queued');
  b.send({ type: 'join_queue' });
  const [sa] = await Promise.all([a.next('game_start'), b.next('game_start')]);
  return sa.color === 'w' ? [a, b] : [b, a];
}

/** One move then a resignation: exercises move history, broadcast and game teardown. */
async function playShortGame(white: TestClient, black: TestClient): Promise<void> {
  white.send({ type: 'move', from: 'e2', to: 'e4' });
  await Promise.all([white.next('move_made'), black.next('move_made')]);
  black.send({ type: 'resign' });
  await Promise.all([white.next('game_over'), black.next('game_over')]);
}

/** Full lifecycle of one game with fresh connections: connect, play, exit. */
async function gameWithFreshPlayers(): Promise<void> {
  const [a, b] = await Promise.all([connect('a'), connect('b')]);
  const [white, black] = await pair(a, b);
  await playShortGame(white, black);
  await close(white, black);
}

/**
 * Runs `count` games, `concurrency` at a time. Matching is serialised because the queue is
 * global: two pairs matching at once could cross-pair.
 */
async function runGames(count: number, concurrency = 25): Promise<void> {
  for (let done = 0; done < count; done += concurrency) {
    const n = Math.min(concurrency, count - done);
    const players = await Promise.all(Array.from({ length: n * 2 }, (_, i) => connect(`p${i}`)));
    const games: [TestClient, TestClient][] = [];
    for (let i = 0; i < players.length; i += 2) games.push(await pair(players[i]!, players[i + 1]!));
    await Promise.all(games.map(([w, b]) => playShortGame(w, b)));
    await close(...players);
  }
}

const zeroStats = { connections: 0, players: 0, queued: 0, games: 0 };

async function drained(): Promise<void> {
  await expect.poll(() => server!.stats(), { timeout: 2000 }).toEqual(zeroStats);
}

/** Heap used after letting sockets finish closing and forcing full GCs. */
async function settledHeap(): Promise<number> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc!();
  }
  return process.memoryUsage().heapUsed;
}

const MB = 1024 * 1024;

describe('memory leaks', () => {
  it('server.stats() returns to zero after 1000 clients connect, play, and disconnect', async () => {
    await start();
    await runGames(500);
    await drained();
  }, 30_000);

  it('heap after GC returns to within 5% of baseline after 10k completed games', async () => {
    await start();
    await runGames(1000); // Warm-up: JIT, lazily allocated buffers, Map growth.
    await drained();
    const baseline = await settledHeap();

    await runGames(10_000);
    await drained();
    const after = await settledHeap();

    console.log(`10k games: baseline ${(baseline / MB).toFixed(1)}MB, after ${(after / MB).toFixed(1)}MB`);
    expect(after).toBeLessThan(baseline * 1.05);
  }, 120_000);

  it('heap is stable when clients connect/disconnect in a loop without ever queueing', async () => {
    await start();
    const churn = async (rounds: number) => {
      for (let i = 0; i < rounds; i += BATCH) {
        // Half identify, half leave before saying hello: both paths must clean up.
        const batch = await Promise.all(
          Array.from({ length: BATCH }, (_, j) => connect(`c${j}`, { hello: j % 2 === 0 })),
        );
        await close(...batch);
      }
    };
    await churn(1000);
    await drained();
    const baseline = await settledHeap();

    await churn(10_000);
    await drained();
    const after = await settledHeap();

    console.log(`10k connects: baseline ${(baseline / MB).toFixed(1)}MB, after ${(after / MB).toFixed(1)}MB`);
    expect(after).toBeLessThan(baseline * 1.05);
  }, 60_000);

  it('games abandoned mid-move (both sides drop simultaneously) are removed', async () => {
    await start({ reconnectGraceMs: 50 });
    const games: [TestClient, TestClient][] = [];
    for (let i = 0; i < 50; i++) games.push(await pair(await connect('w'), await connect('b')));
    expect(server!.stats().games).toBe(50);

    // A move is in flight when both players vanish in the same tick.
    for (const [white] of games) white.send({ type: 'move', from: 'e2', to: 'e4' });
    await close(...games.flat());

    await drained();
  });

  it('no listeners accumulate on long-lived sockets that play many consecutive games', async () => {
    await start();
    const [a, b] = await Promise.all([connect('a'), connect('b')]);
    const events = ['message', 'close', 'pong', 'error'] as const;
    const listenerCounts = () =>
      [...server!.sockets()].map((ws) => events.map((e) => ws.listenerCount(e)).join(',')).sort();

    const [w1, b1] = await pair(a, b);
    await playShortGame(w1, b1);
    const before = listenerCounts();

    for (let i = 0; i < 200; i++) {
      const [w, bl] = await pair(a, b);
      await playShortGame(w, bl);
    }

    expect(listenerCounts()).toEqual(before);
    expect(server!.stats()).toEqual({ connections: 2, players: 2, queued: 0, games: 0 });
  }, 20_000);

  it('heartbeat terminates unresponsive sockets and frees their session', async () => {
    await start({ heartbeatMs: 50, reconnectGraceMs: 50 });
    const healthy = await connect('healthy');
    await connect('idle-ghost', { autoPong: false });
    const white = await connect('white');
    await pair(white, await connect('ghost', { autoPong: false }));

    // The in-game ghost is dropped, the opponent is told, then the grace period forfeits it.
    expect(await white.next('opponent_status')).toEqual({ type: 'opponent_status', connected: false });
    expect(await white.next('game_over')).toMatchObject({ reason: 'abandoned' });

    // Only the two clients that answer pings survive.
    await expect.poll(() => server!.stats(), { timeout: 2000 }).toEqual({
      connections: 2,
      players: 2,
      queued: 0,
      games: 0,
    });

    // Still alive after several more heartbeats.
    await new Promise((r) => setTimeout(r, 300));
    healthy.send({ type: 'join_queue' });
    await healthy.next('queued');
  });

  it('server.close() clears the heartbeat and grace timers and leaves no open handles', async () => {
    // Track every timer and TCP handle created while the server runs, with the stack that made it.
    const live = new Map<number, string>();
    const hook = createHook({
      init(id, type) {
        if (type === 'Timeout' || type.startsWith('TCP')) live.set(id, `${type}${new Error().stack}`);
      },
      destroy(id) {
        live.delete(id);
      },
    });
    hook.enable();
    try {
      await start({ heartbeatMs: 10_000, reconnectGraceMs: 10_000 });
      const [white, black] = await pair(await connect('w'), await connect('b'));
      await close(black); // Leaves a pending 10s grace timer on the server.
      await white.next('opponent_status');
      await connect('idle');

      await server!.close();
      server = null;
      await Promise.all([...open].map((c) => c.closed));
      open.clear();
      await settledHeap();
    } finally {
      hook.disable();
    }
    expect([...live.values()].filter((s) => s.includes('/src/server/'))).toEqual([]);
  });
});
