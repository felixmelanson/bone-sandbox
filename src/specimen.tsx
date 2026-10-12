/* =====================================================================
   The specimen chosen in section 1 of the paper page, shared with every
   metric figure below it. Built models are cached by their parameters,
   so figures on the same specimen share one build instead of each
   rebuilding it.
   ===================================================================== */

import { createContext, useContext, useEffect, useState } from "react";
import { sortedCopy, type QField } from "./bone/engine";
import { buildModel, MODELS, type ModelBase, type ModelId } from "./bone/models";
import type { Dims } from "./bone/volume";
import { schedule, useDebounced } from "./ui";

export const SEED = 2203;

export type SpecimenChoice = { model: ModelId; rung: number; a: number; bv: number };
export const DEFAULT_SPECIMEN: SpecimenChoice = { model: "tworod", rung: 0.5, a: 0.85, bv: MODELS.find((m) => m.id === "tworod")!.bv };

export const SpecimenCtx = createContext<SpecimenChoice>(DEFAULT_SPECIMEN);
export const useSpecimen = () => useContext(SpecimenCtx);

const cache = new Map<string, ModelBase>();
/** The model's precomputed base for this grid and fabric ratio; `combine(a)` applies the perforation. */
export function getModel(id: ModelId, d: Dims, k = 1, rung = 0.5): ModelBase {
  const key = `${id}|${d.join("x")}|${k}|${id === "braced" ? rung : ""}`;
  let m = cache.get(key);
  if (!m) {
    m = buildModel(id, SEED, d, k, { rung });
    cache.set(key, m);
    if (cache.size > 3) cache.delete(cache.keys().next().value!);
  }
  return m;
}

/**
 * The shared specimen's field on grid `d`, built once `seen` and rebuilt when the choice changes.
 * `a` overrides the perforation (a figure with its own perforation slider); `k` the fabric ratio.
 */
export function useSpecField(seen: boolean, d: Dims, { k = 1, a }: { k?: number; a?: number } = {}) {
  const S = useSpecimen();
  const aa = a ?? S.a;
  const [f, setF] = useState<{ q: QField; sorted: Float32Array } | null>(null);
  useDebounced(
    () => {
      if (!seen) return;
      schedule(() => {
        const q = getModel(S.model, d, k, S.rung).combine(aa) as QField;
        setF({ q, sorted: sortedCopy(q) });
      });
    },
    [seen, S.model, S.rung, aa, k, d[0], d[1], d[2]],
    60
  );
  return f;
}

/** A figure's own BV/TV, starting from (and following) the value chosen in section 1. */
export function useSpecBV() {
  const S = useSpecimen();
  const [bv, setBv] = useState(S.bv);
  useEffect(() => setBv(S.bv), [S.model, S.bv]);
  return [bv, setBv] as const;
}
