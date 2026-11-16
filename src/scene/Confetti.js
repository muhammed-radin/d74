import * as THREE from 'three';

export class Confetti {
  constructor(quality) {
    this.max = 420;
    this.quality = quality;
    this.items = [];
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();

    const geometry = new THREE.PlaneGeometry(0.055, 0.11);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'confetti';

    for (let i = 0; i < this.max; i += 1) {
      this.items.push({
        x: (Math.random() - 0.5) * 38,
        y: 6 + Math.random() * 18,
        z: 2 - Math.random() * 24,
        vx: (Math.random() - 0.5) * 1.6,
        vy: -0.5 - Math.random() * 1.1,
        vz: (Math.random() - 0.5) * 1.2,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        sx: 0.4 + Math.random() * 0.9,
        sy: 0.4 + Math.random() * 0.9,
        sz: 0.4 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
      });
      const pick = Math.random();
      this.color.set(pick > 0.6 ? 0x78e6ff : pick > 0.25 ? 0xd7ff3f : 0xf4f5f6);
      this.mesh.setColorAt(i, this.color);
      this.updateMatrix(i, 0);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.setCount(quality.confetti);
  }

  setCount(count) {
    const next = Math.max(0, Math.min(this.max, Math.round(count)));
    this.mesh.count = next;
    this.mesh.visible = next > 0;
    this.active = next > 0;
  }

  updateMatrix(index, elapsed) {
    const item = this.items[index];
    const sway = Math.sin(elapsed * 1.7 + item.phase) * 0.18;
    this.dummy.position.set(item.x + sway, item.y, item.z);
    this.dummy.rotation.set(item.rx, item.ry + sway, item.rz);
    this.dummy.scale.set(item.sx, item.sy, item.sz);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  update(dt, active, elapsed) {
    const visible = Boolean(active && this.mesh.count > 0);
    this.mesh.visible = visible;
    if (!visible) return;

    const count = this.mesh.count;
    for (let i = 0; i < count; i += 1) {
      const item = this.items[i];
      item.vy -= 0.28 * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.z += item.vz * dt;
      item.rx += item.sx * dt;
      item.ry += item.sy * dt;
      item.rz += item.sz * dt;

      if (item.y < 0.1) {
        item.y = 14 + Math.random() * 8;
        item.x = (Math.random() - 0.5) * 38;
        item.z = 2 - Math.random() * 24;
        item.vy = -0.5 - Math.random() * 1.1;
      }

      this.updateMatrix(i, elapsed);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
