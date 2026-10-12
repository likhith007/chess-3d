import { describe, expect, it } from 'vitest';
import { reconnectDelay } from '../../src/client/reconnect.ts';

describe('reconnectDelay', () => {
  it('grows exponentially from 500ms', () => {
    expect(reconnectDelay(0, () => 1)).toBe(500);
    expect(reconnectDelay(1, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 1)).toBe(4000);
  });

  it('caps at 10s', () => {
    expect(reconnectDelay(20, () => 1)).toBe(10_000);
  });

  it('applies full jitter so clients do not reconnect in lockstep', () => {
    expect(reconnectDelay(3, () => 0)).toBe(0);
    expect(reconnectDelay(3, () => 0.5)).toBe(2000);
  });
});
