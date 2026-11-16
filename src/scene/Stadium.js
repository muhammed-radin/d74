import * as THREE from 'three';
import { createBeamMaterial } from '../shaders/beam.js';
import { createAdTexture, createParticleSprite } from './textures.js';

export class Stadium {
  constructor(quality) {
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    this.quality = quality;
    this.beamMaterial = createBeamMaterial(0xd7ff3f);
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();

    this.buildStands();
    this.buildCrowd();
    this.buildAdBoards();
    this.buildTunnel();
    this.buildFloodlights();
    this.buildLights();
  }

  buildStands() {
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(52, 52, 18, 72, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x06080a,
        side: THREE.BackSide,
        roughness: 1,
        metalness: 0,
      }),
    );
    outer.position.y = 9;
    this.group.add(outer);

    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(45, 45, 11, 72, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x090c0f,
        side: THREE.BackSide,
        roughness: 1,
        metalness: 0,
      }),
    );
    inner.position.y = 5.5;
    this.group.add(inner);

    const roof = new THREE.Mesh(
      new THREE.RingGeometry(38, 64, 72),
      new THREE.MeshStandardMaterial({
        color: 0x040507,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
    );
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = 17.5;
    this.group.add(roof);

    const count = 96;
    const lights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    lights.frustumCulled = false;

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 46.5;
      this.dummy.position.set(Math.cos(angle) * radius, 13.4, Math.sin(angle) * radius);
      this.dummy.rotation.set(0, -angle, 0);
      this.dummy.scale.setScalar(i % 7 === 0 ? 1.8 : 1);
      this.dummy.updateMatrix();
      lights.setMatrixAt(i, this.dummy.matrix);
      this.color.set(i % 5 === 0 ? 0x78e6ff : 0xd7ff3f);
      lights.setColorAt(i, this.color);
    }
    lights.instanceMatrix.needsUpdate = true;
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    this.group.add(lights);
  }

  buildCrowd() {
    const count = this.quality.label === 'low' ? 720 : 1500;
    const crowd = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, 0.32, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    crowd.frustumCulled = false;
    crowd.name = 'crowd';

    const radii = [39.5, 43.5, 47.5];
    for (let i = 0; i < count; i += 1) {
      const ring = i % 3;
      const radius = radii[ring] + (Math.random() - 0.5) * 1.1;
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.018;
      const y = 2.7 + ring * 3.15 + Math.random() * 0.7;

      this.dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      this.dummy.rotation.set(0, -angle, 0);
      this.dummy.scale.set(
        0.7 + Math.random() * 0.7,
        0.7 + Math.random() * 0.8,
        0.7 + Math.random() * 0.7,
      );
      this.dummy.updateMatrix();
      crowd.setMatrixAt(i, this.dummy.matrix);

      const pick = Math.random();
      if (pick > 0.94) this.color.set(0xd7ff3f);
      else if (pick > 0.86) this.color.set(0x78e6ff);
      else if (pick > 0.7) this.color.set(0x4a5560);
      else this.color.set(0x171d22);
      crowd.setColorAt(i, this.color);
    }

    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    this.crowd = crowd;
    this.group.add(crowd);

    const trussCount = 28;
    const trusses = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.1, 8.5),
      new THREE.MeshStandardMaterial({ color: 0x11161b, roughness: 0.6, metalness: 0.6 }),
      trussCount,
    );
    trusses.frustumCulled = false;
    for (let i = 0; i < trussCount; i += 1) {
      const angle = (i / trussCount) * Math.PI * 2;
      this.dummy.position.set(Math.cos(angle) * 45, 17.2, Math.sin(angle) * 45);
      this.dummy.rotation.set(0, -angle + Math.PI / 2, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      trusses.setMatrixAt(i, this.dummy.matrix);
    }
    trusses.instanceMatrix.needsUpdate = true;
    this.group.add(trusses);
  }

  buildAdBoards() {
    this.adTexture = createAdTexture('D74', '#d7ff3f');
    this.adMaterial = new THREE.MeshBasicMaterial({
      map: this.adTexture,
      toneMapped: false,
    });

    const geometry = new THREE.PlaneGeometry(8.4, 1.3);
    const placements = [
      [-12.6, 0.82, -13.7, 0],
      [-4.2, 0.82, -13.7, 0],
      [4.2, 0.82, -13.7, 0],
      [12.6, 0.82, -13.7, 0],
      [-12.6, 0.82, 13.7, Math.PI],
      [-4.2, 0.82, 13.7, Math.PI],
      [4.2, 0.82, 13.7, Math.PI],
      [12.6, 0.82, 13.7, Math.PI],
      [-21.4, 0.82, -6.5, Math.PI / 2],
      [-21.4, 0.82, 6.5, Math.PI / 2],
      [21.4, 0.82, -6.5, -Math.PI / 2],
      [21.4, 0.82, 6.5, -Math.PI / 2],
    ];

    for (const [x, y, z, rotation] of placements) {
      const board = new THREE.Mesh(geometry, this.adMaterial);
      board.position.set(x, y, z);
      board.rotation.y = rotation;
      this.group.add(board);
    }
  }

  buildTunnel() {
    this.tunnel = new THREE.Group();
    this.tunnel.name = 'floodlight-tunnel';

    const frameCount = 10;
    const barsPerFrame = 4;
    const bars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      frameCount * barsPerFrame,
    );
    bars.frustumCulled = false;

    let index = 0;
    for (let i = 0; i < frameCount; i += 1) {
      const z = 6.2 - i * 1.02;
      const scale = 1 - i * 0.012;
      const width = 6.2 * scale;
      const height = 5.2 * scale;
      const y = height / 2;

      this.dummy.rotation.set(0, 0, 0);
      this.dummy.position.set(0, height, z);
      this.dummy.scale.set(width, 0.075, 0.075);
      this.dummy.updateMatrix();
      bars.setMatrixAt(index, this.dummy.matrix);
      this.color.set(i % 2 === 0 ? 0xd7ff3f : 0x78e6ff);
      bars.setColorAt(index, this.color);
      index += 1;

      this.dummy.position.set(0, 0.04, z);
      this.dummy.scale.set(width, 0.075, 0.075);
      this.dummy.updateMatrix();
      bars.setMatrixAt(index, this.dummy.matrix);
      this.color.set(0x1b2228);
      bars.setColorAt(index, this.color);
      index += 1;

      this.dummy.position.set(-width / 2, y, z);
      this.dummy.scale.set(0.075, height, 0.075);
      this.dummy.updateMatrix();
      bars.setMatrixAt(index, this.dummy.matrix);
      this.color.set(0xd7ff3f);
      bars.setColorAt(index, this.color);
      index += 1;

      this.dummy.position.set(width / 2, y, z);
      this.dummy.scale.set(0.075, height, 0.075);
      this.dummy.updateMatrix();
      bars.setMatrixAt(index, this.dummy.matrix);
      this.color.set(0xd7ff3f);
      bars.setColorAt(index, this.color);
      index += 1;

      if (i % 2 === 0) {
        const light = new THREE.PointLight(i % 4 === 0 ? 0xd7ff3f : 0x78e6ff, 3.2, 8, 2);
        light.position.set(0, y, z);
        this.tunnel.add(light);
      }
    }

    bars.instanceMatrix.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    this.tunnel.add(bars);
    this.group.add(this.tunnel);
  }

  buildFloodlights() {
    this.floodlights = new THREE.Group();
    this.floodlights.name = 'floodlights';

    const poleMaterial = new THREE.MeshStandardMaterial({
      color: 0x11161b,
      roughness: 0.55,
      metalness: 0.7,
    });
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9ffb0,
      emissive: 0xd7ff3f,
      emissiveIntensity: 4,
      roughness: 0.3,
    });

    this.glowMaterial = new THREE.SpriteMaterial({
      map: createParticleSprite(),
      color: 0xd7ff3f,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const positions = [
      [-17, -18], [17, -18], [-17, 4], [17, 4],
    ];

    for (const [x, z] of positions) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.2, 12.5, 10),
        poleMaterial,
      );
      pole.position.set(x, 6.25, z);
      this.floodlights.add(pole);

      const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.55), headMaterial);
      head.position.set(x, 12.5, z);
      head.rotation.y = x < 0 ? -0.25 : 0.25;
      this.floodlights.add(head);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 3.8, 12.4, 20, 1, true),
        this.beamMaterial,
      );
      beam.position.set(x * 0.82, 6.3, z * 0.82);
      beam.rotation.z = x < 0 ? -0.14 : 0.14;
      beam.rotation.x = z < 0 ? 0.12 : -0.12;
      beam.renderOrder = 2;
      this.floodlights.add(beam);

      const glow = new THREE.PointLight(0xd7ff3f, 4.5, 18, 2);
      glow.position.set(x, 12.1, z);
      this.floodlights.add(glow);

      const sprite = new THREE.Sprite(this.glowMaterial);
      sprite.position.set(x, 12.5, z);
      sprite.scale.set(4.2, 4.2, 1);
      this.floodlights.add(sprite);
    }

    this.group.add(this.floodlights);
  }

  buildLights() {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.16);
    this.group.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x8fb7c9, 0x030405, 0.42);
    this.group.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xd7ff3f, 2.4);
    this.key.position.set(8, 15, 9);
    this.key.castShadow = this.quality.shadows;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -22;
    this.key.shadow.camera.right = 22;
    this.key.shadow.camera.top = 22;
    this.key.shadow.camera.bottom = -22;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 45;
    this.key.shadow.bias = -0.0004;
    this.group.add(this.key);

    this.rim = new THREE.PointLight(0x78e6ff, 8, 30, 2);
    this.rim.position.set(-8, 6, -10);
    this.group.add(this.rim);

    this.goalLight = new THREE.PointLight(0xd7ff3f, 3.5, 12, 2);
    this.goalLight.position.set(0, 3, -11);
    this.group.add(this.goalLight);
  }

  update(elapsed, progress) {
    this.beamMaterial.uniforms.uTime.value = elapsed;
    this.key.intensity = 2.2 + Math.sin(elapsed * 0.5) * 0.15;
    this.rim.intensity = 7.2 + Math.sin(elapsed * 0.8 + 1.2) * 0.8;
    this.goalLight.intensity = 3.2 + Math.sin(elapsed * 1.1) * 0.3 + progress * 0.8;
    if (this.adMaterial) this.adMaterial.color.setScalar(0.92 + Math.sin(elapsed * 1.7) * 0.06);
    if (this.glowMaterial) this.glowMaterial.opacity = 0.66 + Math.sin(elapsed * 0.8) * 0.08;
  }

  dispose() {
    this.group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    });
    this.beamMaterial.dispose();
  }
}