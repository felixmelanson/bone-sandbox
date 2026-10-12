import { useEffect, useState } from "react";
import { FactorialSection } from "./factorial";
import { Explore } from "./explore";
import { Sandbox } from "./sandbox";
import { Concepts } from "./concepts";
import { Layouts } from "./layouts";
import { Caveats, DecompositionSection, PhosphateSection, TwinsSection } from "./section5";
import { TwoClocksSection } from "./twoclocks";
import { ABSTRACT, INTRO, META, METHOD, REFERENCES, SPECIMEN } from "./text";

/* =====================================================================
   Tabs: the scrolling explorer (default), the interactive sandbox (one specimen, one 3-D view, pick
   a metric), the results (section 5 figures), and the background text.
   Only the active tab is mounted.
   ===================================================================== */

const TABS = [
  { id: "layouts", t: "Layouts" },
  { id: "explore", t: "Explore" },
  { id: "sandbox", t: "Sandbox" },
  { id: "concepts", t: "Concepts" },
  { id: "results", t: "Results" },
  { id: "about", t: "About" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
  const read = (): Tab => {
    const h = location.hash.slice(1).split("?")[0];
    return TABS.some((t) => t.id === h) ? (h as Tab) : "layouts";
  };
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <div className={`app tab-${tab}`}>
      <header className="topbar">
        <span className="topbar-title">{META.title}</span>
        <nav aria-label="Sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? "on" : ""}>
              {t.t}
            </a>
          ))}
        </nav>
      </header>

      {tab === "layouts" && <Layouts />}
      {tab === "explore" && <Explore />}
      {tab === "sandbox" && <Sandbox />}
      {tab === "concepts" && <Concepts />}

      {tab === "results" && (
        <main className="page doc">
          <h1 className="page-h">New metrics</h1>
          <FactorialSection />
          <TwinsSection />
          <DecompositionSection />
          <PhosphateSection />
          <TwoClocksSection />
          <Caveats />
        </main>
      )}

      {tab === "about" && (
        <main className="page doc">
          <header className="titleblock">
            <h1>{META.title}</h1>
            <p className="byline">
              {META.author} · {META.date}
            </p>
            <div className="abstract">
              <p className="label">Abstract</p>
              <p>{ABSTRACT}</p>
            </div>
          </header>
          <section className="about-sec">
            <h2>
              <span className="secnum">1</span>Introduction
            </h2>
            <div className="prose narrow">{INTRO}</div>
          </section>
          <section className="about-sec">
            <h2>
              <span className="secnum">2</span>Synthetic specimen
            </h2>
            <div className="prose narrow">{SPECIMEN}</div>
          </section>
          <section className="about-sec">
            <h2>
              <span className="secnum">4</span>Proposed method
            </h2>
            <div className="prose narrow">{METHOD}</div>
          </section>
          <section className="about-sec">
            <h2>References</h2>
            <ol className="refs">
              {REFERENCES.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </section>
        </main>
      )}
    </div>
  );
}
