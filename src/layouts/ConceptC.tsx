/* =====================================================================
   C · Instrument console
   ---------------------------------------------------------------------
   The tool layout you know from imaging software, tidied up. A toolbar
   above: which specimen, its three parameters. A rail on the left lists
   the channels. The bench fills the middle. The inspector on the right
   carries the live readouts, the sections and the evidence, in numbered
   groups, top to bottom in the order you would use them.
   ===================================================================== */

import { useEffect, useRef, useState } from "react";
import { MODELS } from "../bone/models";
import { Viewer } from "../bone/views";
import { ChannelControls, ContextFigure, LSlider, SpecimenPicker, SpecSliders } from "./controls";
import { useLab, useSpecimenShelf, METRIC_ORDER, THIN_ROWS, G } from "./lab";
import { Field, Finding, LegendBar, SectionStack, Stat } from "./parts";

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function ConceptC() {
  const lab = useLab();
  const thumbs = useSpecimenShelf();
  const model = MODELS.find((m) => m.id === lab.model)!;
  const [picker, setPicker] = useState(false);
  const pop = useRef<HTMLDivElement>(null);

  // click away or escape closes the specimen menu
  useEffect(() => {
    if (!picker) return;
    const down = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node)) setPicker(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPicker(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [picker]);

  const sections = lab.thick
    ? [{ raster: lab.px, label: `${lab.thick.label}`, note: lab.thick.cross }]
    : [
        { raster: lab.px, label: "Axial", note: "centre plane" },
        { raster: lab.pxCor, label: "Coronal", note: "centre plane" },
      ];

  return (
    <div className="lg-c">
      <div className="lg-c-bar">
        <button type="button" className="lg-c-spec" onClick={() => setPicker((v) => !v)} aria-expanded={picker} aria-haspopup="dialog">
          {thumbs[lab.model] ? <img src={thumbs[lab.model]} alt="" /> : <img alt="" />}
          <span className="lg-c-spec-t">
            <i>Specimen</i>
            <b>{model.name}</b>
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <span className="lg-c-div" />
        <div className="lg-c-sliders">
          <SpecSliders lab={lab} />
        </div>
        <span className="lg-c-div" />
        <span className="lg-kicker num" style={{ whiteSpace: "nowrap" }}>
          64³ · 65 µm
        </span>
      </div>

      {picker && (
        <div className="lg-c-pop" ref={pop} role="dialog" aria-label="Choose a specimen">
          <div className="lg-c-pop-h">
            <p className="lg-kicker">Specimen library</p>
            <p className="lg-kicker num">9 models</p>
          </div>
          <SpecimenPicker lab={lab} thumbs={thumbs} onPick={() => setPicker(false)} />
          <p className="lg-c-pop-note">
            <b>{model.name}.</b> {model.note}. Each model starts at a typical BV/TV for its type.
          </p>
        </div>
      )}

      <div className="lg-c-body">
        <nav className="lg-c-rail" aria-label="Parameter">
          <div className="lg-c-rail-h">
            <p className="lg-kicker">Channels</p>
          </div>
          <div className="lg-c-rail-list">
            {METRIC_ORDER.map((m) => (
              <button key={m.id} type="button" aria-pressed={lab.metric === m.id} onClick={() => lab.setMetric(m.id)} className={lab.metric === m.id ? "on" : ""}>
                <span className="num">{m.num}</span>
                <b>{m.sym}</b>
                <Chevron />
                <em>{m.name}</em>
              </button>
            ))}
          </div>
          <div className="lg-c-rail-foot">
            <p className="lg-kicker">Fabric</p>
            <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
              <LSlider label="Loading direction" value={lab.psi} min={0} max={180} step={1} onChange={lab.setPsi} format={(v) => `${v.toFixed(0)}°`} />
              <p className="lg-c-note">
                Fabric alignment above stretches the structure along x. At 1:1 the specimen is isotropic, which is the honest starting point for DA and EF.
              </p>
            </div>
          </div>
        </nav>

        <section className="lg-c-stage">
          <div className="lg-c-vp">
            <div className="lg-corners" aria-hidden="true">
              <i className="tl" />
              <i className="tr" />
              <i className="bl" />
              <i className="br" />
            </div>
            <div className="lg-view">
              <Viewer key={lab.metric === "ef" ? "ef" : lab.frontal ? "front" : "main"} view={lab.view} interactive={!lab.frontal} alt={`Specimen shown for ${lab.meta.name}`} />
            </div>
            <div className="lg-c-vp-h">
              <b>{lab.primary.label}</b>
              <Stat label="" value={lab.primary.value} unit={lab.primary.unit} size="lg" />
              <span className="lg-a-hud-sub" style={{ marginTop: 0 }}>
                {lab.secondary}
              </span>
            </div>
            <div className="lg-c-vp-r">
              <p>
                channel {lab.meta.num} · {lab.meta.sym}
              </p>
              <p>
                model {model.id} · seed 2203
              </p>
              <p>
                a {lab.a.toFixed(2)} · fabric {lab.k.toFixed(1)}:1
              </p>
              <p>BV/TV {(lab.realBV * 100).toFixed(1)} %</p>
            </div>
            {lab.thick && (
              <div className="lg-a-legend">
                <LegendBar stops={lab.thick.stops} max={lab.thick.max} label={lab.thick.label} sweep={lab.sweep} band={lab.thick.band} />
              </div>
            )}
            {lab.busy && <span className="lg-busy">computing…</span>}
          </div>
          <p className="lg-c-lede">
            <b>{lab.meta.blurb}</b> {lab.tip} The specimen is resegmented on the GPU from a single threshold, so the field itself never changes.
          </p>
        </section>

        <aside className="lg-c-insp">
          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>01</i>
              <span>{lab.meta.name}</span>
            </div>
            <h3 className="lg-stat-v" style={{ fontSize: 30 }}>
              {lab.primary.value}
              {lab.primary.unit && <span style={{ fontSize: 13, color: "var(--mut)" }}>{lab.primary.unit}</span>}
            </h3>
            <p className="lg-c-abbr">{lab.primary.label}</p>
            <p className="lg-c-note">{lab.secondary}</p>
          </div>

          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>02</i>
              <span>Controls</span>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <ChannelControls lab={lab} />
            </div>
          </div>

          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>03</i>
              <span>Readouts</span>
            </div>
            <div className="lg-c-fields">
              {lab.rows.map((r) => (
                <Field key={r.label} label={r.label} value={r.value} unit={r.unit} />
              ))}
            </div>
          </div>

          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>04</i>
              <span>Sections</span>
            </div>
            <div className={`lg-c-sections ${sections.length === 1 ? "is-one" : ""}`}>
              {sections.map((s) => (
                <SectionStack key={s.label} items={[s]} R={lab.sectionR} />
              ))}
            </div>
          </div>

          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>05</i>
              <span>In the study</span>
            </div>
            <ContextFigure metric={lab.metric} w={332} />
            {lab.metric === "tb-th" && (
              <Finding num={`${THIN_ROWS[1].value.toFixed(2)}×`} unit={`g ${(G.tbth_um as Record<string, number>)["2"]}`}>
                Unloaded thickness against ambulatory bone of the same depth, second stratum.
              </Finding>
            )}
          </div>

          <div className="lg-c-group">
            <div className="lg-c-group-h">
              <i>06</i>
              <span>Definition</span>
            </div>
            <div className="lg-prose lg-p">{lab.info.short}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
