/* =====================================================================
   Manuscript copy. Every chapter, metric description and figure caption
   lives here so the text can be edited without touching the 3-D code.
   ===================================================================== */

import type { ReactNode } from "react";

export const META = {
  title: "Trabecular Bone Morphometry: An Interactive Sandbox",
  author: "Felix Melanson",
  date: "October 2026",
};

export const ABSTRACT: ReactNode = (
  <>
    Micro-computed tomography (µCT) reduces trabecular bone to a small set of morphometric parameters. Each parameter is defined on the segmented
    voxel image; its value is therefore contingent upon threshold, voxel size and the algorithm used to compute it. This sandbox computes the
    standard parameters live from a synthetic trabecular volume, so the effect of each structural change on each metric can be observed directly.
    The standard parameters are presented first (Section 3). The proposed method and the new metrics follow in Sections 4 and 5.
  </>
);

export const Eq = ({ children }: { children: ReactNode }) => <div className="eq">{children}</div>;

/* ----------------------------- chapters ----------------------------- */

export const INTRO: ReactNode = (
  <>
    <p>
      Trabecular microarchitecture is reported in µCT studies through a standard nomenclature: bone volume fraction, connectivity density, trabecular
      thickness and separation, and degree of anisotropy (Bouxsein et al., 2010). Each value is a reduction of a 3D structure to a scalar. The
      reduction is useful because it is comparable across studies; it is limited because two structurally distinct specimens can share the same value.
    </p>
    <p>
      The sections below take each parameter in turn. Every row pairs the definition with a live specimen; the controls change the structure, and
      the metric is recomputed from the voxels on each change. Click and drag any 3D view to rotate it; the views also follow the cursor with a slight tilt.
    </p>
  </>
);

export const SPECIMEN: ReactNode = (
  <>
    <p>
      All specimens are generated procedurally as a two level cut Gaussian random field (Berk, 1987). A band pass random field <i>y</i> sets the
      cellular length scale, and an independent low frequency field <i>g</i> modulates the band width:
    </p>
    <Eq>
      <i>q</i>(<b>r</b>) = |<i>y</i>(<b>r</b>)| / (1 + <i>a</i>·<i>g</i>(<b>r</b>)),&emsp;bone = {"{"}
      <i>q</i> &lt; β{"}"}
    </Eq>
    <p>
      The threshold β sets BV/TV; because it is a pure threshold, the GPU resegments the volume instantly. The modulation strength <i>a</i>{" "}
      perforates plates into rods, which reproduces the plate to rod transition characteristic of osteoporotic bone. Volumes are 48 to 72 voxels per
      side at 65 µm, giving cubes of approximately 3 to 4.7 mm. The field is periodic and contains no imaging noise or partial volume blur, so
      every discrepancy between panels is attributable to the structure itself.
    </p>
    <p>
      Rendering is by GPU raymarching of the scalar field <i>q</i>. Views only render while their section is on screen and are otherwise
      idle; while a view is being rotated it renders at a slightly reduced resolution, and a full resolution frame is drawn once it stops.
    </p>
  </>
);

export const METHOD: ReactNode = (
  <p className="placeholder">
    Section in preparation. This chapter will describe the proposed analysis method and compare it against the standard parameters above on the
    same synthetic specimens.
  </p>
);

export const NEW_METRICS: ReactNode = (
  <p className="placeholder">
    Section in preparation. New metrics will be added here as rows in the same format as Section 3: definition, live specimen, controls and readouts.
  </p>
);

/* --------------------------- metric rows ---------------------------- */

/** `short` is the concise body used on the paper page; `body` is the full text used by the sandbox. */
export type MetricText = { title: ReactNode; abbr: ReactNode; body: ReactNode; short?: ReactNode; caption: ReactNode };

