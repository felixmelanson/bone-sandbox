/* =====================================================================
   Explore: the sandbox as a paper. Title block, then one numbered row per
   section: the figure floats right with its own controls, and the concise
   text wraps around and below it. The specimen chosen in section 1 is
   shared with every metric figure in section 2.
   ===================================================================== */

import { useEffect, useMemo, useState } from "react";
import "./explore.css";
import { betaForBV, mix, renderCoronal, sortedCopy, type QField, type Shade, type V3 } from "./bone/engine";
import { buildModel, MODELS, type ModelId } from "./bone/models";
import { VolumeScene } from "./bone/raymarch";
import { Viewer } from "./bone/views";
import type { Dims } from "./bone/volume";
import { BVPanel, ConnPanel, ThicknessPanel } from "./panels-a";
import { DAPanel, EFPanel } from "./panels-b";
import { DEFAULT_SPECIMEN, getModel, SEED, SpecimenCtx, type SpecimenChoice } from "./specimen";
import { REFERENCES } from "./text";
import { Controls, Readout, Readouts, schedule, Slider, useDebounced, useInView } from "./ui";

const D: Dims = [64, 64, 64];
const BONE: V3 = [238, 234, 224];
const MARROW: V3 = [20, 20, 22];
const shade: Shade = (c) => [mix(MARROW[0], BONE[0], c), mix(MARROW[1], BONE[1], c), mix(MARROW[2], BONE[2], c)];

/** Models on this page, in bracing order, named for the group each stands in for. */
const LIBRARY: { id: ModelId; name: string }[] = [
  { id: "tworod", name: "Two-surface rods" },
  { id: "hybrid", name: "AMB" },
  { id: "braced", name: "HLU-NP" },
  { id: "columns", name: "HLU-HP" },
  { id: "rungs", name: "Over-braced control" },
  { id: "graph", name: "Isotropic null" },
  { id: "mixed", name: "Plate fraction" },
];

function thumb(q: QField, beta: number, R = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = R;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(R, R);
  img.data.set(renderCoronal(q, D, beta, (D[2] - 1) / 2, R, shade));
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/* ------------------------- 1.1 model library -------------------------- */

export function ModelsRow({ spec, setSpec }: { spec: SpecimenChoice; setSpec: (s: SpecimenChoice) => void }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [vs, setVs] = useState<VolumeScene | null>(null);
  const [sorted, setSorted] = useState<Float32Array | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<ModelId, string>>>({});
  const { model, rung, a, bv } = spec;

  useEffect(() => {
    if (seen && !vs) schedule(() => setVs(new VolumeScene(D, { dist: 3.35 })));
  }, [seen, vs]);
  useDebounced(
    () => {
      if (!vs) return;
      schedule(() => {
        const q = getModel(model, D, 1, rung).combine(a);
        vs.setQ(q);
        setSorted(sortedCopy(q));
      });
    },
    [vs, model, rung, a],
    60
  );
  useEffect(() => {
    if (vs && sorted) vs.set({ uBeta: betaForBV(sorted, bv) });
  }, [vs, sorted, bv]);
  useEffect(() => {
    if (!seen) return;
    for (const m of LIBRARY)
      schedule(() => {
        // built and dropped here, not cached: seven models held at once is most of the page's memory
        const q = buildModel(m.id, SEED, D, 1).combine(0.85) as QField;
        const typical = MODELS.find((x) => x.id === m.id)!.bv;
        setThumbs((p) => ({ ...p, [m.id]: thumb(q, betaForBV(sortedCopy(q), typical)) }));
      });
  }, [seen]);

  // link census of the strut models: how much of the network is transverse, by count and by strut volume
  const links = useMemo(() => (vs ? getModel(model, D, 1, rung).links : undefined), [vs, model, rung, sorted]);
  const volT = links ? links.volT / (links.volV + links.volO + links.volT) : null;

  return (
    <section id="models" className="og-row wide">
      <header className="og-head">
        <h3 className="og-h">
          <span className="secnum">1.1</span>Synthetic specimens
        </h3>
        <p className="og-abbr">64³ voxels · 65 µm · 4.16 mm cube</p>
      </header>
      <figure className="og-fig">
        <div ref={ref} className="models">
          <div className="fig aspect-square models-view">
            <Viewer view={vs} alt="Selected specimen model" />
          </div>
          <div className="models-grid" role="radiogroup" aria-label="Specimen model">
            {LIBRARY.map((m) => {
              const info = MODELS.find((x) => x.id === m.id)!;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={model === m.id}
                  title={info.note}
                  className={model === m.id ? "on" : ""}
                  onClick={() => setSpec({ ...spec, model: m.id, bv: info.bv })}
                >
                  <span className="models-img">{thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : <i />}</span>
                  <span className="models-name">{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Controls>
          {model === "braced" && (
            <Slider label="Rung retention" hint="transverse links kept" value={rung} min={0} max={1} step={0.05} onChange={(v) => setSpec({ ...spec, rung: v })} format={(v) => `${Math.round(v * 100)} %`} />
          )}
          {links && (
            <Readouts>
              <Readout label="Vertical links" value={String(links.vertical)} />
              <Readout label="Oblique links" value={String(links.oblique)} />
              <Readout label="Transverse links" value={String(links.transverse)} />
              <Readout label="Transverse volume" value={volT !== null ? (volT * 100).toFixed(0) : "-"} unit="%" accent />
            </Readouts>
          )}
        </Controls>
        <figcaption className="og-cap">
          <b>Figure 1.</b> The model library at 64³ voxels and 65 µm. Struts are cut flat at the cube faces; the seven specimens differ only in which links
          are kept and how thick they are. The selection carries through every figure below.
        </figcaption>
      </figure>
      <div className="og-text prose">
        <p>
          Every specimen is a procedural field thresholded into bone, with no imaging noise. The strut models join jittered nodes about 1.1 mm apart
          with tapered rods and differ only in which links are kept and how thick they are. The selection here carries through every figure below.
        </p>
      </div>
    </section>
  );
}

/* ================================ page ================================ */

export function Explore() {
  const [spec, setSpec] = useState<SpecimenChoice>(DEFAULT_SPECIMEN);
  return (
    <main className="page doc xpaper">
      <header className="titleblock">
        <h1>Interactive Trabecular Bone Morphometry Sandbox</h1>
      </header>

      <section className="psec">
        <h2>
          <span className="secnum">1</span>Specimen
        </h2>
        <ModelsRow spec={spec} setSpec={setSpec} />
      </section>

      <SpecimenCtx.Provider value={spec}>
        <section className="psec">
          <h2>
            <span className="secnum">2</span>Standard parameters
          </h2>
          <BVPanel num="2.1" fig={2} />
          <ConnPanel num="2.2" fig={3} />
          <ThicknessPanel kind="th" num="2.3" fig={4} />
          <ThicknessPanel kind="sp" num="2.4" fig={5} />
          <DAPanel num="2.5" fig={6} />
          <EFPanel num="2.6" fig={7} />
        </section>
      </SpecimenCtx.Provider>

      <section className="psec refs-sec">
        <h2>References</h2>
        <ol className="refs">
          {REFERENCES.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
