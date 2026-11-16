import * as THREE from 'three';
import { createParticleSprite } from './textures.js';

export class Dust {
  constructor(quality) {
    this.max = quality.particles;
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.speeds = new Float32Array(this.max);
    this.drift = new Float32Array(this.max);

    for (let i = 0; i < this.max; i += 1) {
      this.positions[i * 3] = (Math.random() - 0.5) * 44;
      this.positions[i * 3 + 1] = 0.2 + Math.random() * 16;
      this.positions[i * 3 + 2] = 8 - Math.random() * 30;
      this.speeds[i] = 0.04 + Math.random() * 0.14;
      this.drift[i] = (Math.random() - 0.5) * 0.05;

      const pick = Math.random();
      const color = new THREE.Color(
        pick > 0.72 ? 0x78e6ff : pick > 0.36 ? 0xd7ff3f : 0xf4f5f6,
      );
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, this.max);

    const sprite = createParticleSprite();
    this.material = new THREE.PointsMaterial({
      size: quality.dustSize,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'stadium-dust';
    this.quality = quality;
  }

  setDensity(count) {
    const next = Math.max(0, Math.min(this.max, Math.round(count)));
    this.points.geometry.setDrawRange(0, next);
    this.points.visible = next > 0;
    this.material.size = this.quality.dustSize;
  }

  update(dt, elapsed) {
    if (!this.points.visible) return;
    const count = this.points.geometry.drawRange.count;
    const positions = this.positions;

    for (let i = 0; i < count; i += 1) {
      const index = i * 3;
      positions[index + 1] += this.speeds[i] * dt;
      positions[index] += this.drift[i] * dt;
      if (positions[index + 1] > 16.5) {
        positions[index + 1] = 0.15;
        positions[index] = (Math.random() - 0.5) * 44;
        positions[index + 2] = 8 - Math.random() * 30;
      }
      positions[index] += Math.sin(elapsed * 0.25 + i) * 0.0007;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = 0.55 + Math.sin(elapsed * 0.4) * 0.08;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
