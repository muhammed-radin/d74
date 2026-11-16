import * as THREE from 'three';

/* Builds a tiny emissive "studio stadium" and bakes it into a PMREM
   environment map. This gives the ball and metal goal frame real
   reflections without downloading an HDR file. */
export function createEnvironment(renderer, scene) {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x020304);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(24, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x04070a, side: THREE.BackSide }),
  );
  envScene.add(sphere);

  const plane = new THREE.PlaneGeometry(1, 1);
  const panel = (color, intensity, position, rotation, scale) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(plane, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    envScene.add(mesh);
    return mesh;
  };

  // Overhead key, cool side fills, warm rim and a white back edge.
  panel(0xd7ff3f, 5.5, [0, 14, 0], [Math.PI / 2, 0, 0], [10, 10, 1]);
  panel(0x78e6ff, 3.2, [-12, 5, -2], [0, Math.PI / 2, 0], [8, 8, 1]);
  panel(0xd7ff3f, 2.6, [12, 4, 2], [0, -Math.PI / 2, 0], [7, 7, 1]);
  panel(0xf4f5f6, 2.2, [0, 6, -14], [0, 0, 0], [12, 4, 1]);
  panel(0xa78bfa, 1.5, [0, 2, 14], [0, Math.PI, 0], [6, 3, 1]);
  panel(0xffffff, 4.0, [0, 12.8, -3], [Math.PI / 2, 0, 0], [4, 1, 1]);

  let pmrem = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(envScene, 0.035);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.9;
    return target.texture;
  } catch (error) {
    console.warn('[D74] PMREM environment bake failed.', error);
    return null;
  } finally {
    envScene.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      child.material.dispose();
    });
    plane.dispose();
    pmrem?.dispose();
  }
}
