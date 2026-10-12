/* =====================================================================
   Explore: the morphometry workspace.
   ---------------------------------------------------------------------
     left    specimen library (coronal sections of each synthetic lattice),
             metric list, and the active metric's parameters
     centre  the 3-D specimen on a gridded stage
     right   inspector: 2-D sections, readouts, definition
   Only the active metric is mounted (keyed), so switching tears down its
   WebGL views before the next metric builds its own.
   ===================================================================== */

import { useEffect, useState } from "react";
import "./explore.css";
import * as THREE from "three";
import { SP_RAMP, TH_RAMP } from "./bone/colormap";
import { betaForBV, binarize, sortedCopy, VOX_MM } from "./bone/engine";
import { buildModel, MODELS, type ModelId } from "./bone/models";
import { localThickness, smoothInPhase, type Dims } from "./bone/volume";
import { disposeScene } from "./bone/dispose";
import { coronalOutline, planeOutline, VolumeScene } from "./bone/raymarch";
import { attachStudio, createRenderer, destroyRenderer } from "./bone/views";
import { FactorialPaper } from "./factorial";
import { BVPanel, ConnPanel, ThicknessPanel } from "./panels-a";
import { buildNematic, DAPanel, EFPanel, FieldScene } from "./panels-b";
import { DEFAULT_SPECIMEN, SEED, SpecimenCtx, type SpecimenChoice } from "./specimen";
import { schedule } from "./ui";

/** Specimen models, named for the group each stands in for. */
const LIBRARY: { id: ModelId; name: string }[] = [
  { id: "tworod", name: "Test 1" },
  { id: "hybrid", name: "AMB" },
  { id: "braced", name: "HLU-NP" },
  { id: "columns", name: "HLU-HP" },
  { id: "rungs", name: "Test 2" },
  { id: "graph", name: "Isotropic null" },
];

type MetricId = "bv-tv" | "conn-d" | "tb-th" | "tb-sp" | "da" | "ef" | "p2";
const METRIC_LIST: { id: MetricId; sym: string; name: string }[] = [
  { id: "bv-tv", sym: "BV/TV", name: "Bone volume fraction" },
  { id: "conn-d", sym: "Conn.D", name: "Connectivity density" },
  { id: "tb-th", sym: "Tb.Th", name: "Trabecular thickness" },
  { id: "tb-sp", sym: "Tb.Sp", name: "Trabecular separation" },
  { id: "da", sym: "DA", name: "Degree of anisotropy" },
  { id: "ef", sym: "EF", name: "Ellipsoid factor" },
  { id: "p2", sym: "P₂far", name: "Strut order by depth" },
];

const D: Dims = [64, 64, 64];

type Thumb = { scene: THREE.Scene; camera: THREE.PerspectiveCamera };

/**
 * Renders a list of small preview scenes with one short-lived WebGL renderer (one scene per
 * scheduled task) and returns them as image URLs. The renderer is released once all are done.
 */
function useThumbs<K extends string>(jobs: { key: K; make: () => Thumb }[], delay: number) {
  const [urls, setUrls] = useState<Partial<Record<K, string>>>({});
  useEffect(() => {
    let r: THREE.WebGLRenderer | null = null;
    let left = jobs.length;
    let alive = true;
    const t = window.setTimeout(() => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 168;
        r = createRenderer(c);
        r.setSize(168, 168, false);
      } catch {
        return;
      }
      for (const j of jobs)
        schedule(() => {
          if (!alive || !r) return;
          const { scene, camera } = j.make();
          attachStudio(scene, r);
          camera.aspect = 1;
          camera.updateProjectionMatrix();
          r.render(scene, camera);
          const url = r.domElement.toDataURL();
          disposeScene(scene);
          setUrls((p) => ({ ...p, [j.key]: url }));
          if (--left === 0) {
            destroyRenderer(r);
            r = null;
          }
        });
    }, delay);
    return () => {
      alive = false;
      clearTimeout(t);
      if (r) destroyRenderer(r);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return urls;
}

const bvOf = (id: ModelId) => MODELS.find((x) => x.id === id)!.bv;

/** Specimen previews: each model at its typical BV/TV. */
const SPEC_JOBS = LIBRARY.map((m) => ({
  key: m.id,
  make: (): Thumb => {
    const q = buildModel(m.id, SEED, D, 1).combine(0.85);
    const vs = new VolumeScene(D, { dist: 3.9 });
    vs.setQ(q);
    vs.set({ uBeta: betaForBV(sortedCopy(q), bvOf(m.id)), uSteps: 260 });
    return vs;
  },
}));

/** Metric previews: the default specimen drawn the way each metric sees it. */
const METRIC_JOBS: { key: MetricId; make: () => Thumb }[] = (() => {
  const base = () => {
    const q = buildModel("tworod", SEED, D, 1).combine(0.85);
    return { q, beta: betaForBV(sortedCopy(q), bvOf("tworod")) };
  };
  const plain = (planes: boolean) => () => {
    const { q, beta } = base();
    const vs = new VolumeScene(D, { dist: 3.9 });
    vs.setQ(q);
    vs.set({ uBeta: beta, uSteps: 260 });
    if (planes) vs.scene.add(planeOutline(0, 0.6, 0x16181d, 0.9, 0.012));
    else vs.scene.add(planeOutline(0, 0.6, 0x16181d, 0.9, 0.012), coronalOutline(0, 0.6, 0x16181d, 0.4, 0.01));
    return vs;
  };
  const thick = (fg: 0 | 1) => () => {
    const { q, beta } = base();
    const bone = binarize(q, beta);
    const max = fg ? 0.5 : 1.7;
    const lt = smoothInPhase(localThickness(bone, D, fg), bone, fg, D).map((v) => (v * VOX_MM) / max);
    const vs = new VolumeScene(D, { dist: 4.2, ramp: fg ? TH_RAMP : SP_RAMP });
    vs.setQ(q);
    vs.setLT(lt);
    vs.set({ uBeta: beta, uMode: 1, uPhase: fg ? 1 : -1, uSteps: 260 });
    return vs;
  };
  return [
    { key: "bv-tv", make: plain(true) },
    { key: "conn-d", make: plain(false) },
    { key: "tb-th", make: thick(1) },
    { key: "tb-sp", make: thick(0) },
    {
      key: "da",
      make: () => {
        const q = buildModel("tworod", SEED, D, 3.2).combine(0.85);
        const vs = new VolumeScene(D, { dist: 3.9 });
        vs.setQ(q);
        vs.set({ uBeta: betaForBV(sortedCopy(q), 0.18), uSteps: 260 });
        return vs;
      },
    },
    {
      key: "ef",
      make: () => {
        const q = buildModel("tworod", SEED, D, 2.2).combine(0.85);
        const beta = betaForBV(sortedCopy(q), bvOf("tworod"));
        const F = new FieldScene(D, false);
        buildNematic(F, q, binarize(q, beta), D, beta, false);
        F.camera.position.multiplyScalar(0.95);
        return F;
      },
    },
    {
      key: "p2",
      make: () => {
        // strut order by depth: ellipsoids grow from sphere (random) to tall (ordered), ivory to gold
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x625a50, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(-1, 2.2, 1.4);
        scene.add(key);
        const ivory = new THREE.Color("#ece6d8");
        const gold = new THREE.Color("#c8902e");
        const geo = new THREE.SphereGeometry(1, 48, 32);
        const n = 4;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const q = 0.9 * t; // 2 x P2 for P2 0 .. 0.45
          const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: ivory.clone().lerp(gold, t), roughness: 0.5, metalness: 0.15 }));
          m.scale.set(0.2 * Math.sqrt(1 - q * 0.5), 0.2 * Math.sqrt(1 + 2 * q), 0.2 * Math.sqrt(1 - q * 0.5));
          m.position.x = (i - (n - 1) / 2) * 0.5;
          scene.add(m);
        }
        const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
        camera.position.set(0.3, 0.55, 4.2);
        camera.lookAt(0, 0, 0);
        return { scene, camera };
      },
    },
  ];
})();

