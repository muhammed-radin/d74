import * as THREE from 'three';
import { createPitchTexture, createGrassBumpTexture } from './textures.js';
import { createNetMaterial } from '../shaders/net.js';
import { clamp, smoothstep } from '../utils/math.js';

export class Pitch {
  constructor(renderer, quality) {
    this.group = new THREE.Group();
    this.group.name = 'pitch';
    this.quality = quality;

    const pitchTexture = createPitchTexture(renderer);
    const grassBump = createGrassBumpTexture();
    const pitchGeometry = new THREE.PlaneGeometry(40, 24, 1, 1);
    const pitchMaterial = new THREE.MeshStandardMaterial({
      map: pitchTexture,
      bumpMap: grassBump,
      bumpScale: 0.028,
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.04,
      envMapIntensity: 0.5,
    });
    const pitch = new THREE.Mesh(pitchGeometry, pitchMaterial);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0.015;
    pitch.receiveShadow = true;
    pitch.name = 'pitch-surface';
    this.group.add(pitch);

    const surroundGeometry = new THREE.PlaneGeometry(120, 80);
    const surroundMaterial = new THREE.MeshStandardMaterial({
      color: 0x050806,
      roughness: 1,
      metalness: 0,
    });
    const surround = new THREE.Mesh(surroundGeometry, surroundMaterial);
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    surround.receiveShadow = true;
    this.group.add(surround);

    this.centerGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xd7ff3f,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.centerGlow = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.3, 72), this.centerGlowMaterial);
    this.centerGlow.rotation.x = -Math.PI / 2;
    this.centerGlow.position.y = 0.028;
    this.group.add(this.centerGlow);

    this.netMaterial = createNetMaterial();
    this.buildGoal();
    this.group.add(this.goal);
    this.pitch = pitch;
  }

  buildGoal() {
    this.goal = new THREE.Group();
    this.goal.name = 'goal';
    this.goal.position.set(0, 0, -12.35);

    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f5f0,
      roughness: 0.2,
      metalness: 0.72,
      envMapIntensity: 1.2,
    });
    const postRadius = 0.065;
    const width = 7.32;
    const height = 2.44;
    const half = width / 2;

    const postGeometry = new THREE.CylinderGeometry(postRadius, postRadius, height, 12);
    const left = new THREE.Mesh(postGeometry, postMaterial);
    left.position.set(-half, height / 2, 0);
    left.castShadow = this.quality.shadows;
    const right = left.clone();
    right.position.x = half;

    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(postRadius, postRadius, width, 12),
      postMaterial,
    );
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, height, 0);
    crossbar.castShadow = this.quality.shadows;

    this.goal.add(left, right, crossbar);

    const netGeometry = new THREE.PlaneGeometry(
      width,
      height,
      this.quality.netSegments[0],
      this.quality.netSegments[1],
    );
    const netPositions = netGeometry.attributes.position;
    for (let i = 0; i < netPositions.count; i += 1) {
      const nx = netPositions.getX(i) / (width / 2);
      const ny = netPositions.getY(i) / (height / 2);
      netPositions.setZ(i, -0.09 * Math.cos(nx * Math.PI * 0.5) * Math.cos(ny * Math.PI * 0.5));
    }
    netPositions.needsUpdate = true;
    netGeometry.computeVertexNormals();
    const net = new THREE.Mesh(netGeometry, this.netMaterial);
    net.position.set(0, height / 2, -0.18);
    net.name = 'goal-net';
    this.goal.add(net);
    this.net = net;

    // Side nets use the same shader; the hit point is intentionally only
    // meaningful on the back panel, which is the one the camera sees.
    const sideGeometry = new THREE.PlaneGeometry(1.8, height, 18, 10);
    const sideLeft = new THREE.Mesh(sideGeometry, this.netMaterial);
    sideLeft.rotation.y = Math.PI / 2;
    sideLeft.position.set(-half, height / 2, -0.9);
    const sideRight = sideLeft.clone();
    sideRight.position.x = half;
    this.goal.add(sideLeft, sideRight);

    const topGeometry = new THREE.PlaneGeometry(width, 1.8, 36, 10);
    const top = new THREE.Mesh(topGeometry, this.netMaterial);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, height, -0.9);
    this.goal.add(top);

    const supportMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa39d,
      roughness: 0.4,
      metalness: 0.5,
    });
    const supportGeometry = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8);
    const supportLeft = new THREE.Mesh(supportGeometry, supportMaterial);
    supportLeft.position.set(-half, 1.25, -1.78);
    supportLeft.rotation.x = -0.45;
    const supportRight = supportLeft.clone();
    supportRight.position.x = half;
    this.goal.add(supportLeft, supportRight);
  }

  update(progress, elapsed, ballPosition) {
    this.netMaterial.uniforms.uTime.value = elapsed;
    this.centerGlowMaterial.opacity = 0.13 + Math.sin(elapsed * 1.3) * 0.045;
    this.centerGlow.scale.setScalar(1 + Math.sin(elapsed * 1.1) * 0.025);

    const hit = smoothstep(0.46, 0.495, progress) * (1 - smoothstep(0.495, 0.56, progress));
    this.netMaterial.uniforms.uHit.value = hit;

    const localX = clamp(ballPosition.x, -3.6, 3.6);
    const localY = clamp(ballPosition.y - 1.22, -1.18, 1.18);
    this.netMaterial.uniforms.uHitPoint.value.set(localX, localY);
  }

  dispose() {
    this.group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    });
    this.pitch.material.map?.dispose();
    this.pitch.material.bumpMap?.dispose();
    this.netMaterial.dispose();
  }
}