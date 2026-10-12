/** FIFO queue that pairs waiting players. A Set keeps insertion order and O(1) removal. */
export class Matchmaker {
  private readonly waiting = new Set<string>();

  /** Adds a player; returns a pair once two players are waiting. */
  enqueue(playerId: string): [string, string] | null {
    if (this.waiting.has(playerId)) return null;
    for (const other of this.waiting) {
      this.waiting.delete(other);
      return [other, playerId];
    }
    this.waiting.add(playerId);
    return null;
  }

  remove(playerId: string): void {
    this.waiting.delete(playerId);
  }

  size(): number {
    return this.waiting.size;
  }
}
