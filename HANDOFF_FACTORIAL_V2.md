# Handoff: section 5 rebuild (factorial grid v2 + three new panels)

For Claude Code. Read this whole file before touching anything. Felix will add a section on ROI limitations and the method after this one, so leave room in the TOC after 5.x.

## 0. Ground rules

- No new dependencies. React 19 + three + Tailwind are there; charts are plain SVG with a small rAF tween helper (write one in `src/utils/tween.ts`, ease = cubic in-out).
- Keep the existing look: palette in `factorial_web.json` (`#C06A1C #D9A23A #E9DDC8 #BCC3CB`), text colours `#1C1C1E` / `#76797E`, `Seg` and `Toggle` from `ui.tsx`, metallic instanced ellipsoids from `factorial.tsx`.
- Copy rules: no em dashes and no `--` anywhere in visible text. Use a single dash or a semicolon. Plain, short, non-AI phrasing. Captions below are final unless they break layout.
- `prefers-reduced-motion`: every animation below jumps straight to its end state.
- Must still build with `npm run build` (vite-plugin-singlefile).

## 1. Data

New file: `src/data/scrutiny.json` (already written). Male Voyager right tibiae, production 10 um, Morphometry II + IV. Stratum k = band_idx k-1 (500 um geodesic strata).

Keys:
- `per_rat_band[]`: scan_id, rat, load, diet, stratum (1-10), bvtv, tbth_um, P2_far (null if flagged), orientation_flag, L_transverse, L_longitudinal (mm/mm3), tr_long_ratio, tbn_permm, tbsp_um, da, qc_exclude (true only for V12).
- `hedges_g_HLU_minus_AMB[metric][stratum]` (V12 out).
- `thinning_ratio_by_class[]`: HLU/AMB thickness ratio per class + overall Tb.Th, S1-S6.
- `bvtv_loss_decomposition[]`: per stratum, log BV/TV ratio split into missing length vs thinning (bone volume approximated as sum of L * pi * (t/2)^2 per class; r = 0.86 against measured BV/TV), plus per-class length ratios, share of standing AMB length, share of lost length.
- `matched_twins[]`: each HLU rat at S2-S3 with its 3 nearest AMB rat-strata (S1-S10, flagged excluded) in (BV/TV, P2far) space, distances in AMB SD units; their mean Tb.Th.
- `diet_x_load_interaction[]`: contrast (HLU-HP minus AMB-HP) minus (HLU-NP minus AMB-NP) per stratum, permutation p (diet shuffled within load, 4000 perms).

### 1a. Bug to fix first: V12 is half-excluded in the current grid

In `factorial_web.json`, V12's P2far is dropped where it is flagged (S2-S6), but its BV/TV and Tb.Th still go into the Unloaded / normal phosphate means, and its S1 P2far (0.089) is kept. V12 Tb.Th is 199-214 um at S2-S3 versus 114-129 for the other four. Effect on what Felix has been looking at:

| HLU-NP cell | current | V12 out |
|---|---|---|
| S2 Tb.Th | 133.3 | 116.9 |
| S3 Tb.Th | 144.5 | 127.1 |
| S1 P2far | 0.188 | 0.213 |
| S2 BV/TV | 0.201 | 0.169 |

So the "HP is way more prominent" read in Tb.Th colour is mostly one rat. Fix: rebuild every cell mean in `factorial_web.json` from `scrutiny.json.per_rat_band` with `qc_exclude` rats removed from all metrics. Draw V12 as a dashed grey ring only (no fill contribution) with tooltip "V12 excluded: segmentation QC (orientation flag S2-S6, Tb.Th 199 um at S2)". Recompute `TB_RANGE` from the cleaned cells and pin it to [100, 155] so the legend ticks stay meaningful. Add an `excluded` count to the hover tooltip.

## 2. Section layout (replaces current section 5 body)

```
5  New metrics
  5.1  Density makes unloading look like ageing        (grid, story stepper)
  5.2  Same density, same order, thinner bone          (twins)
  5.3  Where the missing bone went                      (decomposition)
  5.4  Phosphate                                        (honest diet panel)
```
Update `TOC` in `App.tsx` with these four sub-entries.

