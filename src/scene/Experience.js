import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteChromaShader } from '../shaders/post.js';
import { Ball } from './Ball.js';
import { Pitch } from './Pitch.js';
import { Stadium } from './Stadium.js';
import { Dust } from './Dust.js';
import { Confetti } from './Confetti.js';
import { Fireworks } from './Fireworks.js';
import { QualityManager } from './QualityManager.js';
import { createEnvironment } from './Environment.js';
import { clamp, damp } from '../utils/math.js';

export class Experience {
  constructor(canvas, site, quality) {
    this.canvas = canvas;
    this.site = site;
    this.quality = quality;
    this.tiers = site.quality;
    this.isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    this.running = false;
    this.progress = 0;
    this.targetProgress = 0;
    this.elapsed = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio, this.isMobile ? 1.5 : 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x050608, 0.0175);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
    this.camera.position.set(0, 1.2, 9.5);

    this.clock = new THREE.Clock();
    this.pointerTarget = new THREE.Vector2();
    this.smoothPointer = new THREE.Vector2();
    this.tempPosition = new THREE.Vector3();
    this.tempLook = new THREE.Vector3();

    this.cameraCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 1.15, 9.5),
        new THREE.Vector3(0, 1.05, 7.2),
        new THREE.Vector3(0, 1.65, 4.2),
        new THREE.Vector3(0, 2.0, 0.5),
        new THREE.Vector3(0, 2.6, -3.2),
        new THREE.Vector3(0, 2.5, -6.0),
        new THREE.Vector3(0, 4.0, -9.0),
        new THREE.Vector3(0, 5.5, -12.0),
        new THREE.Vector3(0, 7.5, -15.0),
        new THREE.Vector3(0, 10.5, -18.5),
        new THREE.Vector3(0, 14.0, -22.0),
      ],
      false,
      'catmullrom',
      0.5,
    );

    this.lookCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 0.62, 0),
        new THREE.Vector3(0, 0.8, 0),
        new THREE.Vector3(0, 1.6, 2.0),
        new THREE.Vector3(0, 1.9, 0),
        new THREE.Vector3(0, 1.4, -12.0),
        new THREE.Vector3(0, 1.4, -12.0),
        new THREE.Vector3(0, 2.5, -10.0),
        new THREE.Vector3(0, 2.8, -9.0),
        new THREE.Vector3(0, 3.2, -8.0),
        new THREE.Vector3(0, 4.5, -8.0),
        new THREE.Vector3(0, 5.5, -8.0),
      ],
      false,
      'catmullrom',
      0.5,
    );

    this.qualityManager = new QualityManager(this.tiers, quality, (next) => this.applyQuality(next));
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onResize = this.handleResize.bind(this);
    this.onVisibility = this.handleVisibility.bind(this);
    this.tick = this.tick.bind(this);
    this.resizeRaf = 0;
  }

  init() {
    try {
      this.environmentMap = createEnvironment(this.renderer, this.scene);
    } catch (error) {
      console.warn('[D74] Image-based lighting unavailable; using direct lights.', error);
    }
    this.stadium = new Stadium(this.quality);
    this.pitch = new Pitch(this.renderer, this.quality);
    this.ball = new Ball(this.renderer, this.quality);
    this.dust = new Dust(this.quality);
    this.confetti = new Confetti(this.quality);
    this.fireworks = new Fireworks();

    this.scene.add(this.stadium.group);
    this.scene.add(this.pitch.group);
    this.scene.add(this.ball.group);
    this.scene.add(this.ball.trail);
    this.scene.add(this.dust.points);
    this.scene.add(this.confetti.mesh);
    this.scene.add(this.fireworks.points);

    this.buildPost();
    this.resize();

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('orientationchange', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);

    this.renderer.compile(this.scene, this.camera);
    this.initialized = true;
    return this;
  }

  buildPost() {
    if (!this.quality.postFX) return;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.getBloom(this.quality.bloom),
      0.78,
      this.getBloomThreshold(),
    );
    this.composer.addPass(this.bloomPass);

    this.vignettePass = new ShaderPass(VignetteChromaShader);
    this.vignettePass.uniforms.uAmount.value = 0.0016;
    this.composer.addPass(this.vignettePass);
    this.composer.addPass(new OutputPass());
  }

  getBloom(value) {
    return this.isMobile ? Math.min(value, 0.28) : value;
  }

  getBloomThreshold() {
    return this.isMobile ? 0.92 : 0.82;
  }

  setProgress(value) {
    this.targetProgress = clamp(value, 0, 1);
  }

  handlePointerMove(event) {
    const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const y = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
    this.pointerTarget.set(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  handleResize() {
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = requestAnimationFrame(() => this.resize());
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.fov = 50 + (aspect < 1 ? (1 - aspect) * 18 : 0);
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio?.(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) this.bloomPass.setSize(width, height);
  }

  applyQuality(next) {
    this.quality = next;
    this.renderer.shadowMap.enabled = next.shadows;
    this.ball.mesh.castShadow = next.shadows;
    this.ball.mesh.receiveShadow = true;
    if (this.stadium) this.stadium.key.castShadow = next.shadows;
    this.dust.setDensity(next.particles);
    this.confetti.setCount(next.confetti);
    this.dust.material.size = next.dustSize;
    if (this.bloomPass) {
      this.bloomPass.strength = this.getBloom(next.bloom);
      this.bloomPass.threshold = this.getBloomThreshold();
    }
    this.resize();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  handleVisibility() {
    if (document.hidden) this.stop();
    else if (this.initialized) this.start();
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    this.update(dt);
    if (this.quality.postFX && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.progress = damp(this.progress, this.targetProgress, 4.2, dt);
    this.smoothPointer.x = damp(this.smoothPointer.x, this.pointerTarget.x, 4.5, dt);
    this.smoothPointer.y = damp(this.smoothPointer.y, this.pointerTarget.y, 4.5, dt);

    const p = this.progress;
    this.cameraCurve.getPoint(p, this.tempPosition);
    this.lookCurve.getPoint(p, this.tempLook);

    const aspect = this.camera.aspect;
    if (aspect < 1) {
      this.tempPosition.z += (1 - aspect) * 3.6;
      this.tempPosition.y += (1 - aspect) * 0.9;
    }

    this.camera.position.copy(this.tempPosition);
    this.camera.lookAt(this.tempLook);

    // A little handheld roll and a goal-side impact shake. Both decay
    // with scroll so the shot still lands on the exact section framing.
    if (aspect >= 0.8) this.camera.rotateZ(this.smoothPointer.x * 0.012);
    if (p > 0.47 && p < 0.57) {
      const impact = Math.sin((p - 0.47) * Math.PI * 8) * (1 - Math.abs(p - 0.51) / 0.06);
      this.camera.position.x += impact * 0.035;
      this.camera.position.y += Math.cos(this.elapsed * 58) * Math.abs(impact) * 0.02;
    }

    this.ball.update(p, this.elapsed, dt, this.smoothPointer);
    this.pitch.update(p, this.elapsed, this.ball.group.position);
    this.stadium.update(this.elapsed, p);
    this.dust.update(dt, this.elapsed);
    this.confetti.update(dt, p > 0.86, this.elapsed);
    this.fireworks.update(dt, p > 0.875);
    this.qualityManager.update(dt);
  }

  dispose() {
    this.stop();
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);

    this.ball?.dispose();
    this.pitch?.dispose();
    this.stadium?.dispose();
    this.dust?.dispose();
    this.confetti?.dispose();
    this.fireworks?.dispose();

    this.environmentMap?.dispose();
    this.scene.environment = null;
    this.composer?.dispose?.();
    this.renderer.forceContextLoss?.();
    this.renderer.dispose();
    this.scene.clear();
  }
}
