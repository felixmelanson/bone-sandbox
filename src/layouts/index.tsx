/* =====================================================================
   Three layout concepts for the sandbox, under #layouts.
   A switch at the top keeps one concept mounted at a time; switching
   remounts the lab, so each concept starts from the same specimen.
   ===================================================================== */

import { useEffect, useState } from "react";
import "./layouts.css";
import { ConceptA } from "./ConceptA";
import { ConceptB } from "./ConceptB";
import { ConceptC } from "./ConceptC";

type Variant = "a" | "b" | "c";

const VARIANTS: { id: Variant; name: string; idea: string }[] = [
  { id: "a", name: "Calibrated sheet", idea: "index, stage, analysis sheet" },
  { id: "b", name: "Specimen plate", idea: "one centred object, notes at the side" },
  { id: "c", name: "Instrument console", idea: "toolbar, channel rail, inspector" },
];

export function Layouts({ initial = "a" }: { initial?: Variant }) {
  const read = (): Variant => {
    const v = location.hash.split("?")[1]?.match(/v=([abc])/)?.[1];
    return (v as Variant) ?? initial;
  };
  const [variant, setVariant] = useState<Variant>(read);

  useEffect(() => {
    const on = () => setVariant(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const pick = (v: Variant) => {
    setVariant(v);
    history.replaceState(null, "", `#layouts?v=${v}`);
    window.scrollTo(0, 0);
  };

  const meta = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="app lay">
      <header className="lg-switch">
        <span className="lg-switch-brand">Bone sandbox</span>
        <div className="lg-switch-tabs" role="radiogroup" aria-label="Layout concept">
          {VARIANTS.map((v, i) => (
            <button key={v.id} type="button" role="radio" aria-checked={variant === v.id} className={variant === v.id ? "on" : ""} onClick={() => pick(v.id)}>
              <i>{["A", "B", "C"][i]}</i>
              {v.name}
            </button>
          ))}
        </div>
        <p className="lg-switch-note">
          <b>{meta.name}</b>
          <span>{meta.idea}</span>
        </p>
      </header>

      <p className="lg-hintline">
        Three layout concepts for the same page. The switch above moves between them and everything inside is live: drag a 3-D view to rotate it, pick a
        specimen from the thumbnail strip, move the sliders.
      </p>

      {variant === "a" && <ConceptA />}
      {variant === "b" && <ConceptB />}
      {variant === "c" && <ConceptC />}
    </div>
  );
}
