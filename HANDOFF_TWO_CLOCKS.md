# Handoff: 5.5 Two clocks (thinning vs rung loss by bone age)

For Claude Code. Builds one new panel after 5.4 in section 5. Read `HANDOFF_FACTORIAL_V2.md` first; same ground rules apply (no new deps, plain SVG + `src/utils/tween.ts`, palette and `Seg`/`Toggle` from `ui.tsx`, no em dashes or `--` in visible text, reduced motion jumps to end states, `npm run build` must pass). Add `5.5 Two clocks` to the TOC.

## 1. The claim

Compare each unloaded stratum with ambulatory bone of the same bone age, not the same depth. Two losses separate:

- **Thinning reaches older bone.** At S2 and S3 every strut is about 18% thinner (Hedges g about -4 at both), and it is equal across orientations (0.82-0.86 per class, earlier pass). Non-selective in orientation, and it reaches bone that was already there when unloading started.
- **Rung loss is confined to younger bone.** The cross-brace deficit is strong at S2 and nearly gone at S3. Bone that was a little older when unloading started kept most of its rungs while still thinning like everything else.

S3 is the clean dissociation: thinning g -4.1, rung length g -0.3, in the same bone.

Both effects have a depth limit; thinning's is just deeper. By S4 (matched AMB depth 3.4 mm) thinning fades too in normal phosphate (Tb.Th x0.98) but not in high phosphate (x0.87, g -2.1). So "exposure clock" is too strong: it is two windows of different length, and phosphate lengthens both (section 5).

Default ratio 1.93, V12 out, all diets:

| HLU stratum | matched AMB depth | rung length | column length | tr/long | Tb.Th | BV/TV |
|---|---|---|---|---|---|---|
| S2 (0.5-1.0 mm) | 1.45 mm | x0.53 (g -1.4) | x1.09 | x0.49 (g -2.5) | x0.81 (g -4.0) | x0.62 |
| S3 (1.0-1.5 mm) | 2.41 mm | x0.84 (g -0.3) | x0.93 | x0.90 (g -0.4) | x0.82 (g -4.1) | x0.90 |

