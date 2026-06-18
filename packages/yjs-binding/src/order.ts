import {
  generateKeyBetween,
  generateNKeysBetween,
} from "@excalidraw/fractional-indexing";

/**
 * Z-order primitives (data-model §3). These are thin wrappers over the fork's
 * **pure**, vendored `@excalidraw/fractional-indexing` base-62 key generator —
 * the same order-preserving scheme the editor uses — kept decoupled from the
 * editor's heavier `fractionalIndex.ts` (which imports `mutateElement` /
 * canvas machinery and mutates `version`/`versionNonce` as a side effect we must
 * own ourselves per OPEN-3). We never invent an ordering scheme: keys are always
 * produced by `generateKeyBetween` / `generateNKeysBetween`, and the collision
 * repair mirrors the editor's `syncInvalidIndices` contract (deterministic,
 * idempotent regeneration of indices that are not strictly increasing).
 */

/**
 * The minimal shape the order helpers read. An `ElementRecord`
 * (`Record<string, unknown>`) is structurally compatible, so callers pass plain
 * element records without casts; the helpers coerce `id`/`index` internally.
 */
type Indexed = Record<string, unknown>;

const readIndex = (el: Indexed): string | null => {
  const idx = el.index;
  return typeof idx === "string" ? idx : null;
};

const readId = (el: Indexed): string => {
  const id = el.id;
  return typeof id === "string" ? id : String(id);
};

/**
 * Order elements by their fractional `index`, ties broken by `id` — identical
 * semantics to the fork's `orderByFractionalIndex`. Pure: returns a new array,
 * does not mutate the input.
 */
export const orderByIndex = <T extends Indexed>(
  elements: readonly T[],
): T[] => {
  return [...elements].sort((a, b) => {
    const ai = readIndex(a);
    const bi = readIndex(b);
    const aid = readId(a);
    const bid = readId(b);
    if (ai != null && bi != null) {
      if (ai < bi) {
        return -1;
      }
      if (ai > bi) {
        return 1;
      }
      // equal index → break ties by id (matches the fork)
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    }
    // keep elements with a defined index ahead of those without, else stable
    if (ai == null && bi == null) {
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    }
    return ai == null ? 1 : -1;
  });
};

/** Generate a fractional key strictly between `prev` and `next` (either may be null). */
export const keyBetween = (
  prev: string | null | undefined,
  next: string | null | undefined,
): string => generateKeyBetween(prev ?? null, next ?? null);

/** Generate `n` distinct fractional keys strictly between `prev` and `next`. */
export const keysBetween = (
  prev: string | null | undefined,
  next: string | null | undefined,
  n: number,
): string[] => generateNKeysBetween(prev ?? null, next ?? null, n);

/**
 * Repair invalid / colliding fractional indices deterministically and
 * idempotently — the binding's equivalent of `syncInvalidIndices` (data-model
 * §3, US3-AC3). Two clients that concurrently insert at the same gap can pick the
 * **same** index; on apply, the elements are first ordered (ties by id, so the
 * resolution is identical on every replica), then any index that is not strictly
 * greater than its predecessor is regenerated to sit strictly between its
 * neighbours.
 *
 * Mutates the `index` field of the affected elements in place and returns the set
 * of element ids whose `index` was changed (so the caller can persist the repair
 * back into the doc under `BINDING_ORIGIN`). Running it again on a repaired array
 * is a no-op (idempotent).
 */
export const repairIndices = <T extends Indexed>(
  elements: readonly T[],
): { ordered: T[]; repaired: Set<string> } => {
  const ordered = orderByIndex(elements);
  const repaired = new Set<string>();

  // `accepted` is the last index we have accepted as valid (the lower bound for
  // the next gap). It starts null (before the first element).
  let accepted: string | null = null;
  let i = 0;
  while (i < ordered.length) {
    const current = readIndex(ordered[i]);

    // Valid iff present and strictly greater than the last accepted index.
    if (current != null && current > (accepted ?? "")) {
      accepted = current;
      i++;
      continue;
    }

    // Collect the contiguous run of invalid elements [i, j): each is missing or
    // not strictly greater than the index that precedes it within the run.
    let j = i;
    let runPrev = accepted;
    while (j < ordered.length) {
      const candidate = readIndex(ordered[j]);
      if (candidate != null && candidate > (runPrev ?? "")) {
        break; // first valid element after the run → the upper bound
      }
      runPrev = candidate;
      j++;
    }

    const upper = j < ordered.length ? readIndex(ordered[j]) : null;
    const keys = keysBetween(accepted, upper, j - i);
    for (let k = i; k < j; k++) {
      (ordered[k] as Record<string, unknown>).index = keys[k - i];
      repaired.add(readId(ordered[k]));
    }
    accepted = keys[keys.length - 1] ?? accepted;
    i = j;
  }

  return { ordered, repaired };
};
