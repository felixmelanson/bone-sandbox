/* Side-by-side specimen concepts to pick from; each loads into the sandbox. */

import { useEffect, useState } from "react";
import { betaForBV, sortedCopy } from "./bone/engine";
import { buildModel, MODELS, type ModelId } from "./bone/models";
import { VolumeScene } from "./bone/raymarch";
import { Viewer } from "./bone/views";
import type { Dims } from "./bone/volume";
import { schedule } from "./ui";

const D: Dims = [64, 64, 64];

function Concept({ id, name, note, bv }: { id: ModelId; name: string; note: string; bv: number }) {
  const [vs, setVs] = useState<VolumeScene | null>(null);
  useEffect(() => {
    schedule(() => {
      const q = buildModel(id, 2203, D, 1).combine(0.85);
      const beta = betaForBV(sortedCopy(q), bv);
      const v = new VolumeScene(D);
      v.setQ(q);
      v.set({ uBeta: beta, uSteps: 360 });
      setVs(v);
    });
  }, [id, bv]);
  return (
    <figure className="concept">
      <div className="concept-view">
        <Viewer view={vs} alt={`${name} specimen concept`} />
      </div>
      <figcaption>
        <p className="concept-name">{name}</p>
        <p className="concept-note">
          {note} · BV/TV {(bv * 100).toFixed(0)} %
        </p>
        <a className="insp-btn" href={`#sandbox?model=${id}`}>
          Use this
        </a>
      </figcaption>
    </figure>
  );
}

export function Concepts() {
  return (
    <main className="page doc">
      <h1 className="page-h">Specimen concepts</h1>
      <p className="mb-6 text-[14px] text-stone-600">Same seed and size for each; struts are cut flat at the cube faces. Drag to rotate. Pick one to load it in the sandbox.</p>
      <div className="concept-grid">
        {MODELS.map((m) => (
          <Concept key={m.id} {...m} />
        ))}
      </div>
    </main>
  );
}