## 3. 5.1 Grid with a story stepper

Keep the existing grid, controls and effect chart. Add a stepper above the canvas: four pill buttons `1 Density`, `2 Thickness`, `3 Same age`, `Explore`, plus prev/next arrows and left/right arrow-key support when the section is in view. Each step sets state; the user can leave the story at any time by touching a control, which jumps to `Explore`.

The point of steps 1-3: with BV/TV colour, unloaded bone under the plate looks like ambulatory bone 2 mm deeper. Flip to Tb.Th and that resemblance breaks. Then line both up by bone age and it breaks harder.

**Spotlight pair** (used in steps 1-2): HLU-HP S2 and AMB-HP S5. All other ellipsoids tween to 30% opacity and 60% saturation over 400 ms. Draw a thin curved SVG connector (overlay on the canvas, 1 px `#76797E`, dashed) between the two, with a small label at each end.

**Step 1, Density.** colorBy = bvtv. Labels: `P₂ 0.35 · BV/TV 0.12` and `P₂ 0.27 · BV/TV 0.13`.
Caption: "Colour by density and unloaded bone just under the growth plate looks like ambulatory bone two millimetres deeper. Just as sparse, just as tall. Read this way, unloading is ageing on fast-forward."

**Step 2, Thickness.** Colour cross-fades to Tb.Th over 700 ms (lerp each instance colour; do not snap). The legend ramp and ticks cross-fade at the same time. Labels change to `113 µm` and `149 µm`, number tween over the same 700 ms.
Caption: "Colour by thickness and the match falls apart. Deep ambulatory bone is ordered and thick: fewer, sturdier columns. Unloaded bone is just as ordered while its struts are a quarter thinner. Different bone that happens to share a density."

**Step 3, Same age.** Keep Tb.Th colour. Spotlight off (everything back to full opacity, 400 ms). Unloaded rows remap to bone age: HLU tibiae grew 0.90 mm during unloading versus 1.74 mm in ambulatory rats (ratio 1.93, from baseline sacs), so HLU depth d sits where AMB depth 1.93 d does. Stratum centres 0.25, 0.75, 1.25 mm become 0.48, 1.45, 2.41 mm; slide the HLU ellipsoids along x to those positions on the AMB depth axis (900 ms, ease in-out, stagger 60 ms per column). HLU S4-S6 land beyond 3 mm: shrink to 0 and fade out as they pass the right edge. Add a second thin axis under the unloaded rows reading "depth in unloaded rats" with ticks at 0, 0.5, 1.0, 1.5 mm stretched to match.
Caption: "Line the rows up by when the bone was made rather than where it sits. The unloaded rows now compare against ambulatory bone of the same age. Every unloaded cell is taller and thinner than the nearest ambulatory cell above it."

**Explore.** Everything unlocked; add a `Depth axis: fixed / bone age` Seg control that runs the same step-3 transition both ways.

Implementation notes: the remap is an x offset per instance, so add a per-instance `xTarget` and tween `x` in `Grid.frame`. The connector overlay needs world-to-screen projection of the two cell centres every frame (reuse the ortho camera). Rings (per-rat silhouettes) move with their cell.

Hover tooltip additions: transverse and longitudinal length density for the cell (mean of `L_transverse`, `L_longitudinal`) and tr/long ratio. Reason: the ellipsoid encodes P2 only, which cannot tell "lost rungs" from "columns tilted closer to the axis". The tooltip ties the shape back to the actual finding.

## 4. 5.2 Twins (new panel, SVG)

Claim: matched on both BV/TV and P2far to their three nearest ambulatory rat-strata, every unloaded rat at S2-S3 is thinner. 18 of 18, mean -26 µm, range -12 to -38. The twins are almost all ambulatory S3-S6 bone.

Panel, about 640 x 420, one SVG, three animated stages driven by a single button `Find twins` that becomes `Compare thickness`, then `Reset`:

