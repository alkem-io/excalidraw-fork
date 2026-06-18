import { describe, expect, it } from "vitest";

import {
  keyBetween,
  keysBetween,
  orderByIndex,
  repairIndices,
} from "../src/order";

import type { ElementRecord } from "../src/schema";

const el = (id: string, index: string | null): ElementRecord => ({ id, index });

describe("order: orderByIndex (T005)", () => {
  it("orders by fractional index, ties broken by id", () => {
    const out = orderByIndex([el("c", "a2"), el("a", "a1"), el("b", "a1")]);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [el("b", "a2"), el("a", "a1")];
    const copy = [...input];
    orderByIndex(input);
    expect(input).toEqual(copy);
  });
});

describe("order: key generation reuses fractional-indexing", () => {
  it("keyBetween produces a key strictly between neighbours", () => {
    const k = keyBetween("a1", "a3");
    expect(k > "a1").toBe(true);
    expect(k < "a3").toBe(true);
  });

  it("keysBetween produces n sorted distinct keys", () => {
    const keys = keysBetween(null, null, 3);
    expect(keys).toHaveLength(3);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("order: repairIndices collision repair (T013/T029)", () => {
  it("repairs two elements that picked the same index (deterministic by id)", () => {
    const a = [el("z", "a1"), el("a", "a1")];
    const { ordered, repaired } = repairIndices(a);
    // tie broken by id → a before z; the later one (z) gets a new strictly-greater index
    expect(ordered.map((e) => e.id)).toEqual(["a", "z"]);
    expect(ordered[0].index! < (ordered[1].index as string)).toBe(true);
    expect(repaired.has("z")).toBe(true);
  });

  it("is idempotent — a second pass repairs nothing", () => {
    const a = [el("z", "a1"), el("a", "a1"), el("m", "a1")];
    const { ordered } = repairIndices(a);
    const second = repairIndices(ordered);
    expect(second.repaired.size).toBe(0);
    expect(second.ordered.map((e) => e.id)).toEqual(ordered.map((e) => e.id));
  });

  it("two replicas with the same colliding set converge to identical order", () => {
    const docA = [el("z", "a1"), el("a", "a1")];
    const docB = [el("a", "a1"), el("z", "a1")]; // different array order
    const ra = repairIndices(docA).ordered;
    const rb = repairIndices(docB).ordered;
    expect(ra.map((e) => `${e.id}:${e.index}`)).toEqual(
      rb.map((e) => `${e.id}:${e.index}`),
    );
  });

  it("seeds indices for elements that have none", () => {
    const a = [el("a", null), el("b", null), el("c", null)];
    const { ordered } = repairIndices(a);
    expect(ordered.every((e) => typeof e.index === "string")).toBe(true);
    const indices = ordered.map((e) => e.index as string);
    expect([...indices].sort()).toEqual(indices);
  });
});
