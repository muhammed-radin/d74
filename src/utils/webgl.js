export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(gl && window.WebGLRenderingContext);
  } catch (_) {
    return false;
  }
}
