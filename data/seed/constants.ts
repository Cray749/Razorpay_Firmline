// data/seed/constants.ts — shared constants between the generator and anything
// that needs to reference the seed version without importing generate.ts
// itself (which runs its generation `main()` as a side effect of being
// imported — keep that side effect confined to direct script execution only).
export const SEED_VALUE = 20260810;
export const SEED_VERSION_LABEL = "seed-v1";