function Metric({ id }: { id: MetricId }) {
  switch (id) {
    case "bv-tv":
      return <BVPanel />;
    case "conn-d":
      return <ConnPanel />;
    case "tb-th":
      return <ThicknessPanel kind="th" />;
    case "tb-sp":
      return <ThicknessPanel kind="sp" />;
    case "da":
      return <DAPanel />;
    case "ef":
      return <EFPanel />;
    case "p2":
      return (
        <div className="ws-wide">
          <FactorialPaper num="" />
        </div>
      );
  }
}

export function Explore() {
  const [spec, setSpec] = useState<SpecimenChoice>(DEFAULT_SPECIMEN);
  const [metric, setMetric] = useState<MetricId>("bv-tv");
  const thumbs = useThumbs(SPEC_JOBS, 400);
  const mthumbs = useThumbs(METRIC_JOBS, 900);
  const usesSpecimen = metric !== "p2";

  return (
    <div className="ws-app">
      <header className="ws-top">
        <h1>Interactive Trabecular Bone Morphometry Sandbox</h1>
      </header>

      <div className={`ws ${metric === "p2" ? "ws-p2" : ""}`}>
        <nav className="ws-nav" aria-label="Specimen">
          <section className={usesSpecimen ? "" : "off"}>
            <h4 className="ws-h">Specimen</h4>
            <div className="ws-lib" role="radiogroup" aria-label="Specimen lattice">
              {LIBRARY.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={spec.model === m.id}
                  disabled={!usesSpecimen}
                  title={MODELS.find((x) => x.id === m.id)!.note}
                  className={spec.model === m.id ? "on" : ""}
                  onClick={() => setSpec({ ...spec, model: m.id, bv: MODELS.find((x) => x.id === m.id)!.bv })}
                >
                  <span className="ws-lib-img">{thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : <i />}</span>
                  <span className="ws-lib-name">{m.name}</span>
                </button>
              ))}
            </div>
            {spec.model === "braced" && usesSpecimen && (
              <label className="ws-rung">
                <span>
                  Rung retention <b>{Math.round(spec.rung * 100)} %</b>
                </span>
                <input type="range" min={0} max={1} step={0.05} value={spec.rung} onChange={(e) => setSpec({ ...spec, rung: +e.target.value })} />
              </label>
            )}
          </section>

        </nav>

        <div className="ws-mnav">
          <h4 className="ws-h">Metric</h4>
          <div className="ws-lib" role="tablist" aria-label="Metric">
            {METRIC_LIST.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={metric === m.id} title={m.name} className={metric === m.id ? "on" : ""} onClick={() => setMetric(m.id)}>
                <span className="ws-lib-img">{mthumbs[m.id] ? <img src={mthumbs[m.id]} alt="" /> : <i />}</span>
                <span className="ws-lib-name">{m.sym}</span>
              </button>
            ))}
          </div>
        </div>

        <SpecimenCtx.Provider value={spec}>
          <Metric key={metric} id={metric} />
        </SpecimenCtx.Provider>

        {usesSpecimen && (
          <p className="ws-stamp">64³ voxels · 65 µm · 4.16 mm field</p>
        )}
      </div>
    </div>
  );
}
