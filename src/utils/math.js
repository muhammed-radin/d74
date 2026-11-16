export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

export const mapRange = (value, inMin, inMax, outMin, outMax) =>
  outMin + ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin || 1)) * (outMax - outMin);

export const formatNumber = (value) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Math.round(value));

export const randomRange = (min, max) => min + Math.random() * (max - min);
