/* =====================================================================
   Controls shared by the three concepts: sliders on the glass thumb,
   the specimen picker, and the metric specific cluster.
   ===================================================================== */

import { useId } from "react";
import { GlassSlider } from "../glass";
import { MODELS } from "../bone/models";
import type { Lab } from "./lab";
import { pct, ratPairs, SPLIT_ROWS, THIN_ROWS, type MetricId } from "./lab";
import { DotCompare, SplitRows, ThinRows } from "./parts";

export function LSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="lg-slider">
      <div className="lg-slider-top">
        <span id={id}>
          {label}
          {hint && <i> {hint}</i>}
        </span>
        <b>{format(value)}</b>
      </div>
      <GlassSlider value={value} min={min} max={max} step={step} onChange={onChange} labelledBy={id} valueText={format(value)} />
    </div>
  );
}

/** The three specimen parameters, in a grid the caller sizes. */
export function SpecSliders({ lab }: { lab: Lab }) {
  return (
    <>
      <LSlider label="Bone volume fraction" value={lab.bv} min={0.08} max={0.45} step={0.005} onChange={lab.setBv} format={pct} />
      <LSlider label="Plate perforation" hint="plates to rods" value={lab.a} min={0} max={2.2} step={0.05} onChange={lab.setA} format={(v) => v.toFixed(2)} />
      <LSlider label="Fabric alignment" value={lab.k} min={1} max={3.5} step={0.1} onChange={lab.setK} format={(v) => `${v.toFixed(1)} : 1`} />
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="lg-seg">
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={value === o.v ? "on" : ""}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`lg-switch-btn ${on ? "on" : ""}`}>
      <span aria-hidden="true" />
      {children}
    </button>
  );
}

/** 3 x 3 coronal sections of the model library; selects the specimen. */
export function SpecimenPicker({ lab, thumbs, onPick }: { lab: Lab; thumbs: Record<string, string>; onPick?: () => void }) {
  return (
    <div className="lg-pick" role="radiogroup" aria-label="Specimen model">
      {MODELS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={lab.model === m.id}
          title={`${m.name}: ${m.note}`}
          aria-label={m.name}
          onClick={() => {
            lab.setModel(m.id);
            lab.setBv(m.bv);
            onPick?.();
          }}
          className={lab.model === m.id ? "on" : ""}
        >
          <span className="lg-pick-i">{thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : null}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * What can be changed in this channel, beyond the three specimen
 * parameters: the cut, the colour sweep, the fabric method and its
 * angles. Returns a fragment so each concept can wrap it its own way.
 */
export function ChannelControls({ lab }: { lab: Lab }) {
  const { metric, thick, fabMode, isMil, isSvd } = lab;
  return (
    <>
      {metric === "bv-tv" && (
        <Toggle on={lab.cut} onChange={lab.setCut}>
          Cut at the analysis plane
        </Toggle>
      )}
      {thick && (
        <button type="button" className="lg-link" onClick={lab.play}>
          Sweep the colour scale
        </button>
      )}
      {metric === "da" && (
        <Seg
          label="Fabric method"
          value={fabMode}
          onChange={lab.setFabMode}
          options={[
            { v: "gst", t: "Structure tensor" },
            { v: "mil", t: "MIL" },
            { v: "svd", t: "SVD" },
          ]}
        />
      )}
      {metric === "da" && fabMode === "gst" && (
        <LSlider label="Loading direction" value={lab.psi} min={0} max={180} step={1} onChange={lab.setPsi} format={(v) => `${v.toFixed(0)}°`} />
      )}
      {isMil && (
        <>
          <LSlider label="Test line direction θ" value={lab.theta} min={0} max={180} step={1} onChange={lab.setTheta} format={(v) => `${v.toFixed(0)}°`} />
          <button type="button" className="lg-link" onClick={lab.playMil}>
            Sweep θ
          </button>
        </>
      )}
      {isSvd && (
        <button type="button" className="lg-link" onClick={lab.bumpSvdSeed}>
          New marrow points
        </button>
      )}
    </>
  );
}

/**
 * The evidence figure for a channel, drawn from the same rat data the
 * Results tab reports. One per channel so a concept can show where the
 * setting it is illustrating actually comes from.
 */
export function ContextFigure({ metric, w }: { metric: MetricId; w: number }) {
  if (metric === "tb-th") return <ThinRows rows={THIN_ROWS} w={w} />;
  if (metric === "bv-tv") return <SplitRows rows={SPLIT_ROWS} w={w} />;
  const cfg =
    metric === "conn-d"
      ? ({ key: "tbn_permm", name: "Trabecular number", unit: "mm⁻¹", digits: 1 } as const)
      : metric === "tb-sp"
        ? ({ key: "tbsp_um", name: "Separation", unit: "µm", digits: 0 } as const)
        : metric === "da"
          ? ({ key: "da", name: "Anisotropy", unit: "", digits: 2 } as const)
          : ({ key: "tr_long_ratio", name: "Transverse / long.", unit: "", digits: 2 } as const);
  const { HLU, AMB, lo, hi } = ratPairs(cfg.key);
  return (
    <DotCompare
      w={w}
      lo={lo}
      hi={hi}
      digits={cfg.digits}
      unit={cfg.unit || "no unit"}
      label="S2, 0.5 to 1.0 mm deep"
      groups={[
        { name: "Unloaded", values: HLU, tone: "accent" },
        { name: "Ambulatory", values: AMB },
      ]}
    />
  );
}
