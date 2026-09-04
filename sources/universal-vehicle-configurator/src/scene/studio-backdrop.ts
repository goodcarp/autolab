import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from "three";

/**
 * The backdrop the car stands in.
 *
 * A car is mostly a mirror, so the single largest contributor to whether it
 * reads as a photograph is what surrounds it. Three small area lights leave
 * every dark surface reflecting black, which is why untuned three.js car
 * renders look like matte plastic: the glass and the paint have nothing to
 * pick up between the highlights.
 *
 * This is the cyclorama a real studio would shoot in — a bright ceiling falling
 * through a warm horizon to a dark floor. It costs one 4x64 texture and it is
 * what the tinted glass, the rims and the shoulder line actually reflect.
 */

type Stop = readonly [t: number, r: number, g: number, b: number];

const CYCLORAMA: readonly Stop[] = [
  [0.00, 0.055, 0.058, 0.062], // under the car: near black, so the sills stay dark
  [0.34, 0.10, 0.105, 0.112],
  [0.46, 0.28, 0.29, 0.30],
  [0.52, 0.62, 0.62, 0.615], // horizon: the bright band that runs down the flanks
  [0.58, 0.40, 0.415, 0.44],
  [0.78, 0.60, 0.635, 0.68],
  [1.00, 1.00, 0.985, 0.94], // ceiling: warm white
];

function sample(t: number): [number, number, number] {
  let i = 0;
  while (i < CYCLORAMA.length - 2 && CYCLORAMA[i + 1][0] < t) i += 1;
  const a = CYCLORAMA[i];
  const b = CYCLORAMA[i + 1];
  const span = b[0] - a[0] || 1;
  const k = Math.min(1, Math.max(0, (t - a[0]) / span));
  // Smoothstep between stops: a linear ramp puts a visible band in the
  // reflection exactly where the gradient changes slope.
  const s = k * k * (3 - 2 * k);
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
}

/** Vertical gradient, bottom row first, ready to map onto a backside sphere. */
export function createCycloramaTexture(height = 128): DataTexture {
  const width = 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = sample(y / (height - 1));
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = Math.round(r * 255);
      data[o + 1] = Math.round(g * 255);
      data[o + 2] = Math.round(b * 255);
      data[o + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
