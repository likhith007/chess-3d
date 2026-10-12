import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type ChessServer } from '../../src/server/server.ts';
import { TestClient } from '../helpers/test-client.ts';

const GRACE_MS = 150;

let server: ChessServer;
let clients: TestClient[] = [];

async function rawConnect(): Promise<TestClient> {
  const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  clients.push(c);
  return c;
}

/** Connects and completes the hello handshake. */
async function connect(name: string, token?: string): Promise<{ client: TestClient; token: string }> {
  const client = await rawConnect();
  client.send({ type: 'hello', name, ...(token && { token }) });
  const welcome = await client.next('welcome');
  return { client, token: welcome.token };
}

interface Player {
  client: TestClient;
  token: string;
}

/** Connects two players, matches them and returns them as [white, black]. */
async function startGame(): Promise<[Player, Player]> {
  const a = await connect('Alice');
  const b = await connect('Bob');
  a.client.send({ type: 'join_queue' });
  await a.client.next('queued');
  b.client.send({ type: 'join_queue' });
  const [sa, sb] = await Promise.all([a.client.next('game_start'), b.client.next('game_start')]);
  expect(sa.gameId).toBe(sb.gameId);
  expect(new Set([sa.color, sb.color])).toEqual(new Set(['w', 'b']));
  return sa.color === 'w' ? [a, b] : [b, a];
}

beforeEach(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: GRACE_MS });
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await server.close();
});