Why it matters (mechanism): the stump test couldn't separate "never built" from "built then resorbed" with static data. This gets partway there. Braces in bone past some age survive two weeks of unloading intact apart from thinning; braces in young bone are absent. The rung program has a time window after formation, and unloading during that window means the braces don't get made (or don't get kept). Ties to Walle 2024 Sci Adv (closing recovery window).

## 2. Data

`src/data/two_clocks.json` (written). Keys:
- `grid[]`: one row per growth `ratio` (1.50 to 2.50, step 0.05) x HLU `stratum` (1-6) x `diet` (`all`, `HP`, `NP`). Rows whose AMB match depth falls beyond the deepest AMB band are omitted.
- Each row has `hlu_depth_mm`, `amb_depth_mm`, and per metric (`tr_long`, `rung_length`, `column_length`, `tbth`, `bvtv`, `P2_far`): `hlu_over_amb` (exp of mean log difference; null for P2), `diff`, `g`, `n_hlu`, `n_amb`, `hlu_rats[]` (log values), `amb_rats[]` (each AMB rat's profile interpolated at the match depth).
- `growth_mm_during_HLU`: HLU 0.90, AMB 1.74 (whole tibial length vs baseline sacs).
- `default_ratio` 1.93, `amb_max_depth_mm`.

Per-rat dots on the chart: `exp(hlu_rats[i] - mean(amb_rats))`.

## 3. The bone-age caveat (drives the second slider)

Two unknowns set where "unloading started" sits:
1. **ratio** (AMB growth / HLU growth during the experiment). Measured 1.93 from whole-tibia length. Sets which AMB depth each HLU stratum is compared with.
2. **f**, the proximal growth plate's share of tibial growth. Unknown and almost certainly below 1. Doesn't change the ratio, but moves the boundary: bone formed at HLU start now sits at HLU depth 0.90 f and AMB depth 1.74 f.

At f = 1, S2 is bone made during unloading and S3 is bone made before. At f around 0.6-0.7, the boundary lands near 0.55-0.65 mm, so S2 is mostly pre-unloading bone too. The dissociation still stands; only the wording changes. "Rungs missing in bone made during unloading" becomes "rungs missing in bone that was young when unloading started". The caption must use the second wording, which is true for any f.

f is measurable: register the day 11-14 in vivo scan to the ex vivo scan of the same right tibia and measure plate-to-landmark distance (tibiofibular junction or tuberosity). Put that in the caveats as the deciding check.

## 4. Robustness numbers (for the caption and the slider's readout)

S3 rung length across ratio 1.5 to 2.5: x0.66 (g -0.84) to x0.98 (g -0.03). S2 rung length: x0.40 (g -2.0) to x0.73 (g -0.7). Tb.Th: S2 x0.83 to x0.79, S3 x0.84 to x0.85, g -3 to -4.4 throughout.

So the S2 vs S3 contrast holds across the range. It is cleanest from about 1.7 upward and softens at the low end, where S3 is compared with younger AMB bone that still carries more rungs.

Use rung length density, not tr/long, as the rung curve. Above ratio 2.2, S3 is compared with deep AMB bone (2.8-3.1 mm) that is losing columns, and tr/long drops (x0.72 at 2.5) even though HLU rung length is matched (x0.98). Show tr/long only in the tooltip.

## 5. Phosphate: the better diet story

This replaces the weak interaction story from 5.4 as the diet point worth making. Default ratio (1.95 grid row), HLU/AMB within diet:

| | S2 rungs | S3 rungs | S4 rungs | S3 Tb.Th | S4 Tb.Th |
|---|---|---|---|---|---|
| HP | x0.51 (g -1.6) | x0.72 (g -0.75) | x0.59 (g -1.0) | x0.80 (g -4.1) | x0.87 (g -2.1) |
| NP | x0.61 (g -1.4) | x1.09 (g +0.2) | x1.26 (g +0.4) | x0.84 (g -4.8) | x0.98 (g -0.2) |

At S2 both diets lose rungs about equally. Under normal phosphate, rung loss stops there and thinning stops by S4. Under high phosphate, both reach a stratum deeper: older bone loses rungs it already had, and keeps thinning.

Mechanistic reading: unloading sets which struts are vulnerable, and high phosphate (higher PTH/FGF23, higher turnover) widens how far back in bone age remodeling reaches. That would put HP rung loss in already-built braces, which is resorption, not missed formation. That's testable with the in vivo registration.

n = 5/5/5/4. Descriptive only; say so on the panel.

## 6. The panel

About 760 x 460 SVG, title row, chart, controls under it, caption.

**Axes.**
- x = bone age expressed as matched ambulatory depth (mm), 0 to 3.6. Tick label: "matched ambulatory depth (bone age), mm". A second tick row under it, light grey, shows the HLU depth that maps there (x / ratio), so readers can see both coordinates.
- y = HLU / AMB, log scale, 0.35 to 1.6, ticks at 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.6. Horizontal reference line at 1 labelled "no difference".

**Boundary.** A vertical line at x = 1.74 f labelled "unloading starts". Shade the region left of it very lightly (`#F4EFE6`) with the label "young when unloading started" in small grey text. Do not label it "formed during unloading" (section 3).

**Series.** Each is a polyline through HLU strata S1-S4 at x = amb_depth_mm, with per-rat dots behind (r 2.5, 35% opacity):
- Tb.Th: copper `#C06A1C`, 2 px.
- Rung length: black `#1C1C1E`, 2 px.
- Column length: grey `#9A9DA2`, 1.5 px dashed.
- Optional, off by default: BV/TV (sand `#D9A23A`, 1 px).

Draw S1 points hollow with a hover note: "S1 is primary spongiosa; everything is under-built here (columns x0.47), so it isn't part of the comparison." Draw S4 points at 50% opacity with a hover note: "Matched ambulatory bone this deep is sparse; read with caution." S5-S6 are not plotted.

**Controls** (under the chart, one row):
- `Seg` diet: `All` / `High phosphate` / `Normal phosphate`.
- Slider "growth ratio" 1.50 to 2.50, step 0.05, default 1.95 (nearest grid row to 1.93), with a live readout ("ambulatory tibiae grew 1.95x as much").
- Slider "proximal plate share f" 0.5 to 1.0, step 0.05, default 1.0. Moves only the boundary line.
- `Toggle` "show BV/TV".

**Animation.**
1. On first scroll into view (IntersectionObserver, threshold 0.4): axes fade in (300 ms). The boundary line drops from the top (400 ms). The Tb.Th line draws left to right with stroke-dashoffset (900 ms), dots fade in behind it. Pause 250 ms. The rung line draws (900 ms) and visibly peels away from Tb.Th past the boundary. Column line last (600 ms).
2. Two callouts fade in at the end (300 ms), anchored to the S3 points: "S3: thinner by 18%" next to the Tb.Th point, "rungs mostly intact" next to the rung point. Hide callouts as soon as any control is touched.
3. Ratio slider: every point slides to its new x and y (250 ms tween, no stagger) and lines follow. Use the grid row for the slider value; never interpolate between rows.
4. f slider: only the boundary and shading move (150 ms).
5. Diet switch: lines morph between datasets (500 ms). On `High phosphate`, the rung line stays low through S3-S4; on `Normal phosphate`, it climbs back to 1 by S3. That contrast is the diet point, so make the transition smooth.

**Tooltip** on any point: stratum, HLU depth, matched AMB depth, ratio with g, n, plus tr/long for that cell.

**Readout strip** under the controls, live with the sliders: "S2 rungs x0.53 · S3 rungs x0.85 · S3 Tb.Th x0.82". Use the current grid row and diet.

## 7. Copy

Heading: "Two clocks"

Lead (above the chart): "Compare unloaded bone with ambulatory bone of the same age instead of the same depth, and the loss splits in two. Thinning reaches bone that was already there when the rats went up. Missing cross-braces don't."

Caption: "Each line is unloaded over ambulatory for bone of the same age. Thickness drops by a fifth on both sides of the line. Rungs are missing only in bone that was young when unloading began; a millimetre deeper, the bone kept its braces and just got thinner. Strut thinning and brace loss look like one thing at a fixed depth. They are two processes with different reach into the past. High phosphate extends both."

Caveat block (small grey, under the caption):
- Bone age assumes depth below the plate tracks time since formation at a constant growth rate per group. Ratio 1.93 is from whole-tibia length against baseline sacs.
- The proximal plate's share of growth (f) is unknown; it moves the boundary but not the S2 vs S3 contrast. Measurable from the day 11-14 in vivo scans registered to ex vivo.
- Static data can't fully separate "never built" from "built then resorbed". In vivo to ex vivo registration of the same right tibia would show whether S3 rungs present at day 12 are still there at sac (prediction: yes under NP, fewer under HP).
- n = 5 per group per diet (4 HLU-NP, V12 excluded).

## 8. Acceptance checks

- At ratio 1.95, all diets: S2 rungs 0.535, S3 rungs 0.854, S3 Tb.Th 0.818, S2 columns 1.094.
- HP vs NP at S3 rungs: 0.724 vs 1.09.
- Moving f changes nothing but the boundary.
- S5-S6 never drawn; S1 hollow; S4 at half opacity.
- No em dashes or ` -- ` in rendered text; reduced motion shows the final state immediately; `npm run build` passes.
