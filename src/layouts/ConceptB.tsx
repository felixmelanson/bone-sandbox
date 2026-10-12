/* =====================================================================
   B · Specimen plate
   ---------------------------------------------------------------------
   One object on white, and the notes kept strictly to the side. The
   stage is centred and quiet: a masthead, a six item channel strip with
   a single accent underline, then the specimen with the specimen name,
   the channel name and the one number set at its four corners. Lede
   under it, controls on a rule at the foot. The sheet on the right
   reads as an appendix: numbered blocks, definitions, live values,
   sections and the evidence from the study.
   ===================================================================== */

import { MODELS } from "../bone/models";
import { Viewer } from "../bone/views";
import { ChannelControls, ContextFigure, SpecSliders, SpecimenPicker } from "./controls";
import { AMB_REF, G, METRIC_ORDER, THIN_ROWS, useLab, useSpecimenShelf } from "./lab";
import { Field, Finding, LegendBar, SectionStack, Stat } from "./parts";

const gThick = (G.tbth_um as Record<string, number>)?.["2"];

function Notes({ lab, thumbs }: { lab: ReturnType<typeof useLab>; thumbs: Record<string, string> }) {
  const model = MODELS.find((m) => m.id === lab.model)!;
  const sections = lab.thick
    ? [{ raster: lab.px, label: `${lab.thick.label} at the plane`, note: "colour" }]
    : [
        { raster: lab.px, label: "Axial section", note: "centre plane" },
        { raster: lab.pxCor, label: "Coronal section", note: "centre plane" },
      ];

  return (
    <aside className="lg-b-notes">
      <div className="lg-b-sheet-head">
        <div className="k">
          <p className="lg-kicker">Specimen</p>
          <p className="lg-kicker num">{lab.meta.num}</p>
        </div>
        <p className="lg-h serif" style={{ fontSize: 18, marginTop: 6 }}>
          {model.name}
        </p>
        <p className="lg-p" style={{ marginTop: 4 }}>
          {model.note}.
        </p>
        <div className="lg-pick-row" style={{ marginTop: 12 }}>
          <SpecimenPicker lab={lab} thumbs={thumbs} />
        </div>
      </div>

      <div className="lg-b-block">
        <div className="lg-b-block-h">
          <i>01</i>
          <span>Definition</span>
        </div>
        <div className="lg-prose lg-p">{lab.info.short}</div>
      </div>

      <div className="lg-b-block">
        <div className="lg-b-block-h">
          <i>02</i>
          <span>{lab.meta.sym} in this run</span>
        </div>
        {lab.rows.map((r) => (
          <Field key={r.label} label={r.label} value={r.value} unit={r.unit} />
        ))}
        <Field label="Voxel" value="65" unit="µm" />
        <p className="lg-b-tip">{lab.tip}</p>
      </div>

      <div className="lg-b-block">
        <div className="lg-b-block-h">
          <i>03</i>
          <span>Sections</span>
        </div>
        <div className={`lg-a-sections ${sections.length === 1 ? "is-one" : ""}`}>
          {sections.map((s) => (
            <SectionStack key={s.label} items={[s]} R={lab.sectionR} />
          ))}
        </div>
      </div>

      <div className="lg-b-block">
        <div className="lg-b-block-h">
          <i>04</i>
          <span>In the study</span>
        </div>
        <ContextFigure metric={lab.metric} w={400} />
        {lab.metric === "tb-th" && (
          <Finding num={`${THIN_ROWS[1].value.toFixed(2)}×`} unit={`g ${gThick}`}>
            Thickness in the outer 0.5 to 1.0 mm of unloaded bone against ambulatory bone of the same depth. The deficit is uniform across orientations, so it
            is thinning rather than struts changing direction.
          </Finding>
        )}
        {lab.metric === "bv-tv" && <p className="lg-b-tip">Descriptive study values, {AMB_REF.n} ambulatory rat-strata. Not a model fit.</p>}
      </div>
    </aside>
  );
}

export function ConceptB() {
  const lab = useLab();
  const thumbs = useSpecimenShelf();
  const model = MODELS.find((m) => m.id === lab.model)!;
  const info = lab.info;

  return (
    <div className="lg-b">
      <section className="lg-b-stage">
        <div className="lg-b-masthead">
          <p className="serif">Trabecular bone morphometry, an interactive sandbox</p>
          <p className="lg-kicker">Synthetic specimen · seed 2203</p>
        </div>

        <nav className="lg-b-tabs" aria-label="Parameter">
          {METRIC_ORDER.map((m) => (
            <button key={m.id} type="button" aria-pressed={lab.metric === m.id} onClick={() => lab.setMetric(m.id)} className={lab.metric === m.id ? "on" : ""}>
              <i className="num">{m.num}</i>
              {m.sym}
            </button>
          ))}
        </nav>

        <div className="lg-b-body">
          <div className="lg-b-plate">
            <div className="lg-view">
              <Viewer key={lab.metric === "ef" ? "ef" : lab.frontal ? "front" : "main"} view={lab.view} interactive={!lab.frontal} alt={`Specimen shown for ${lab.meta.name}`} />
            </div>
            <div className="lg-b-plate-tag">
              <p className="serif">{model.name}</p>
              <span className="num">64³ voxels · 65 µm · 4.16 mm</span>
            </div>
            <div className="lg-b-plate-ch">
              <p className="lg-kicker">{lab.meta.sym}</p>
              <p className="serif">{lab.meta.name}</p>
            </div>
            <div className="lg-b-plate-v">
              <Stat label={lab.primary.label} value={lab.primary.value} unit={lab.primary.unit} size="lg" />
              <span className="lg-a-hud-sub">{lab.secondary}</span>
            </div>
            <p className="lg-b-plate-note">
              {info.abbr} · {lab.tip}
            </p>
            {lab.busy && <span className="lg-busy">computing…</span>}
          </div>

          <p className="lg-b-lede">
            <b>{lab.meta.blurb}</b> The specimen is rebuilt from the voxels whenever the controls change, so every number on this plate was measured on the
            structure in front of you.
          </p>

          <div className="lg-b-controls">
            <SpecSliders lab={lab} />
            <div className="lg-b-controls-wide">
              <span className="lg-kicker">Channel · {lab.meta.sym}</span>
              <ChannelControls lab={lab} />
              {lab.thick && (
                <div className="lg-b-legend" style={{ marginLeft: "auto" }}>
                  <LegendBar stops={lab.thick.stops} max={lab.thick.max} label={lab.thick.label} sweep={lab.sweep} band={lab.thick.band} />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Notes lab={lab} thumbs={thumbs} />
    </div>
  );
}
