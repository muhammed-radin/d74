export const VignetteChromaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.0018 },
    uVignette: { value: 0.34 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uVignette;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = dot(dir, dir);
      vec2 offset = dir * dist * uAmount * 8.0;

      vec4 color;
      color.r = texture2D(tDiffuse, vUv + offset).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - offset).b;
      color.a = 1.0;

      float vignette = smoothstep(0.78, 0.16, length(dir));
      color.rgb *= mix(1.0 - uVignette, 1.0, vignette);

      gl_FragColor = color;
    }
  `,
};
