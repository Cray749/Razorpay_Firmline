// data/seed/rng.ts — a small deterministic PRNG (mulberry32) so the synthetic
// batch is reproducible: same seed in -> byte-identical batch out. Do NOT use
// Math.random() anywhere in the generator; every source of randomness must
// flow through an Rng instance created here.

export type Rng = {
  next(): number; // float in [0, 1)
  int(min: number, maxInclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(probabilityTrue: number): boolean;
  shuffle<T>(arr: T[]): T[];
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function int(min: number, maxInclusive: number): number {
    return min + Math.floor(next() * (maxInclusive - min + 1));
  }
  function pick<T>(arr: readonly T[]): T {
    return arr[int(0, arr.length - 1)];
  }
  function bool(probabilityTrue: number): boolean {
    return next() < probabilityTrue;
  }
  function shuffle<T>(arr: T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  return { next, int, pick, bool, shuffle };
}