export const METRICS: Record<string, MetricText> = {
  "bv-tv": {
    title: "Bone volume fraction",
    abbr: "BV/TV [%]",
    body: (
      <>
        <p>BV/TV is the fraction of the volume of interest occupied by bone after segmentation.</p>
        <Eq>BV/TV = N<sub>bone</sub> / N<sub>total</sub></Eq>
        <p>
          It is the most frequently reported parameter and the most direct correlate of apparent stiffness. It is also the most threshold dependent;
          the slider moves the segmentation threshold on an unchanged greyscale field, and BV/TV follows it across the full physiological range.
          Thickness, separation and connectivity are all computed downstream of this threshold.
        </p>
      </>
    ),
    caption: (
      <>
        Left: synthetic specimen with the axial analysis plane outlined in black and the coronal plane in grey. Centre and right: binarised axial
        and coronal sections through the centre, bone white and marrow black. Cutting the specimen exposes the axial section in 3D.
      </>
    ),
  },
  "conn-d": {
    title: "Connectivity density",
    abbr: (
      <>
        Conn.D [mm<sup>−3</sup>]
      </>
    ),
    body: (
      <>
        <p>
          Connectivity counts the redundant loops in the trabecular network: the number of trabeculae that can be cut without separating the
          network into two parts. It is obtained from the Euler characteristic χ of the binary image (Odgaard &amp; Gundersen, 1993).
        </p>
        <Eq>
          χ = <i>V</i> − <i>E</i> + <i>F</i> − <i>C</i> = β<sub>0</sub> − β<sub>1</sub> + β<sub>2</sub>&emsp;Conn.D = β<sub>1</sub> / TV
        </Eq>
        <p>
          χ is evaluated by counting vertices, edges, faces and cubes of the bone voxel complex. Solving for β<sub>1</sub> requires
          β<sub>0</sub> (separate bone particles) and β<sub>2</sub> (enclosed marrow cavities). Following BoneJ, the image is first purified: only
          the largest bone particle is kept and enclosed cavities are filled, so β<sub>0</sub> = 1, β<sub>2</sub> = 0 and β<sub>1</sub> = 1 − χ.
          Without purification, the loose fragments of an osteoporotic network carry voxel scale loops of their own and inflate Conn.D. No boundary
          correction is applied, so absolute values are specific to this cube size.
        </p>
        <p>
          Conn.D counts loops; it is not a monotonic index of bone quality. Intact plates enclose few loops. Perforating a plate adds one loop per
          hole, so Conn.D rises in early plate loss; it falls only once rods disconnect. The three presets step through that sequence. At 65 µm,
          thin perforated films also carry voxel scale pinholes, which bias Conn.D upward in the fragmented case.
        </p>
      </>
    ),
    caption: <>Left: specimen whose perforation and BV/TV are set by the controls. Centre and right: axial and coronal sections through the same network. Conn.D is computed on the purified image.</>,
  },
  "tb-th": {
    title: "Trabecular thickness",
    abbr: "Tb.Th [mm]",
    body: (
      <>
        <p>
          Tb.Th is the model independent local thickness of the bone phase Ω (Hildebrand &amp; Rüegsegger, 1997). No plate or rod geometry is
          assumed; thickness is defined at every point by the spheres that fit inside the structure. Of all spheres <i>S</i>(<b>x</b>, <i>r</i>)
          that lie entirely within bone and contain the point <b>p</b>, the largest one sets the local thickness:
        </p>
        <Eq>
          τ(<b>p</b>) = 2 · max {"{"} <i>r</i> : <b>p</b> ∈ <i>S</i>(<b>x</b>, <i>r</i>) ⊆ Ω {"}"}
        </Eq>
        <p>Tb.Th is the mean of τ over the bone volume:</p>
        <Eq>
          Tb.Th = (1 / BV) ∫<sub>Ω</sub> τ(<b>p</b>) d<b>p</b> ≈ (1 / <i>N</i>
          <sub>bone</sub>) Σ τ(<b>p</b>)
        </Eq>
        <p>The definition is evaluated in three steps.</p>
        <ol className="steps">
          <li>
            An exact Euclidean distance transform gives <i>D</i>(<b>x</b>), the distance from each bone voxel to the nearest marrow voxel
            (Felzenszwalb &amp; Huttenlocher, 2012). <i>D</i>(<b>x</b>) is the radius of the largest sphere centred at <b>x</b>.
          </li>
          <li>
            Spheres contained in a larger sphere are redundant. The remaining maximal spheres are centred on the ridge of <i>D</i>, the medial axis
            of the trabeculae.
          </li>
          <li>Each voxel is assigned the diameter 2<i>D</i>(<b>x</b>) of the largest ridge sphere that covers it.</li>
        </ol>
        <p>
          The right panel of the figure illustrates the definition on a single idealised trabecula: each sphere is centred on the strut axis and its
          diameter equals the local strut thickness exactly, so the chain shrinks where the strut tapers. The slider thickens the struts of both the
          illustration and the specimen; the spheres and the colour map follow. Values approaching the voxel size
          are poorly resolved, which constrains what 65 µm data can report for thin rods.
        </p>
      </>
    ),
    caption: (
      <>
        Left to right: colour bar and histogram of local thickness, specimen coloured by local thickness, section at the analysis plane, and a
        schematic trabecula with its chain of maximal inscribed spheres; each sphere diameter is the local Tb.Th.
      </>
    ),
  },
  "tb-sp": {
    title: "Trabecular separation",
    abbr: "Tb.Sp [mm]",
    body: (
      <>
        <p>
          Tb.Sp applies the identical sphere fitting to the marrow phase Ω<sub>m</sub>, the complement of bone. The local separation at a point is
          the diameter of the largest sphere that contains it and fits entirely in marrow:
        </p>
        <Eq>
          τ<sub>m</sub>(<b>p</b>) = 2 · max {"{"} <i>r</i> : <b>p</b> ∈ <i>S</i>(<b>x</b>, <i>r</i>) ⊆ Ω<sub>m</sub> {"}"}
        </Eq>
        <Eq>
          Tb.Sp = (1 / (TV − BV)) ∫<sub>Ω<sub>m</sub></sub> τ<sub>m</sub>(<b>p</b>) d<b>p</b>
        </Eq>
        <p>
          The distance transform is now taken from each marrow voxel to the nearest bone voxel, and the maximal spheres sit on the medial axis of
          the pores. The right panel of the figure illustrates this on idealised struts: each sphere sits where the clearance to the surrounding struts
          is largest, and its radius is that clearance minus the strut radius. Thickening the struts encroaches on the marrow space, and every
          sphere shrinks by exactly the added strut radius.
        </p>
        <p>
          Tb.Sp is not the inverse of Tb.Th; it responds to trabecular number and spatial arrangement as well as thickness. The separation
          distribution is wider than the thickness distribution, and its upper tail is truncated by the specimen size, so large pores near the cube
          boundary are underestimated.
        </p>
      </>
    ),
    caption: <>Layout as for Tb.Th, with the marrow phase measured instead of bone. Right: schematic pores with the largest sphere that fits in each.</>,
  },
  da: {
    title: "Degree of anisotropy",
    abbr: "DA [0, 1]",
    body: (
      <>
        <p>
          DA quantifies the preferred orientation of the trabecular fabric. A second rank fabric tensor is computed and DA is derived from its
          eigenvalues.
        </p>
        <Eq>DA = 1 − λ<sub>min</sub> / λ<sub>max</sub></Eq>
        <p>
          The standard fabric tensor is the mean intercept length (Harrigan &amp; Mann, 1984). This panel uses the gradient structure tensor instead,
          whose smallest eigenvalue eigenvector lies along the trabeculae. DA is 0 for an isotropic structure and approaches 1 as trabeculae align.
          Some software reports λ<sub>max</sub> / λ<sub>min</sub>, which ranges from 1 upward; the two conventions are not interchangeable.
        </p>
        <p>
          Sections 3.6 and 3.7 compute the two classical alternatives on a specimen of the same kind. MIL counts bone and marrow boundary crossings along test
          lines, so it only sees the interface; anisotropy that does not change interface density is invisible to it (Odgaard, 1997). SVD is volume
          based: from random points in the marrow, rays run until they meet bone, and the cubed intercepts are averaged by direction (the marrow
          star volume). It needs many points per direction, and a few large marrow spaces dominate the cubed lengths in a specimen this small. The
          structure tensor uses every voxel in a single pass and varies smoothly with direction, which is why it is the fabric estimate used here.
        </p>
      </>
    ),
    caption: <>Fixed frontal view of the specimen with the in-plane fabric ellipse (long axis along the struts, axes from the structure tensor eigenvalues) and its principal axis; the loading direction slider rotates the fabric.</>,
  },
  mil: {
    title: "Mean intercept length",
    abbr: "MIL(θ) [mm]",
    body: (
      <>
        <p>
          A family of parallel test lines is laid across the section at angle θ, and every point where a line enters bone is counted. MIL is the line
          length per entry, the mean distance between bone boundaries along that direction.
        </p>
        <Eq>MIL(θ) = L / N(θ)</Eq>
        <p>
          Repeating this over all θ gives a rose; fitting an ellipse (in 3D, an ellipsoid, the MIL fabric tensor) to it gives the fabric that DA is
          computed from (Harrigan &amp; Mann, 1984). MIL only sees the bone and marrow interface: two structures with the same interface density along a
          direction give the same MIL, however differently their volume is arranged (Odgaard, 1997). The count also depends on line spacing and on how
          the lines fall against the voxel grid.
        </p>
      </>
    ),
    caption: <>Analysis section, bone gold and marrow navy. White test lines cross the section at angle θ and sweep through 180°; white dots mark each entry into bone. The rose collects MIL over all θ (solid) beside the structure tensor rose of the same volume (dashed).</>,
  },
  svd: {
    title: "Star volume distribution",
    abbr: "V*m [mm³]",
    body: (
      <>
        <p>
          From random points in the marrow, rays are sent in many directions until each meets bone. The marrow star volume is the mean volume visible
          from a marrow point, and the distribution of ray lengths by direction is the SVD fabric.
        </p>
        <Eq>V* = (4π / 3) · ⟨l³⟩</Eq>
        <p>
          Because intercepts are cubed, a few long rays through large marrow spaces dominate the estimate, and it needs many points per direction to be
          stable; new points on the same specimen visibly change the stars. The structure tensor avoids both problems by using every voxel in one pass.
          Here the stars are drawn in the plane of the analysis section.
        </p>
      </>
    ),
    caption: <>Analysis section, marrow black and bone grey. From the marrow points with the most room, red rays run until they meet bone. The rose shows SVD(θ) for two independent sets of marrow points (solid and dashed); their disagreement is the sampling noise.</>,
  },
  ef: {
    title: "Ellipsoid factor",
    abbr: "EF [−1, +1]",
    body: (
      <>
        <p>
          EF classifies local trabecular shape as plate or rod (Doube, 2015). Maximal ellipsoids are fitted inside the structure, and each is
          reduced to a single value from its semi axes <i>a</i> ≤ <i>b</i> ≤ <i>c</i>.
        </p>
        <Eq>
          EF = <i>a</i>/<i>b</i> − <i>b</i>/<i>c</i>
        </Eq>
        <p>
          Oblate, plate like ellipsoids give EF → −1; prolate, rod like ellipsoids give EF → +1. The figure approximates local shape with structure tensor ellipsoids rather than the maximal ellipsoid fitting of BoneJ,
          and adds the nematic order parameter <i>S</i> of the trabecular director field.
        </p>
      </>
    ),
    caption: <>The specimen nearly transparent, with local fabric ellipsoids in bronze, silver and gold by alignment with the director N̂, the eigenframe of Q, and the gold cones of mean deviation β̄ about ±N̂.</>,
  },
};

