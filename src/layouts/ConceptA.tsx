/* =====================================================================
   A · Calibrated sheet
   ---------------------------------------------------------------------
   A three column instrument. The index on the left lists the six
   parameters and the specimen library; the middle column is the stage:
   the viewport with a margin rule that carries the measurement and the
   specimen controls underneath. The right column is the analysis sheet,
   one block per question. Nothing is centred that has no reason to be.
   ===================================================================== */

import { MODELS } from "../bone/models";
import { Viewer } from "../bone/views";
import { ChannelControls, ContextFigure, SpecSliders, SpecimenPicker } from "./controls";
import { AMB_REF, G, METRIC_ORDER, STRATUM22, THIN_ROWS, useLab, useSpecimenShelf, type MetricId } from "./lab";
import { Field, Finding, LegendBar, SectionStack, Stat } from "./parts";

/** A margin rule with ticks: the measurement this layout is named for. */
function MarginTicks({ max, unit }: { max: number; unit: string }) {
  return (
    <div className="lg-a-margin" aria-hidden="true">
      {[1, 0.75, 0.5, 0.25, 0].map((f) => (
        <span key={f} className="lg-a-tick" style={{ top: `${(1 - f) * 100}%` }}>
          <span className="num">{max >= 2 ? (max * f).toFixed(1) : (max * f).toFixed(2)}</span>
        </span>
      ))}
      {unit && <span className="lg-a-margin-u">{unit}</span>}
    </div>
  );
}

function Context({ metric }: { metric: MetricId }) {
  if (metric === "tb-th") {
    const ratio = THIN_ROWS[1].value;
    return (
      <>
        <ContextFigure metric={metric} w={268} />
        <Finding num={`${ratio.toFixed(2)}×`} unit="S2 thickness">
          Trabeculae in the outer 0.5 to 1.0 mm of the unloaded tibia are {(100 - ratio * 100).toFixed(0)} % thinner than ambulatory bone at the same depth
          (Hedges g {G.tbth_um && (G.tbth_um as Record<string, number>)["2"]}).
        </Finding>
      </>
    );
  }
  if (metric === "bv-tv") {
    return (
      <>
        <ContextFigure metric={metric} w={268} />
        <Finding num="70 / 30" unit="% of the loss">
          Most of the bone volume lost in the outer stratum is struts that are gone rather than struts that thinned.
        </Finding>
      </>
    );
  }
  return <ContextFigure metric={metric} w={268} />;
}

export function ConceptA() {
  const lab = useLab();
  const thumbs = useSpecimenShelf();
  const model = MODELS.find((m) => m.id === lab.model)!;
  const s2 = STRATUM22;

  const sections = lab.thick
    ? [{ raster: lab.px, label: `${lab.thick.label} at the plane`, note: "colour" }]
    : [
        { raster: lab.px, label: "Axial", note: "centre plane" },
        { raster: lab.pxCor, label: "Coronal", note: "centre plane" },
      ];

  return (
    <div className="lg-a">
      <aside className="lg-a-index">
        <div className="lg-a-index-head">
          <p className="lg-kicker">Section 3</p>
          <h1 className="lg-h">Standard morphometry</h1>
          <p className="lg-p" style={{ fontSize: 12.5 }}>
            Six parameters, one synthetic specimen, recomputed from the voxels on every change.
          </p>
        </div>

        <nav className="lg-a-list" aria-label="Parameter">
          {METRIC_ORDER.map((m) => (
            <button key={m.id} type="button" aria-pressed={lab.metric === m.id} onClick={() => lab.setMetric(m.id)} className={`lg-a-item ${lab.metric === m.id ? "on" : ""}`}>
              <span className="lg-a-item-n num">{m.num}</span>
              <span className="lg-a-item-s">{m.sym}</span>
              <span className="lg-a-item-b">{m.blurb}</span>
            </button>
          ))}
        </nav>

        <div className="lg-a-foot">
          <p className="lg-kicker">Specimen</p>
          <p className="lg-a-foot-name">{model.name}</p>
          <p className="lg-a-item-b">{model.note}</p>
          <SpecimenPicker lab={lab} thumbs={thumbs} />
          <p className="lg-a-item-b num">64³ voxels · 65 µm · 4.16 mm field of view</p>
        </div>
      </aside>

      <section className="lg-a-stage">
        <div className="lg-a-vp">
          <div className="lg-corners" aria-hidden="true">
            <i className="tl" />
            <i className="tr" />
            <i className="bl" />
            <i className="br" />
          </div>
          <MarginTicks max={lab.thick ? lab.thick.max : 4.16} unit={lab.thick ? "mm" : ""} />
          <div className="lg-view">
            <Viewer key={lab.metric === "ef" ? "ef" : lab.frontal ? "front" : "main"} view={lab.view} interactive={!lab.frontal} alt={`Specimen shown for ${lab.meta.name}`} />
          </div>
          <div className="lg-a-hud">
            <Stat label={lab.primary.label} value={lab.primary.value} unit={lab.primary.unit} size="lg" />
            <p className="lg-a-hud-sub">{lab.secondary}</p>
          </div>
          <div className="lg-a-tag">
            <p>64 × 64 × 64 voxels · 65 µm</p>
            <p>field of view 4.16 mm</p>
            <p>
              model {model.name.toLowerCase()} · a {lab.a.toFixed(2)} · fabric {lab.k.toFixed(1)}:1
            </p>
          </div>
          {lab.thick && (
            <div className="lg-a-legend">
              <LegendBar stops={lab.thick.stops} max={lab.thick.max} label={lab.thick.label} sweep={lab.sweep} band={lab.thick.band} />
            </div>
          )}
          <div className="lg-a-meta">{lab.tip}</div>
          {lab.busy && <span className="lg-busy">computing…</span>}
        </div>

        <div className="lg-a-dock">
          <SpecSliders lab={lab} />
          <div className="lg-a-channel">
            <p className="lg-kicker">
              {lab.meta.sym} · <span style={{ color: "var(--mut)" }}>channel</span>
            </p>
            <ChannelControls lab={lab} />
          </div>
        </div>
      </section>

      <aside className="lg-a-side">
        <div className="lg-a-block">
          <div className="lg-a-block-h">
            <p className="lg-kicker">Definition</p>
            <p className="lg-kicker num">{lab.meta.num}</p>
          </div>
          <div className="lg-prose lg-p">{lab.info.short}</div>
        </div>

        <div className="lg-a-block">
          <div className="lg-a-block-h">
            <p className="lg-kicker">This specimen</p>
            <p className="lg-kicker">live</p>
          </div>
          {lab.rows.map((r) => (
            <Field key={r.label} label={r.label} value={r.value} unit={r.unit} />
          ))}
          <Field label="Ambulatory reference" value={AMB_REF.tbth.toFixed(0)} unit="µm Tb.Th" />
        </div>

        <div className="lg-a-block">
          <div className="lg-a-block-h">
            <p className="lg-kicker">Sections</p>
            <p className="lg-kicker num">220 px</p>
          </div>
          <div className={`lg-a-sections ${sections.length === 1 ? "is-one" : ""}`}>
            {sections.map((s) => (
              <SectionStack key={s.label} items={[s]} R={lab.sectionR} />
            ))}
          </div>
        </div>

        <div className="lg-a-block">
          <div className="lg-a-block-h">
            <p className="lg-kicker">In the study</p>
            <p className="lg-kicker num">n = {s2.AMB.length}</p>
          </div>
          <Context metric={lab.metric} />
        </div>
      </aside>
    </div>
  );
}
