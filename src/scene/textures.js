import * as THREE from 'three';

const TAU = Math.PI * 2;

/* Classic truncated-icosahedron pattern, drawn into an equirectangular
   texture. Swap `createBallTexture()` for your own PBR maps in Ball.js. */
function getIcosahedronTopology() {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.attributes.position;
  const vertices = [];
  const lookup = new Map();
  const faces = [];
  const keyOf = (v) => `${v.x.toFixed(5)}|${v.y.toFixed(5)}|${v.z.toFixed(5)}`;

  for (let i = 0; i < position.count; i += 3) {
    const face = [];
    for (let j = 0; j < 3; j += 1) {
      const vertex = new THREE.Vector3().fromBufferAttribute(position, i + j);
      const key = keyOf(vertex);
      let index = lookup.get(key);
      if (index === undefined) {
        index = vertices.length;
        lookup.set(key, index);
        vertices.push(vertex);
      }
      face.push(index);
    }
    faces.push(face);
  }

  geometry.dispose();
  return { vertices, faces };
}

function buildBallPanels() {
  const { vertices, faces } = getIcosahedronTopology();
  const edgeMap = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edgeMap.has(key)) edgeMap.set(key, [a, b]);
  };

  faces.forEach(([a, b, c]) => {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  });

  const adjacency = vertices.map(() => []);
  edgeMap.forEach(([a, b]) => {
    adjacency[a].push(b);
    adjacency[b].push(a);
  });

  const pentagons = [];
  const up = new THREE.Vector3(0, 1, 0);
  const alt = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    const normal = vertex.clone().normalize();
    const tangent = new THREE.Vector3()
      .crossVectors(Math.abs(normal.y) > 0.9 ? alt : up, normal)
      .normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const neighbors = adjacency[i].slice().sort((a, b) => {
      const da = vertices[a].clone().sub(vertex).projectOnPlane(normal).normalize();
      const db = vertices[b].clone().sub(vertex).projectOnPlane(normal).normalize();
      const aa = Math.atan2(da.dot(bitangent), da.dot(tangent));
      const ab = Math.atan2(db.dot(bitangent), db.dot(tangent));
      return aa - ab;
    });

    pentagons.push(
      neighbors.map((neighbor) => vertex.clone().lerp(vertices[neighbor], 1 / 3).normalize()),
    );
  }

  const hexagons = faces.map(([a, b, c]) => {
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    return [
      va.clone().lerp(vb, 1 / 3).normalize(),
      va.clone().lerp(vb, 2 / 3).normalize(),
      vb.clone().lerp(vc, 1 / 3).normalize(),
      vb.clone().lerp(vc, 2 / 3).normalize(),
      vc.clone().lerp(va, 1 / 3).normalize(),
      vc.clone().lerp(va, 2 / 3).normalize(),
    ];
  });

  return { pentagons, hexagons };
}

function projectPanelPoint(vertex, width, height) {
  return {
    x: (0.5 + Math.atan2(vertex.z, vertex.x) / TAU) * width,
    y: (0.5 - Math.asin(THREE.MathUtils.clamp(vertex.y, -1, 1)) / Math.PI) * height,
  };
}