describe('chess server', () => {
  it('answers health checks over HTTP', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(res.status).toBe(200);
  });

  describe('identity', () => {
    it('requires hello before anything else', async () => {
      const c = await rawConnect();
      c.send({ type: 'join_queue' });
      expect(await c.next('error')).toMatchObject({ message: 'not_identified' });
    });

    it('welcomes a player with a session token and trimmed name', async () => {
      const c = await rawConnect();
      c.send({ type: 'hello', name: '  Alice ' });
      const welcome = await c.next('welcome');
      expect(welcome.name).toBe('Alice');
      expect(welcome.token).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('rejects an invalid name', async () => {
      const c = await rawConnect();
      c.send({ type: 'hello', name: '' });
      expect(await c.next('error')).toMatchObject({ message: 'bad_message' });
    });

    it('issues a fresh token for an unknown one', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const { token } = await connect('Alice', unknown);
      expect(token).not.toBe(unknown);
    });

    it('a second connection with the same token takes over the session', async () => {
      const first = await connect('Alice');
      const second = await connect('Alice', first.token);
      expect(second.token).toBe(first.token);
      expect(await first.client.closed).toBe(4000);
      second.client.send({ type: 'join_queue' });
      await second.client.next('queued');
    });
  });

  describe('gameplay', () => {
    it('game_start carries both names and a fresh game snapshot', async () => {
      const a = await connect('Carol');
      const b = await connect('Dave');
      a.client.send({ type: 'join_queue' });
      await a.client.next('queued');
      b.client.send({ type: 'join_queue' });
      const start = await a.client.next('game_start');
      expect(new Set([start.white, start.black])).toEqual(new Set(['Carol', 'Dave']));
      expect(start).toMatchObject({ moves: [], lastMove: null, check: false, opponentConnected: true });
    });

    it("plays fool's mate end to end", async () => {
      const [white, black] = await startGame();
      const moves: [Player, string, string][] = [
        [white, 'f2', 'f3'],
        [black, 'e7', 'e5'],
        [white, 'g2', 'g4'],
        [black, 'd8', 'h4'],
      ];
      for (const [player, from, to] of moves) {
        player.client.send({ type: 'move', from, to });
        const [mw, mb] = await Promise.all([white.client.next('move_made'), black.client.next('move_made')]);
        expect(mw).toEqual(mb);
        expect(mw).toMatchObject({ from, to });
      }
      const overs = await Promise.all([white.client.next('game_over'), black.client.next('game_over')]);
      for (const o of overs) expect(o).toMatchObject({ result: '0-1', reason: 'checkmate' });
    });

    it('rejects an out-of-turn move with an error', async () => {
      const [, black] = await startGame();
      black.client.send({ type: 'move', from: 'e7', to: 'e5' });
      expect(await black.client.next('error')).toMatchObject({ message: 'not_your_turn' });
    });

    it('rejects malformed messages without dropping the connection', async () => {
      const { client } = await connect('Alice');
      client.sendRaw('garbage');
      expect(await client.next('error')).toMatchObject({ message: 'bad_message' });
      client.send({ type: 'join_queue' });
      await client.next('queued');
    });

    it('rejects moves when not in a game', async () => {
      const { client } = await connect('Alice');
      client.send({ type: 'move', from: 'e2', to: 'e4' });
      expect(await client.next('error')).toMatchObject({ message: 'not_in_game' });
    });

    it('resignation ends the game for both players', async () => {
      const [white, black] = await startGame();
      white.client.send({ type: 'resign' });
      const overs = await Promise.all([white.client.next('game_over'), black.client.next('game_over')]);
      for (const o of overs) expect(o).toMatchObject({ result: '0-1', reason: 'resignation' });
    });

    it('players can queue again after a game ends', async () => {
      const [white, black] = await startGame();
      white.client.send({ type: 'resign' });
      await Promise.all([white.client.next('game_over'), black.client.next('game_over')]);
      white.client.send({ type: 'join_queue' });
      await white.client.next('queued');
      black.client.send({ type: 'join_queue' });
      await Promise.all([white.client.next('game_start'), black.client.next('game_start')]);
    });
  });

  describe('legal moves and check', () => {
    it('returns legal destination squares for the side to move', async () => {
      const [white] = await startGame();
      white.client.send({ type: 'legal_moves', from: 'g1' });
      const reply = await white.client.next('legal_moves');
      expect(reply.from).toBe('g1');
      expect([...reply.to].sort()).toEqual(['f3', 'h3']);
    });

    it('refuses legal_moves out of turn or outside a game', async () => {
      const [, black] = await startGame();
      black.client.send({ type: 'legal_moves', from: 'g8' });
      expect(await black.client.next('error')).toMatchObject({ message: 'not_your_turn' });
      const { client } = await connect('Loner');
      client.send({ type: 'legal_moves', from: 'e2' });
      expect(await client.next('error')).toMatchObject({ message: 'not_in_game' });
    });

    it('flags check on move_made for both players and in the reconnect snapshot', async () => {
      const [white, black] = await startGame();
      const play = async (p: Player, from: string, to: string) => {
        p.client.send({ type: 'move', from, to });
        return (await Promise.all([white.client.next('move_made'), black.client.next('move_made')]))[1];
      };
      expect(await play(white, 'e2', 'e4')).toMatchObject({ check: false });
      expect(await play(black, 'f7', 'f5')).toMatchObject({ check: false });
      const checking = await play(white, 'd1', 'h5');
      expect(checking).toMatchObject({ san: 'Qh5+', check: true });

      await black.client.close();
      const back = await connect('Bob', black.token);
      expect(await back.client.next('game_start')).toMatchObject({ check: true });
    });
  });

  describe('disconnects and reconnects', () => {
    it('tells the opponent, then forfeits after the grace period', async () => {
      const [white, black] = await startGame();
      await black.client.close();
      expect(await white.client.next('opponent_status')).toEqual({ type: 'opponent_status', connected: false });
      expect(await white.client.next('game_over')).toMatchObject({ result: '1-0', reason: 'abandoned' });
    });

    it('reconnecting within the grace period resumes the game', async () => {
      const [white, black] = await startGame();
      white.client.send({ type: 'move', from: 'e2', to: 'e4' });
      await black.client.next('move_made');
      await black.client.close();
      await white.client.next('opponent_status');

      const back = await connect('Bob', black.token);
      expect(back.token).toBe(black.token);
      const snapshot = await back.client.next('game_start');
      expect(snapshot).toMatchObject({
        color: 'b',
        moves: ['e4'],
        lastMove: ['e2', 'e4'],
        opponentConnected: true,
      });
      expect(await white.client.next('opponent_status')).toEqual({ type: 'opponent_status', connected: true });

      // Game continues and does not get forfeited when the grace timer would have fired.
      back.client.send({ type: 'move', from: 'e7', to: 'e5' });
      await white.client.next('move_made');
      await new Promise((r) => setTimeout(r, GRACE_MS * 2));
      expect(server.stats().games).toBe(1);
    });

    it('a token is forgotten once its grace period expires', async () => {
      const [white, black] = await startGame();
      await black.client.close();
      await white.client.next('game_over');
      const back = await connect('Bob', black.token);
      expect(back.token).not.toBe(black.token);
    });

    it('a player who leaves the queue is removed from it', async () => {
      const { client } = await connect('Alice');
      client.send({ type: 'join_queue' });
      await client.next('queued');
      await client.close();
      await expect.poll(() => server.stats().queued).toBe(0);
    });

    it('cleans up all state once everyone leaves', async () => {
      const [white, black] = await startGame();
      const lonely = await connect('Eve');
      lonely.client.send({ type: 'join_queue' });
      await lonely.client.next('queued');
      await Promise.all([white.client.close(), black.client.close(), lonely.client.close()]);
      await expect
        .poll(() => server.stats())
        .toEqual({ connections: 0, players: 0, queued: 0, games: 0 });
    });
  });
});
