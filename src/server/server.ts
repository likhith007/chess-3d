import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  parseClientMessage,
  type ClientMessage,
  type GameSnapshot,
  type ServerMessage,
} from '../shared/protocol.ts';
import { Game, type GameOver } from './game.ts';
import { Matchmaker } from './matchmaker.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  /** How often dead connections are detected and dropped. */
  heartbeatMs?: number;
  /** How long a disconnected player has to reconnect before forfeiting their game. */
  reconnectGraceMs?: number;
}

export interface ServerStats {
  connections: number;
  players: number;
  queued: number;
  games: number;
}

export interface ChessServer {
  readonly port: number;
  stats(): ServerStats;
  /** Live server-side sockets, read-only. For diagnostics and leak tests. */
  sockets(): ReadonlySet<WebSocket>;
  close(): Promise<void>;
}

/** A player's session. It outlives any single socket so they can refresh or reconnect. */
interface Player {
  id: string;
  /** Secret the client presents to resume this session. Never sent to other players. */
  token: string;
  name: string;
  ws: WebSocket | null;
  gameId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

// Our largest message is well under 200 bytes; refuse anything bigger.
const MAX_PAYLOAD_BYTES = 1024;
/** Close code sent to a socket whose session was opened somewhere else. */
export const CLOSE_SESSION_REPLACED = 4000;

export function startServer(opts: ServerOptions): Promise<ChessServer> {
  const graceMs = opts.reconnectGraceMs ?? 30_000;
  const players = new Map<string, Player>();
  const playersByToken = new Map<string, Player>();
  const games = new Map<string, Game>();
  const matchmaker = new Matchmaker();
  const alive = new WeakMap<WebSocket, boolean>();
  let closing = false;

  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false, // Compression costs CPU and memory per socket; messages are tiny.
  });

  function sendTo(ws: WebSocket | null | undefined, msg: ServerMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function send(player: Player | undefined, msg: ServerMessage): void {
    sendTo(player?.ws, msg);
  }

  function removePlayer(player: Player): void {
    if (player.graceTimer) clearTimeout(player.graceTimer);
    matchmaker.remove(player.id);
    players.delete(player.id);
    playersByToken.delete(player.token);
  }

  function opponentOf(game: Game, player: Player): Player | undefined {
    const id = game.opponentOf(player.id);
    return id ? players.get(id) : undefined;
  }

  function snapshot(game: Game, player: Player): GameSnapshot {
    return {
      gameId: game.id,
      color: game.colorOf(player.id)!,
      fen: game.fen(),
      white: players.get(game.whiteId)?.name ?? '?',
      black: players.get(game.blackId)?.name ?? '?',
      moves: game.history(),
      lastMove: game.lastMove(),
      check: game.inCheck(),
      opponentConnected: !!opponentOf(game, player)?.ws,
    };
  }

  function endGame(game: Game, over: GameOver): void {
    games.delete(game.id);
    for (const id of [game.whiteId, game.blackId]) {
      const p = players.get(id);
      if (!p) continue;
      p.gameId = null;
      send(p, { type: 'game_over', ...over });
      // Nobody is holding this session open any more.
      if (!p.ws) removePlayer(p);
    }
  }

  function startGame(aId: string, bId: string): void {
    const [whiteId, blackId] = Math.random() < 0.5 ? [aId, bId] : [bId, aId];
    const game = new Game(randomUUID(), whiteId, blackId);
    games.set(game.id, game);
    for (const id of [whiteId, blackId]) players.get(id)!.gameId = game.id;
    for (const id of [whiteId, blackId]) {
      const p = players.get(id)!;
      send(p, { type: 'game_start', ...snapshot(game, p) });
    }
  }

  /** Handles hello: resumes the session for a known token, otherwise creates a new one. */
  function identify(ws: WebSocket, name: string, token: string | undefined): Player {
    const existing = token ? playersByToken.get(token) : undefined;
    if (!existing) {
      const player: Player = { id: randomUUID(), token: randomUUID(), name, ws, gameId: null, graceTimer: null };
      players.set(player.id, player);
      playersByToken.set(player.token, player);
      send(player, { type: 'welcome', name, token: player.token });
      return player;
    }

    const previous = existing.ws;
    existing.ws = ws; // Set first so the old socket's close handler knows it was replaced.
    if (previous && previous !== ws) previous.close(CLOSE_SESSION_REPLACED, 'session_replaced');
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }

    const game = existing.gameId ? games.get(existing.gameId) : undefined;
    if (!game) existing.name = name; // Names are fixed for the duration of a game.
    send(existing, { type: 'welcome', name: existing.name, token: existing.token });
    if (game) {
      send(existing, { type: 'game_start', ...snapshot(game, existing) });
      send(opponentOf(game, existing), { type: 'opponent_status', connected: true });
    }
    return existing;
  }

  function handle(player: Player, msg: Exclude<ClientMessage, { type: 'hello' }>): void {
    const game = player.gameId ? games.get(player.gameId) : undefined;

    switch (msg.type) {
      case 'join_queue': {
        if (game) return send(player, { type: 'error', message: 'already_in_game' });
        const pair = matchmaker.enqueue(player.id);
        if (pair) startGame(...pair);
        else send(player, { type: 'queued' });
        return;
      }
      case 'move': {
        if (!game) return send(player, { type: 'error', message: 'not_in_game' });
        const res = game.move(player.id, msg);
        if (!res.ok) return send(player, { type: 'error', message: res.error });
        const update: ServerMessage = {
          type: 'move_made',
          from: res.from,
          to: res.to,
          san: res.san,
          fen: res.fen,
          check: res.check,
        };
        send(players.get(game.whiteId), update);
        send(players.get(game.blackId), update);
        if (res.over) endGame(game, res.over);
        return;
      }
      case 'legal_moves': {
        if (!game) return send(player, { type: 'error', message: 'not_in_game' });
        const res = game.legalMoves(player.id, msg.from);
        if (!res.ok) return send(player, { type: 'error', message: res.error });
        return send(player, { type: 'legal_moves', from: msg.from, to: res.to });
      }
      case 'resign': {
        if (!game) return send(player, { type: 'error', message: 'not_in_game' });
        const over = game.resign(player.id);
        if (over) endGame(game, over);
        return;
      }
    }
  }

  function onDisconnect(player: Player): void {
    player.ws = null;
    matchmaker.remove(player.id);
    const game = player.gameId ? games.get(player.gameId) : undefined;
    // During shutdown nobody can reconnect, so don't start a grace timer that would outlive us.
    if (!game || closing) return removePlayer(player);

    send(opponentOf(game, player), { type: 'opponent_status', connected: false });
    player.graceTimer = setTimeout(() => {
      player.graceTimer = null;
      const over = game.abandon(player.id);
      if (over) endGame(game, over);
    }, graceMs);
  }

  wss.on('connection', (ws) => {
    let player: Player | null = null;
    alive.set(ws, true);

    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data, isBinary) => {
      const msg = isBinary ? null : parseClientMessage(data.toString());
      if (!msg) return sendTo(ws, { type: 'error', message: 'bad_message' });
      if (msg.type === 'hello') {
        if (player) return sendTo(ws, { type: 'error', message: 'already_identified' });
        player = identify(ws, msg.name, msg.token);
        return;
      }
      if (!player) return sendTo(ws, { type: 'error', message: 'not_identified' });
      handle(player, msg);
    });

    ws.on('close', () => {
      // Ignore sockets that were replaced by a newer connection for the same session.
      if (player && player.ws === ws) onDisconnect(player);
    });
  });

  // Drop connections that stop answering pings (e.g. a client whose network vanished).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 30_000);
  heartbeat.unref();

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : opts.port;
      resolve({
        port,
        stats: () => ({
          connections: wss.clients.size,
          players: players.size,
          queued: matchmaker.size(),
          games: games.size,
        }),
        sockets: () => wss.clients,
        close: () =>
          new Promise<void>((done) => {
            closing = true;
            clearInterval(heartbeat);
            for (const p of players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
            for (const client of wss.clients) client.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}
