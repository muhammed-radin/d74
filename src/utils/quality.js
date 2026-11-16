const isCoarse = () => window.matchMedia('(pointer: coarse)').matches;
const isSmall = () => window.matchMedia('(max-width: 768px)').matches;

export function detectQuality(tiers) {
  const mobile = isCoarse() || isSmall();
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(connection && connection.saveData);
  const slowNetwork = Boolean(
    connection && /(^|-)2g$/.test(String(connection.effectiveType || '')),
  );

  if (saveData || slowNetwork || cores <= 2 || memory <= 2) return withMobileCaps(tiers.low, mobile);
  if (mobile) {
    const tier = cores <= 4 || memory <= 4 ? tiers.low : tiers.medium;
    return withMobileCaps(tier, true);
  }
  if (cores <= 4 || memory <= 4) return tiers.medium;
  return tiers.high;
}

function withMobileCaps(tier, mobile) {
  if (!mobile) return tier;
  return {
    ...tier,
    pixelRatio: Math.min(tier.pixelRatio, 1.5),
    bloom: Math.min(tier.bloom, 0.28),
    particles: Math.min(tier.particles, 900),
    confetti: Math.min(tier.confetti, 180),
  };
}
