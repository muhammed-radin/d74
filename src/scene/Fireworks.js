import * as THREE from 'three';
import { createParticleSprite } from './textures.js';

export class Fireworks {
  constructor() {
    this.count = 900;
    this.started = false;
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.baseColors = new Float32Array(this.count * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 0.18,
      map: createParticleSprite(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = 'final-fireworks';
  }

  burst() {
    const palette = [0xd7ff3f, 0x78e6ff, 0xf4f5f6, 0xa78bfa];
    const color = new THREE.Color();

    for (let i = 0; i < this.count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.15) * Math.PI * 0.65;
      const speed = 2.5 + Math.random() * 7.5;
      const radius = Math.random() * 2.5;

      this.positions[i * 3] = Math.cos(angle) * radius;
      this.positions[i * 3 + 1] = 9.5 + Math.random() * 4.5;
      this.positions[i * 3 + 2] = -8 + Math.sin(angle) * radius;

      this.velocities[i * 3] = Math.cos(angle) * Math.cos(elevation) * speed;
      this.velocities[i * 3 + 1] = Math.sin(elevation) * speed + 1.8;
      this.velocities[i * 3 + 2] = Math.sin(angle) * Math.cos(elevation) * speed;

      this.life[i] = 0.6 + Math.random() * 1.3;
      color.set(palette[Math.floor(Math.random() * palette.length)]);
      this.baseColors[i * 3] = color.r;
      this.baseColors[i * 3 + 1] = color.g;
      this.baseColors[i * 3 + 2] = color.b;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.visible = true;
  }

  update(dt, active) {
    if (!active) {
      this.points.visible = false;
      this.started = false;
      return;
    }

    if (!this.started) {
      this.burst();
      this.started = true;
    }

    let alive = false;
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      this.velocities[i * 3 + 1] -= 2.4 * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      const fade = Math.max(0, this.life[i] / 1.9);
      this.colors[i * 3] = this.baseColors[i * 3] * fade;
      this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1] * fade;
      this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2] * fade;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.visible = alive;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
