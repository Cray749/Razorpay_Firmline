// lib/test-utils/harness.ts — shared minimal test harness used by every *.test.ts
// file in this codebase. Deliberately not a full framework (no Jest/Vitest): each
// test file runs its own assertions at module-load time via `runSuite`, and
// `scripts/run-tests.ts` imports every *.test.ts file and reports pass/fail.

export function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
}

export function checkEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`FAILED: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function runSuite(name: string, fn: () => void): void {
  fn();
  console.log(`  PASS  ${name}`);
}