function drawPanels(ctx, width, height, panels, style) {
  const draw = (points, fill, stroke, lineWidth) => {
    const projected = points.map((point) => projectPanelPoint(point, width, height));

    for (const offset of [-width, 0, width]) {
      ctx.beginPath();
      projected.forEach((point, index) => {
        const x = point.x + offset;
        const y = point.y;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }
  };

  panels.hexagons.forEach((points, index) => {
    const variation = (index % 5) * 0.012;
    draw(
      points,
      style.hexFill(variation),
      style.hexStroke,
      Math.max(1.4, width / 1024) * 2.1,
    );
  });

  panels.pentagons.forEach((points) => {
    draw(
      points,
      style.pentagonFill,
      style.pentagonStroke,
      Math.max(1.6, width / 1024) * 2.5,
    );
  });
}

function createNormalMap(heightCanvas, strength = 2.5) {
  const width = heightCanvas.width;
  const height = heightCanvas.height;
  const source = heightCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const targetCtx = target.getContext('2d');
  const output = targetCtx.createImageData(width, height);
  const at = (x, y) => {
    const wrappedX = (x + width) % width;
    const wrappedY = (y + height) % height;
    return source[(wrappedY * width + wrappedX) * 4] / 255;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      const index = (y * width + x) * 4;
      output.data[index] = ((nx / length) * 0.5 + 0.5) * 255;
      output.data[index + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      output.data[index + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      output.data[index + 3] = 255;
    }
  }

  targetCtx.putImageData(output, 0, 0);
  return target;
}

/* Builds a truncated-icosahedron panel layout and returns colour, normal
   and roughness maps. The panels are real spherical polygons, so the seams
   and black pentagons follow the ball instead of a flat painted grid. */
export function createBallTextures(renderer, quality) {
  const panels = buildBallPanels();
  const low = quality?.label === 'low';
  const width = low ? 1024 : 2048;
  const height = low ? 512 : 1024;
  const anisotropy = Math.min(low ? 8 : 16, renderer.capabilities.getMaxAnisotropy());

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorCtx = colorCanvas.getContext('2d');

  colorCtx.fillStyle = '#e8e3d6';
  colorCtx.fillRect(0, 0, width, height);

  const wash = colorCtx.createRadialGradient(760, 330, 60, 1024, 540, 1200);
  wash.addColorStop(0, 'rgba(255,255,255,0.16)');
  wash.addColorStop(0.52, 'rgba(255,255,255,0)');
  wash.addColorStop(1, 'rgba(32,30,24,0.22)');
  colorCtx.fillStyle = wash;
  colorCtx.fillRect(0, 0, width, height);

  drawPanels(colorCtx, width, height, panels, {
    hexFill: (variation) => `rgba(243, 239, 228, ${0.76 + variation})`,
    hexStroke: 'rgba(55, 55, 45, 0.32)',
    pentagonFill: '#0b0d0a',
    pentagonStroke: 'rgba(0, 0, 0, 0.7)',
  });

  // Fine leather grain and a few scuffs break up the flat vector look.
  for (let i = 0; i < (low ? 18000 : 42000); i += 1) {
    const alpha = Math.random() * 0.05;
    colorCtx.fillStyle = Math.random() > 0.45
      ? `rgba(35, 33, 27, ${alpha})`
      : `rgba(255, 255, 255, ${alpha * 0.7})`;
    colorCtx.fillRect(Math.random() * width, Math.random() * height, 1.2, 1.2);
  }

  for (let i = 0; i < 70; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = 8 + Math.random() * 44;
    const scuff = colorCtx.createRadialGradient(x, y, 0, x, y, radius);
    scuff.addColorStop(0, `rgba(35, 32, 25, ${0.018 + Math.random() * 0.03})`);
    scuff.addColorStop(1, 'rgba(35, 32, 25, 0)');
    colorCtx.fillStyle = scuff;
    colorCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = low ? 512 : 1024;
  heightCanvas.height = low ? 256 : 512;
  const heightCtx = heightCanvas.getContext('2d');
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, heightCanvas.width, heightCanvas.height);
  drawPanels(heightCtx, heightCanvas.width, heightCanvas.height, panels, {
    hexFill: () => '#a4a4a4',
    hexStroke: '#4a4a4a',
    pentagonFill: '#3c3c3c',
    pentagonStroke: '#202020',
  });

  for (let i = 0; i < (low ? 8000 : 18000); i += 1) {
    const value = 105 + Math.floor(Math.random() * 70);
    heightCtx.fillStyle = `rgba(${value}, ${value}, ${value}, 0.2)`;
    heightCtx.fillRect(
      Math.random() * heightCanvas.width,
      Math.random() * heightCanvas.height,
      1.2,
      1.2,
    );
  }

  const normalCanvas = createNormalMap(heightCanvas, 2.35);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = low ? 256 : 512;
  roughCanvas.height = low ? 128 : 256;
  const roughCtx = roughCanvas.getContext('2d');
  roughCtx.fillStyle = '#b8b8b8';
  roughCtx.fillRect(0, 0, roughCanvas.width, roughCanvas.height);
  drawPanels(roughCtx, roughCanvas.width, roughCanvas.height, panels, {
    hexFill: () => '#c6c6c6',
    hexStroke: '#8a8a8a',
    pentagonFill: '#363636',
    pentagonStroke: '#202020',
  });

  for (let i = 0; i < (low ? 2200 : 5000); i += 1) {
    const value = 140 + Math.floor(Math.random() * 90);
    roughCtx.fillStyle = `rgba(${value}, ${value}, ${value}, 0.25)`;
    roughCtx.fillRect(
      Math.random() * roughCanvas.width,
      Math.random() * roughCanvas.height,
      1,
      1,
    );
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.anisotropy = anisotropy;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.anisotropy = anisotropy;
  roughnessMap.needsUpdate = true;

  return { map, normalMap, roughnessMap };
}

export function createBallTexture(renderer, quality) {
  return createBallTextures(renderer, quality).map;
}

/* Dark, striped pitch with full markings. Replace with a photographed
   turf map if you want a more literal broadcast look. */
export function createPitchTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a1a10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bands = 18;
  for (let i = 0; i < bands; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, (canvas.height / bands) * i, canvas.width, canvas.height / bands);
  }

  for (let i = 0; i < 26000; i += 1) {
    const alpha = Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5
      ? `rgba(180,255,200,${alpha})`
      : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.2, 1.2);
  }

  const margin = 94;
  const left = margin;
  const right = canvas.width - margin;
  const top = margin;
  const bottom = canvas.height - margin;
  const midY = canvas.height / 2;

  ctx.strokeStyle = 'rgba(242, 246, 240, 0.82)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  ctx.strokeRect(left, top, right - left, bottom - top);

  ctx.beginPath();
  ctx.moveTo(left, midY);
  ctx.lineTo(right, midY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(canvas.width / 2, midY, 128, 0, TAU);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(canvas.width / 2, midY, 6, 0, TAU);
  ctx.fillStyle = 'rgba(242,246,240,0.82)';
  ctx.fill();

  const boxWidth = 610;
  const boxHeight = 214;
  const sixWidth = 258;
  const sixHeight = 92;

  ctx.strokeRect((canvas.width - boxWidth) / 2, top, boxWidth, boxHeight);
  ctx.strokeRect((canvas.width - sixWidth) / 2, top, sixWidth, sixHeight);
  ctx.strokeRect((canvas.width - boxWidth) / 2, bottom - boxHeight, boxWidth, boxHeight);
  ctx.strokeRect((canvas.width - sixWidth) / 2, bottom - sixHeight, sixWidth, sixHeight);

  ctx.beginPath();
  ctx.arc(canvas.width / 2, top + 158, 5, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, bottom - 158, 5, 0, TAU);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(canvas.width / 2, top + 158, 92, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, bottom - 158, 92, 1.18 * Math.PI, 1.82 * Math.PI);
  ctx.stroke();

  const corner = 32;
  ctx.beginPath();
  ctx.arc(left, top, corner, 0, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(right, top, corner, Math.PI / 2, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(left, bottom, corner, -Math.PI / 2, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(right, bottom, corner, Math.PI, Math.PI * 1.5);
  ctx.stroke();

  // Goal line glow, kept very subtle so it reads as light, not paint.
  const glow = ctx.createLinearGradient(0, top - 20, 0, top + 22);
  glow.addColorStop(0, 'rgba(215,255,63,0)');
  glow.addColorStop(0.5, 'rgba(215,255,63,0.08)');
  glow.addColorStop(1, 'rgba(215,255,63,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(left, top - 22, right - left, 44);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

export function createParticleSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* Fine grass grain used as a bump map on the pitch. Keep it tileable. */
export function createGrassBumpTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 18000; i += 1) {
    const value = 92 + Math.floor(Math.random() * 72);
    ctx.fillStyle = `rgba(${value}, ${value}, ${value}, ${0.08 + Math.random() * 0.18})`;
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillRect(x, y, 1, 2 + Math.random() * 5);
  }

  for (let i = 0; i < 260; i += 1) {
    const y = Math.random() * 512;
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? 255 : 0}, ${Math.random() > 0.5 ? 255 : 0}, ${Math.random() > 0.5 ? 255 : 0}, 0.025)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 4);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* Soft round contact shadow for the ball. */
export function createShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0,0,0,0.72)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* LED advertising board texture. Swap the copy for your own sponsors. */
export function createAdTexture(label = 'D74', accent = '#d7ff3f') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

  ctx.fillStyle = accent;
  ctx.font = '700 118px "Arial Narrow", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '600 24px monospace';
  ctx.letterSpacing = '8px';
  ctx.fillText('FREE FOOTBALL · NO WATERMARK', canvas.width / 2, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
