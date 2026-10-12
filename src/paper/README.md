# The manuscript page

`Paper({ variant })` renders the sandbox as one scroll you can read: title block, abstract,
Section 1 the specimen library, Section 2 the six live parameter figures, references.
Three refinements of the same content live in `paper.css`, one class each:

| | class | arrangement |
|---|---|---|
| **A** journal | `.ms-a` | one column of prose at 660 px, figures outdented to the full 1128 px, title and abstract centred |
| **B** plate atlas | `.ms-b` | each parameter is a ruled plate: heading on the rule, figure full width, notes in two columns beneath |
| **C** research note | `.ms-c` | the number in the margin, the note on the left (52 px gutter + measure), the figure on the right, hairline between rows |

Content is composed once in `index.tsx`; the figures are the same panel components the
Explore tab uses, so nothing is duplicated and the numbers stay identical.

Captions are real `<figcaption>` elements added by `Panel` in `src/ui.tsx`, and shown only
inside `.ms` (`.og-cap { display: none }` elsewhere), so the Explore page is unchanged.

## Keeping one

Delete the other two variants from `TABS` in `src/App.tsx` (and the two `Paper variant=...`
lines), keep only the one you want, then remove its `.ms-x` prefix from `paper.css` if you
want a single unscoped skin. The `ms-tag` line in the title block is the review label and
can go.
