/* =====================================================================
   The manuscript page: the sandbox as one scroll you can read, with the
   same six live figures the paper page has. Three refinements of the
   arrangement are below in paper.css; the content is identical.

     A  journal        one column of prose, figures outdented wider
     B  plate atlas    each parameter a ruled plate, notes in two columns
     C  research note  note on the left, figure on the right, margin numbers
   ===================================================================== */

import { useState } from "react";
import "./paper.css";
import { DAPanel, EFPanel } from "../panels-b";
import { BVPanel, ConnPanel, ThicknessPanel } from "../panels-a";
import { ModelsRow } from "../explore";
import { DEFAULT_SPECIMEN, SpecimenCtx, type SpecimenChoice } from "../specimen";
import { ABSTRACT, META, REFERENCES } from "../text";

export type Variant = "a" | "b" | "c";

const TAG: Record<Variant, string> = {
  a: "Layout A · one column: heading, prose, then the figure",
  b: "Layout B · plate on the left, note on the right",
  c: "Layout C · number in the margin, note left, figure right",
};

export function Paper({ variant = "a" }: { variant?: Variant }) {
  const [spec, setSpec] = useState<SpecimenChoice>(DEFAULT_SPECIMEN);

  return (
    <main className={`ms ms-${variant}`}>
      <div className="ms-wrap">
        <header className="ms-title">
          <p className="ms-tag">{TAG[variant]}</p>
          <h1>{META.title}</h1>
          <p className="ms-byline">
            {META.author} · {META.date}
          </p>
          <div className="ms-abstract">
            <p className="ms-abstract-h">Abstract</p>
            <p>{ABSTRACT}</p>
          </div>
        </header>

        <section className="ms-sec">
          <h2 className="ms-h2">
            <span className="ms-n">1</span>Specimen
          </h2>
          <ModelsRow spec={spec} setSpec={setSpec} />
        </section>

        <SpecimenCtx.Provider value={spec}>
          <section className="ms-sec">
            <h2 className="ms-h2">
              <span className="ms-n">2</span>Standard parameters
            </h2>
            <BVPanel num="2.1" fig={2} />
            <ConnPanel num="2.2" fig={3} />
            <ThicknessPanel kind="th" num="2.3" fig={4} />
            <ThicknessPanel kind="sp" num="2.4" fig={5} />
            <DAPanel num="2.5" fig={6} />
            <EFPanel num="2.6" fig={7} />
          </section>
        </SpecimenCtx.Provider>

        <section className="ms-sec">
          <h2 className="ms-h2">References</h2>
          <ol className="refs">
            {REFERENCES.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
