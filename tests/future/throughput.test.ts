// TODO(future): implement. See docs/TESTING_ROADMAP.md §2.
// Consider a separate `npm run test:load` script so these don't slow the default run.
import { describe, it } from 'vitest';

describe('throughput & latency', () => {
  it.todo('accepts 1000 concurrent WebSocket connections on one process');
  it.todo('matches 1000 queued clients into 500 games within 2s');
  it.todo('500 concurrent games each playing a 40-move game: p99 move round-trip < 50ms on localhost');
  it.todo('sustains >= 5000 moves/sec aggregate without event-loop delay p99 > 20ms');
  it.todo('a burst of 1000 simultaneous join_queue messages never pairs a player twice');
});
