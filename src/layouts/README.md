# Layout concepts

Three complete layouts for the sandbox, behind the **Layouts** tab (and `#layouts?v=a|b|c`).
Same specimen engine, same six channels, same numbers: only the arrangement changes.

```
npm install
npm run dev        # then open http://localhost:5173/#layouts
                   #   A  http://localhost:5173/#layouts?v=a
                   #   B  http://localhost:5173/#layouts?v=b
                   #   C  http://localhost:5173/#layouts?v=c
npm run build && npm run preview   # production build, same URLs
```

The switch under the tab bar moves between the three; every control inside is live.

## What is in each

| | concept | shape | for |
|---|---|---|---|
| **A** | Calibrated sheet | 232 px index, stage, 320 px analysis column | the page as a document you can also measure on. All six parameters visible at once, live values as a labelled list, evidence under it |
| **B** | Specimen plate | centred plate, 460 px notes sheet | the specimen as the subject. One object on white, the channel name and the one number at its corners, prose under it, notes to the side |
| **C** | Instrument console | toolbar, 244 px rail, bench, 372 px inspector | the tool. Specimen and its parameters in the toolbar, channels in the rail, what can be changed in the inspector, in the order you would use it |

Shared: `lab.ts` (all state and geometry), `parts.tsx` (readouts, section stack, evidence figures),
`controls.tsx` (sliders, picker, per-channel controls), `layouts.css` (the three skins).

## What is done about "stuff out of place"

* One ink, one accent (`#b3244f`, the same one the figures already use), hairlines, no fills.
* The viewport is the same object in all three: square-ish, transparent background, corner ticks,
  the primary readout set in it, the scale legend inside it when a channel has one.
* Controls are grouped by what they act on, and never mixed: specimen parameters, then the channel.
* Empty right-hand columns are gone: every block in the analysis column carries a definition,
  a live value, a section or a study number.
* Per-channel controls only exist where they mean something (the cut only for BV/TV, the
  sweep only for Tb.Th and Tb.Sp, MIL/SVD only inside DA).

## Removing the shell

Once a concept is chosen, delete the other two files and the switch:

1. `src/App.tsx`: keep the `layouts` entry in `TABS` (or merge the chosen concept into `Explore`).
2. `src/layouts/index.tsx`: replace with the chosen concept mounted directly, drop the header and
   the hint line, and set `--chrome` in `layouts.css` to `52px` (the app tab bar alone).
3. Or simply delete the `layouts` entry in `TABS` and `{tab === "layouts" && <Layouts />}` to go
   back to the old page untouched.