1. **Space.** x = BV/TV, y = P2far. Grey dots (r 3, `#BCC3CB`) for every AMB rat-stratum S1-S10 from `per_rat_band` (flagged out). Filled copper dots (r 5, `#C06A1C`) for HLU rats at S2, open copper rings for S3. Labels off; hover shows rat and stratum.
2. **Find twins** (1000 ms). For each HLU point, draw three hairlines to its twins (from `matched_twins`), staggered 40 ms per point, stroke-dashoffset draw-in. Twin dots grow to r 4 and darken.
3. **Compare thickness** (1200 ms). Morph the whole plot into a dumbbell chart: every HLU point and the centroid of its twins slide to a row (one row per HLU rat-stratum, sorted by gap), x axis becomes Tb.Th (90-160 µm). HLU point at its Tb.Th, twin centroid at the twins' mean Tb.Th, connected by a bar. Points travel along a straight interpolation between the two layouts; hairlines fade out during the first 300 ms. End with a vertical summary tick at mean gap and the text "18 / 18 thinner · mean -26 µm".

Caption under the panel: "Pick any unloaded rat, find the ambulatory bone that matches it on density and on strut order, and the unloaded bone is still thinner every time. Thickness is carrying information that density and order miss, which is why the grid colour matters."

Footnote (small, grey): "Distance in AMB SD units of BV/TV and P2far; 3 nearest neighbours; AMB pool S1-S10; orientation-flagged strata excluded; V12 excluded."

## 5. 5.3 Where the missing bone went (new panel, SVG)

Claim: Tb.Th has big effect sizes (Hedges g about -2.4 at S1-S3) so it reads like the headline, but at S2-S3 thinning accounts for only about 30% of the lost bone volume. About 70% is strut length that is simply not there, and rungs are over-represented in what went missing. Thinning itself is non-selective: every orientation class thins by about the same factor.

Numbers (V12 out, from `bvtv_loss_decomposition` and `thinning_ratio_by_class`):

| stratum | loss from thinning | loss from missing length | transverse length kept | longitudinal kept | transverse share of standing AMB length | transverse share of lost length |
|---|---|---|---|---|---|---|
| S1 | 43% | 57% | 0.44 | 0.44 | 57% | 58% |
| S2 | 30% | 70% | 0.30 | 0.76 | 39% | 54% |
| S3 | 30% | 70% | 0.42 | 0.72 | 37% | 50% |
| S4 | 29% | 71% | 0.54 | 0.65 | 33% | 37% |
| S5 | 40% | 60% | 0.64 | 0.60 | 31% | 29% |
| S6 | 14% | 86% | 0.65 | 0.52 | 29% | 25% |

Thickness ratio HLU/AMB at S2: longitudinal 0.86, oblique 0.86, transverse 0.82, overall Tb.Th 0.85.

That gives three zones, and the panel should make them visible without saying "three zones" in a heading:
- S1: everything is missing in equal measure. Under-building, not selection.
- S2-S3: rungs go first. Transverse length drops to a third while columns keep three quarters.
- S4-S6: selection fades and reverses slightly; deeper, older bone loses columns at least as fast as rungs.

Layout: one row per stratum S1-S6, two linked charts side by side.

**Left: where the volume went.** Horizontal bar per stratum, total length = |log BV/TV ratio|. Split into a grey segment (thinning) and a segment for missing length, itself split into three sub-segments coloured by class: longitudinal black `#1C1C1E`, oblique mid grey `#9A9DA2`, transverse copper `#C06A1C`. Order: thinning, longitudinal, oblique, transverse (copper at the far end so it reads as "what's left over is rungs").
Animation on first scroll into view (IntersectionObserver, threshold 0.4): bars grow from 0, thinning segment first (500 ms), then the length segment unfurls left to right (700 ms), rows staggered 80 ms.

**Right: kept vs lost.** Per stratum, two thin stacked 100% bars: top = class mix of standing AMB length, bottom = class mix of the length HLU lost. Same colours. If rungs were lost in proportion, the copper segments would line up; at S2-S3 the bottom copper segment overshoots. Animate the bottom bar after the left chart finishes (600 ms), with a small copper tick on the top bar marking where proportional loss would end, so the overshoot is obvious.

Under both: a one-line "effect size is not effect share" strip for S2: `Tb.Th  g -2.4 · 30% of lost volume` and `transverse strut share  g -3.8`, `tr/long length ratio  g -3.4`.

