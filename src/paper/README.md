# The manuscript page

`Paper({ variant })` renders the sandbox as one scroll you can read: title block, abstract,
Section 1 the specimen library, Section 2 the six live parameter figures, references.
Three refinements of the same content live in `paper.css`, one class each:

| | class | arrangement |
|---|---|---|
| **A** journal | `.ms-a` | one column: heading, prose, then the figure at the same 620 px measure |
| **B** plate | `.ms-b` | heading across the measure, plate on the left, note on the right |
| **C** research note | `.ms-c` | number in a 52 px margin, note on the left, figure on the right |

All three set figure width with `--figw` (620 / 600 / 552 px) and use the same row
flex line: the heading takes the first line, then the figure and the note share the
second, both top aligned. `order` on `.og-text` and `.og-fig` decides which side the
figure lands on, so the markup stays in one order and Explore keeps its float layout.

Content is composed once in `index.tsx`; the figures are the same panel components the
Explore tab uses, so nothing is duplicated and the numbers stay identical.

Captions are real `<figcaption>` elements added by `Panel` in `src/ui.tsx`, and shown only
inside `.ms` (`.og-cap { display: none }` elsewhere), so the Explore page is unchanged.

## Keeping one

Delete the other two variants from `TABS` in `src/App.tsx` (and the two `Paper variant=...`
lines), keep only the one you want, then remove its `.ms-x` prefix from `paper.css` if you
want a single unscoped skin. The `ms-tag` line in the title block is the review label and
can go.
