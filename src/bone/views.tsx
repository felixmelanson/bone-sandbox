import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Viewable } from "./raymarch";
import { disposeScene } from "./dispose";

/* Each view owns a WebGL renderer bound to its own canvas, created when the
   view mounts and destroyed (context released) when it unmounts. An earlier
   design shared one offscreen renderer and copied every frame into 2-D
   canvases; in Firefox each copy is a GPU-to-CPU readback and each resize
   reallocates the drawing buffer, which is what made the page heavy. */

let glOK: boolean | undefined;
/** Whether WebGL2 is available (checked once). */
export function hasWebGL() {
  if (glOK === undefined) {
    try {
      glOK = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      glOK = false;
    }
  }
  return glOK;
}

/**
 * Renderer on a brand-new canvas appended to `host`. A fresh canvas per mount matters: after
 * forceContextLoss a canvas cannot get a working context again, and React dev mode mounts twice.
 * Returns null if WebGL could not start (the caller shows a message instead of crashing the page).
 */
export function createRendererIn(host: HTMLElement, className = "block h-full w-full") {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.style.touchAction = "pan-y";
  host.prepend(canvas);
  try {
    return createRenderer(canvas);
  } catch {
    canvas.remove();
    return null;
  }
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  return r;
}

export function destroyRenderer(r: THREE.WebGLRenderer) {
  envs.get(r)?.dispose();
  envs.delete(r);
  r.dispose();
  r.forceContextLoss();
  r.domElement.remove();
}

/** Mark a scene as wanting the studio reflection map; it is attached per renderer when the scene is shown. */
export function markStudio(scene: THREE.Scene) {
  scene.userData.studio = true;
}

const envs = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
/** Studio reflection map built on (and owned by) one renderer. */
export function attachStudio(scene: THREE.Scene, r: THREE.WebGLRenderer) {
  if (!scene.userData.studio) return;
  let t = envs.get(r);
  if (!t) {
    const pm = new THREE.PMREMGenerator(r);
    t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    envs.set(r, t);
  }
  scene.environment = t;
}

/** Max cursor tilt in radians (about 3.5 degrees). */
const TILT = 0.06;

export function Viewer({
  view,
  alt,
  hint = true,
  interactive = true,
  maxDpr = 1.25,
}: {
  view: Viewable | null;
  alt: string;
  hint?: boolean;
  /** false = fixed camera: no drag, no cursor tilt. */
  interactive?: boolean;
  /** cap on device pixel ratio (raymarched volumes are costly per pixel) */
  maxDpr?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const [touched, setTouched] = useState(false);
  const [nogl, setNogl] = useState(() => typeof window !== "undefined" && !hasWebGL());

  useEffect(() => {
    const h = host.current;
    if (!h || !view || nogl) return;
    const r = createRendererIn(h, `block h-full w-full ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`);
    if (!r) {
      setNogl(true);
      return;
    }
    const c = r.domElement;
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", alt);
    attachStudio(view.scene, r);
    let raf = 0;
    let dragging = false;
    let visible = false;
    let dirty = true;
    let size = "";
    const tilt = { tx: 0, ty: 0, x: 0, y: 0 };
    const rc = new THREE.PerspectiveCamera();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();

    const draw = () => {
      const box = c.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const key = `${box.width}x${box.height}@${dpr}`;
      if (key !== size) {
        size = key;
        r.setPixelRatio(dpr);
        r.setSize(box.width, box.height, false);
        if (ov.current) {
          ov.current.width = Math.round(box.width * dpr);
          ov.current.height = Math.round(box.height * dpr);
        }
      }
      const cam = view.camera;
      cam.aspect = box.width / box.height;
      cam.updateProjectionMatrix();
      rc.copy(cam);
      if (tilt.x || tilt.y) {
        up.set(0, 1, 0).applyQuaternion(cam.quaternion);
        right.set(1, 0, 0).applyQuaternion(cam.quaternion);
        rc.position.applyAxisAngle(up, -tilt.x * TILT).applyAxisAngle(right, -tilt.y * TILT);
        rc.lookAt(0, 0, 0);
      }
      rc.updateMatrixWorld();
      r.render(view.scene, rc);
      const o = ov.current;
      if (o && view.overlay) {
        const ctx = o.getContext("2d")!;
        ctx.clearRect(0, 0, o.width, o.height);
        view.overlay(ctx, rc, o.width, o.height);
      }
    };

    const controls = interactive ? new OrbitControls(view.camera, c) : null;
    if (controls) {
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.18;
      controls.rotateSpeed = 0.9;
    }
    const easeTilt = () => {
      const dx = tilt.tx - tilt.x;
      const dy = tilt.ty - tilt.y;
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) {
        tilt.x = tilt.tx;
        tilt.y = tilt.ty;
        return false;
      }
      tilt.x += dx * 0.1;
      tilt.y += dy * 0.1;
      return true;
    };
    const frame = () => {
      raf = 0;
      if (!visible) {
        dirty = true;
        return;
      }
      dirty = false;
      const moved = controls ? controls.update() : false;
      const live = moved || easeTilt() || view.tick() || dragging;
      draw();
      // controls.update() fires "change" synchronously, which may already have queued the next frame;
      // queueing again here started a second loop on every drag, doubling until thousands of renders ran per frame
      if (live && !raf) raf = requestAnimationFrame(frame);
    };
    const invalidate = () => {
      if (!visible) dirty = true;
      else if (!raf) raf = requestAnimationFrame(frame);
    };

    if (controls) {
      controls.addEventListener("change", () => {
        invalidate();
        view.peers?.forEach((v) => v.onChange());
      });
      controls.addEventListener("start", () => {
        dragging = true;
        tilt.tx = tilt.ty = 0;
        setTouched(true);
        invalidate();
      });
      controls.addEventListener("end", () => {
        dragging = false;
        invalidate();
      });
    }
    const move = (e: PointerEvent) => {
      if (!controls || e.pointerType !== "mouse" || dragging) return;
      const b = c.getBoundingClientRect();
      tilt.tx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1));
      tilt.ty = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height) * 2 - 1));
      invalidate();
    };
    const leave = () => {
      tilt.tx = tilt.ty = 0;
      invalidate();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerleave", leave);

    view.onChange = invalidate;
    const ro = new ResizeObserver(invalidate);
    ro.observe(c);
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible && dirty) invalidate();
        if (!visible) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { rootMargin: "120px" }
    );
    io.observe(c);
    return () => {
      ro.disconnect();
      io.disconnect();
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerleave", leave);
      controls?.dispose();
      cancelAnimationFrame(raf);
      view.onChange = () => {};
      disposeScene(view.scene);
      destroyRenderer(r);
    };
  }, [view, interactive, maxDpr, nogl, alt]);

  return (
    <div ref={host} className="relative h-full w-full">
      {view?.overlay && <canvas ref={ov} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />}
      {!view && !nogl && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="h-2/5 w-2/5 animate-pulse rounded-full bg-stone-200/80 blur-2xl" />
        </div>
      )}
      {nogl && <p className="absolute inset-0 grid place-items-center text-center text-xs text-stone-500">3-D view unavailable (WebGL could not start)</p>}
      {hint && interactive && view && !touched && (
        <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/85 px-3 py-1 text-[12.5px] text-stone-600 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          click and drag to rotate
        </span>
      )}
    </div>
  );
}