Caption: "Thickness has the biggest effect sizes in the standard suite, so it gets read as the result. It isn't. At 0.5-1.5 mm below the plate, thinning explains about a third of the missing bone, and it hits every strut orientation equally. The rest is struts that are gone, and the ones that are gone are disproportionately the cross-braces. A thinning metric can't tell you which struts left; a length-by-orientation metric can."

Footnote: "Volume split assumes each class contributes length x pi (t/2)^2 using skeleton length density and length-weighted thickness per class (Morphometry IV, all branches). This proxy correlates r = 0.86 with measured BV/TV. S1 class shares include near-cortex points, which inflates the transverse share there."

## 6. 5.4 Phosphate (honest panel)

What Felix noticed: HP looks far more dramatic than NP. What holds up:
- HP lowers BV/TV in both loading groups (AMB-HP 0.27 vs AMB-NP 0.33 at S2), so part of HP-HLU's look is an additive diet effect, not an interaction.
- The Tb.Th difference between HP-HLU and NP-HLU at S2-S3 was V12 (section 1a). With V12 out: 113 vs 117 µm at S2.
- The orientation interaction is a hint only. Contrast (HLU-HP minus AMB-HP) minus (HLU-NP minus AMB-NP), permutation p, n = 5/5/5/4:

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| P2far | +0.06, p 0.47 | +0.08, p 0.10 | +0.05, p 0.42 | +0.04, p 0.50 |
| log tr/long | -0.13, p 0.58 | -0.33, p 0.16 | +0.04, p 0.89 | -0.18, p 0.58 |
| Tb.Th (µm) | -2.7, p 0.83 | +6.5, p 0.48 | +2.6, p 0.72 | -5.3, p 0.74 |

Panel: four small interaction plots side by side (P2far, log tr/long, log BV/TV, Tb.Th) at a stratum chosen by a Seg control (S1-S4, default S2). Each: x = AMB, HLU; two lines HP (copper) and NP (grey), per-rat dots jittered behind. Parallel lines = no interaction. Line endpoints tween 500 ms when the stratum changes. Small grey p under each plot.

Add a `Toggle` "include V12" that redraws the NP-HLU points and line with V12 in (V12 drawn as a hollow dot with a dashed outline). Watch the Tb.Th plot's NP line jump. This is the QC story in one click; keep it.

Caption: "High phosphate makes everything worse, loaded or not, so the unloaded high-phosphate row starts from a lower floor. Whether phosphate specifically speeds up rung loss is suggestive at 0.5-1.0 mm and not resolvable with five rats a cell. One rat with a segmentation fault was most of the thickness difference."

## 7. Caveats strip (end of section 5, small grey text, collapsible)

- Ellipsoid shape is P2far only. It cannot separate lost rungs from columns tilting toward the depth axis; the class lengths in 5.3 are what pin down rung loss.
- P2far is measured against the local depth gradient. Against scan z it reads 0.02-0.20 higher in the rats checked; whether the AMB-HLU gap depends on the reference is not yet tested.
- n = 5 per cell (4 for HLU-NP after V12). Effect sizes at this n have wide intervals; the effect chart already shows them.
- Fixed-depth strata compare bone of different ages across groups; step 3 of 5.1 is the bone-age view and uses one growth ratio (1.93) from baseline sacs.
- Right tibiae only. Left/right are confounded with scan order and batch, so sides are not pooled.
- Sacrifice fed state differs by group (AMB mostly fed, HLU mostly fasted). Not expected to move trabecular architecture over hours, but it is a group-level confound.

## 8. Acceptance checks

- Grid cell means match `per_rat_band` with V12 removed (spot-check HLU-NP S2 Tb.Th = 116.9, BV/TV = 0.169, P2far = 0.256).
- Stepper: keyboard arrows work; touching any control jumps to Explore; reduced motion skips all tweens.
- Step 3 positions: HLU S1/S2/S3 centred at 0.48/1.45/2.41 mm on the AMB depth axis.
- Twins: 18 HLU points, every dumbbell points left, summary reads -26 µm.
- 5.3 left bars at S2: thinning 30%, length 70%.
- No em dashes or double hyphens in any rendered string (grep the built HTML for `—` and ` -- `).
- `npm run build` succeeds and the single-file output opens offline.
