import * as THREE from "three";

/** Free the GPU resources (geometries, materials, textures) held by a scene graph. */
export function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const { value } of Object.values(u)) if (value instanceof THREE.Texture) value.dispose();
      mat.dispose();
    }
  });
}