/* ------------------------ concise paper text ------------------------- */

const PAPER: Record<string, Pick<MetricText, "short" | "caption">> = {
  "bv-tv": {
    short: (
      <>
        <p>The fraction of the volume of interest occupied by bone after segmentation.</p>
        <Eq>BV/TV = N<sub>bone</sub> / N<sub>total</sub></Eq>
        <p>
          It is the most reported parameter and the most threshold dependent. The slider moves the threshold on an unchanged greyscale field; every
          other metric is computed downstream of it.
        </p>
      </>
    ),
    caption: <>Specimen with the axial (black) and coronal (grey) planes, and the binarised section at each; bone white, marrow black.</>,
  },
  "conn-d": {
    short: (
      <>
        <p>
          Connectivity counts redundant loops: the trabeculae that can be cut without disconnecting the network. It follows from the Euler
          characteristic χ of the purified image (Odgaard &amp; Gundersen, 1993).
        </p>
        <Eq>
          χ = β<sub>0</sub> − β<sub>1</sub> + β<sub>2</sub>&emsp;Conn.D = β<sub>1</sub> / TV
        </Eq>
        <p>
          Conn.D is not monotonic in bone quality. Perforating a plate adds a loop per hole, so it rises in early plate loss and falls only once rods
          disconnect.
        </p>
      </>
    ),
    caption: <>Specimen and grey sections at the axial and coronal planes. Conn.D is computed on the purified image.</>,
  },
  "tb-th": {
    short: (
      <>
        <p>
          The model independent local thickness of bone (Hildebrand &amp; Rüegsegger, 1997): at each point, the diameter of the largest sphere that
          contains it and fits inside bone.
        </p>
        <Eq>
          τ(<b>p</b>) = 2 · max {"{"} <i>r</i> : <b>p</b> ∈ <i>S</i>(<b>x</b>, <i>r</i>) ⊆ Ω {"}"}
        </Eq>
        <p>
          Tb.Th is the mean of τ over bone, computed from the Euclidean distance transform with only the maximal spheres on the medial axis kept.
          Values near the voxel size are poorly resolved.
        </p>
      </>
    ),
    caption: <>Colour bar and histogram, specimen coloured by local thickness, section at the analysis plane, and a schematic strut with its maximal inscribed spheres.</>,
  },
  "tb-sp": {
    short: (
      <>
        <p>The same sphere fitting applied to marrow: the diameter of the largest sphere that contains each point and fits inside marrow.</p>
        <Eq>
          τ<sub>m</sub>(<b>p</b>) = 2 · max {"{"} <i>r</i> : <b>p</b> ∈ <i>S</i>(<b>x</b>, <i>r</i>) ⊆ Ω<sub>m</sub> {"}"}
        </Eq>
        <p>
          Tb.Sp is not the inverse of Tb.Th; it also responds to trabecular number and arrangement. Pores at the cube boundary are truncated, so large
          separations are underestimated.
        </p>
      </>
    ),
    caption: <>As for Tb.Th, measured on marrow. Right: the largest sphere that fits each pore.</>,
  },
  da: {
    short: (
      <>
        <p>DA measures preferred orientation from the eigenvalues of a fabric tensor. It is 0 for an isotropic structure and approaches 1 as trabeculae align.</p>
        <Eq>DA = 1 − λ<sub>min</sub> / λ<sub>max</sub></Eq>
        <p>
          The fabric here is the gradient structure tensor, which uses every voxel in one pass. The two classical estimates sit below it. MIL counts
          boundary crossings along test lines, so it only sees the interface (Harrigan &amp; Mann, 1984). SVD averages cubed ray lengths from marrow
          points, so a few large pores dominate and it needs many points to be stable.
        </p>
      </>
    ),
    caption: (
      <>
        Top: frontal views of an isotropic and an anisotropic specimen; dashed lines follow the local strut direction from the structure tensor. Bottom:
        MIL test lines and SVD stars on the analysis section of the anisotropic specimen, with their roses.
      </>
    ),
  },
  ef: {
    short: (
      <>
        <p>EF classifies local shape as plate or rod from the semi axes <i>a</i> ≤ <i>b</i> ≤ <i>c</i> of ellipsoids fitted inside the structure (Doube, 2015).</p>
        <Eq>
          EF = <i>a</i>/<i>b</i> − <i>b</i>/<i>c</i>
        </Eq>
        <p>
          Plates give EF → −1 and rods EF → +1. Here local shape comes from structure tensor ellipsoids, coloured by their alignment with the director
          N̂; S is the nematic order parameter of the field.
        </p>
      </>
    ),
    caption: <>Solid specimen, and the same specimen nearly transparent with its fabric ellipsoids, director N̂ and cone of mean deviation β̄.</>,
  },
};
for (const [k, v] of Object.entries(PAPER)) Object.assign(METRICS[k], v);

