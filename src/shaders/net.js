import * as THREE from 'three';

export function createNetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHit: { value: 0 },
      uHitPoint: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color(0xdfe8e2) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uHit;
      uniform vec2 uHitPoint;
      varying vec2 vUv;
      varying float vRipple;
      void main() {
        vUv = uv;
        float d = distance(position.xy, uHitPoint);
        float wave = sin(d * 9.0 - uTime * 9.0) * exp(-d * 1.7) * uHit;
        vec3 transformed = position;
        transformed.z += wave * 0.16;
        transformed.y += wave * 0.045;
        vRipple = abs(wave);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vRipple;
      void main() {
        vec2 cell = abs(fract(vUv * vec2(38.0, 14.0)) - 0.5);
        float line = smoothstep(0.455, 0.5, max(cell.x, cell.y));
        float edgeFade = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
        float alpha = line * (0.32 + vRipple * 1.6) * edgeFade;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
