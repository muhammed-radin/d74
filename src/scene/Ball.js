import * as THREE from 'three';
import { createBallTextures, createShadowTexture } from './textures.js';
import { createGlowMaterial } from '../shaders/glow.js';
import { lerp, smoothstep } from '../utils/math.js';

export class Ball {
  constructor(renderer, quality) {
    this.group = new THREE.Group();
    this.group.name = 'football';
    this.progress = 0;
    this.quality = quality;

    const geometry = new THREE.SphereGeometry(
      0.62,
      quality.ballSegments,
      Math.max(24, Math.round(quality.ballSegments * 0.66)),
    );
    const { map, normalMap, roughnessMap } = createBallTextures(renderer, quality);
    const material = new THREE.MeshPhysicalMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.58, 0.58),
      roughnessMap,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.02,
      clearcoat: 0.9,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.45,
      specularIntensity: 0.72,
      specularColor: new THREE.Color(0xffffff),
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = quality.shadows;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'football-mesh';

    this.glowMaterial = createGlowMaterial(0xd7ff3f);
    const glowGeometry = new THREE.SphereGeometry(0.7, 48, 32);
    this.glow = new THREE.Mesh(glowGeometry, this.glowMaterial);
    this.glow.scale.setScalar(1.01);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: createShadowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), this.shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.58;
    this.shadow.renderOrder = 1;

    this.group.add(this.mesh, this.glow, this.shadow);
    this.group.position.set(0, 0.62, 0);

    this.trail = this.createTrail();
  }

  createTrail() {
    const count = 26;
    const positions = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, count);
    const material = new THREE.LineBasicMaterial({
      color: 0xd7ff3f,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    this.history = Array.from({ length: count }, () => new THREE.Vector3());
    return line;
  }

  update(progress, elapsed, dt, pointer) {
    this.progress = progress;
    const p = progress;
    let x = 0;
    let y = 0.62;
    let z = 0;
    let visible = true;

    if (p < 0.12) {
      y += Math.sin(elapsed * 1.35) * 0.075;
      x += Math.sin(elapsed * 0.6) * 0.02;
      z += Math.cos(elapsed * 0.5) * 0.02;
    } else if (p < 0.28) {
      const t = smoothstep(0.12, 0.28, p);
      x = Math.sin(t * Math.PI * 2.0) * 0.42;
      y = lerp(0.62, 2.05, t);
      z = lerp(0, -4.4, t);
    } else if (p < 0.36) {
      const t = smoothstep(0.28, 0.36, p);
      x = lerp(0.2, 0, t);
      y = lerp(2.05, 0.11, t);
      z = lerp(-4.4, -8.0, t);
    } else if (p < 0.5) {
      const t = smoothstep(0.36, 0.5, p);
      x = Math.sin(t * Math.PI) * 1.15;
      y = 0.11 + Math.sin(t * Math.PI * 0.88) * 1.36;
      z = lerp(-8.0, -12.0, t);
    } else if (p < 0.62) {
      const t = smoothstep(0.5, 0.62, p);
      x = lerp(0.1, 0.42, t);
      y = lerp(1.46, 0.2, t);
      z = lerp(-12.0, -10.25, t);
    } else if (p < 0.84) {
      visible = false;
    } else {
      const t = smoothstep(0.84, 1.0, p);
      x = 0;
      y = lerp(1.2, 6.2, t);
      z = lerp(-10.0, -8.0, t);
    }

    if (p < 0.12) {
      x += pointer.x * 0.2;
      y += pointer.y * 0.12;
    }

    this.group.visible = visible;
    this.group.position.set(x, y, z);
    this.trail.visible = visible && p > 0.3 && p < 0.63;

    const height = Math.max(0, y);
    this.shadow.position.y = -height + 0.035;
    this.shadow.scale.setScalar(0.82 + height * 0.075);
    this.shadowMaterial.opacity = 0.58 * Math.max(0.12, 1 - height / 8.5);

    const spin = elapsed * 0.42 + p * 26;
    this.mesh.rotation.x = spin * 0.7;
    this.mesh.rotation.y = spin;
    this.mesh.rotation.z = Math.sin(elapsed * 0.8) * 0.12;

    this.glowMaterial.uniforms.uTime.value = elapsed;
    this.glowMaterial.uniforms.uIntensity.value = 1.0 + Math.sin(elapsed * 2.2) * 0.12;

    if (this.trail.visible) {
      for (let i = this.history.length - 1; i > 0; i -= 1) {
        this.history[i].copy(this.history[i - 1]);
      }
      this.history[0].copy(this.group.position);
      const positions = this.trail.geometry.attributes.position.array;
      for (let i = 0; i < this.history.length; i += 1) {
        positions[i * 3] = this.history[i].x;
        positions[i * 3 + 1] = this.history[i].y;
        positions[i * 3 + 2] = this.history[i].z;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.material.opacity = 0.42 * (1 - smoothstep(0.58, 0.63, p));
    }
  }

  dispose() {
    this.group.traverse((child) => {
      if (!child.isMesh && !child.isLine) return;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    });
    this.trail.geometry.dispose();
    this.trail.material.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.normalMap?.dispose();
    this.mesh.material.roughnessMap?.dispose();
    this.shadowMaterial.map?.dispose();
  }
}