/* ---------------------------- references ---------------------------- */

export const REFERENCES: ReactNode[] = [
  <>Berk NF. Scattering properties of a model bicontinuous structure with a well defined length scale. Phys Rev Lett. 1987;58:2718–2721.</>,
  <>
    Bouxsein ML, Boyd SK, Christiansen BA, Guldberg RE, Jepsen KJ, Müller R. Guidelines for assessment of bone microstructure in rodents using
    micro-computed tomography. J Bone Miner Res. 2010;25(7):1468–1486.
  </>,
  <>Doube M. The ellipsoid factor for quantification of rods, plates, and intermediate forms in 3D geometries. Front Endocrinol. 2015;6:15.</>,
  <>Doube M, Kłosowski MM, Arganda-Carreras I, et al. BoneJ: free and extensible bone image analysis in ImageJ. Bone. 2010;47(6):1076–1079.</>,
  <>Felzenszwalb PF, Huttenlocher DP. Distance transforms of sampled functions. Theory Comput. 2012;8:415–428.</>,
  <>Harrigan TP, Mann RW. Characterization of microstructural anisotropy in orthotropic materials using a second rank tensor. J Mater Sci. 1984;19:761–767.</>,
  <>Hildebrand T, Rüegsegger P. A new method for the model-independent assessment of thickness in three-dimensional images. J Microsc. 1997;185(1):67–75.</>,
  <>Odgaard A. Three-dimensional methods for quantification of cancellous bone architecture. Bone. 1997;20(4):315–328.</>,
  <>Odgaard A, Gundersen HJG. Quantification of connectivity in cancellous bone, with special emphasis on 3-D reconstructions. Bone. 1993;14(2):173–182.</>,
];
