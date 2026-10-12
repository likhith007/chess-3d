import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../../src/server/matchmaker.ts';

describe('Matchmaker', () => {
  it('waits until two players are queued', () => {
    const mm = new Matchmaker();
    expect(mm.enqueue('a')).toBeNull();
    expect(mm.size()).toBe(1);
    expect(mm.enqueue('b')).toEqual(['a', 'b']);
    expect(mm.size()).toBe(0);
  });

  it('pairs in FIFO order', () => {
    const mm = new Matchmaker();
    mm.enqueue('a');
    expect(mm.enqueue('b')).toEqual(['a', 'b']);
    mm.enqueue('c');
    expect(mm.enqueue('d')).toEqual(['c', 'd']);
  });

  it('ignores duplicate enqueue of the same player', () => {
    const mm = new Matchmaker();
    mm.enqueue('a');
    expect(mm.enqueue('a')).toBeNull();
    expect(mm.size()).toBe(1);
  });

  it('removes a waiting player', () => {
    const mm = new Matchmaker();
    mm.enqueue('a');
    mm.remove('a');
    expect(mm.size()).toBe(0);
    expect(mm.enqueue('b')).toBeNull();
  });
});
