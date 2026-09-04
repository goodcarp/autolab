import { BufferGeometry, Float32BufferAttribute } from "three";

export type LoftStation = Readonly<{
  x: number;
  bottom: number;
  shoulder: number;
  top: number;
  halfWidth: number;
}>;

const ringForStation = ({ x, bottom, shoulder, top, halfWidth }: LoftStation) => [
  [x, bottom, -halfWidth * 0.72],
  [x, bottom + 0.07, -halfWidth * 0.97],
  [x, shoulder - 0.18, -halfWidth * 1.015],
  [x, shoulder, -halfWidth * 0.94],
  [x, top - 0.015, -halfWidth * 0.72],
  [x, top + 0.045, 0],
  [x, top - 0.015, halfWidth * 0.72],
  [x, shoulder, halfWidth * 0.94],
  [x, shoulder - 0.18, halfWidth * 1.015],
  [x, bottom + 0.07, halfWidth * 0.97],
] as const;

/**
 * Builds one continuous, smooth longitudinal surface from authored cross
 * sections. The stable station contract also maps cleanly to a future GLB
 * replacement whose body is authored in a DCC tool.
 */
export function createLoftGeometry(stations: readonly LoftStation[]) {
  if (stations.length < 2) throw new Error("A vehicle loft requires at least two stations");

  const rings = stations.map(ringForStation);
  const ringSize = rings[0].length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (const point of ring) positions.push(...point);
  }

  for (let stationIndex = 0; stationIndex < rings.length - 1; stationIndex += 1) {
    const nextStationIndex = stationIndex + 1;
    for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) {
      const nextRingIndex = (ringIndex + 1) % ringSize;
      const a = stationIndex * ringSize + ringIndex;
      const b = nextStationIndex * ringSize + ringIndex;
      const c = nextStationIndex * ringSize + nextRingIndex;
      const d = stationIndex * ringSize + nextRingIndex;
      indices.push(a, c, b, a, d, c);
    }
  }

  const addCap = (ring: (typeof rings)[number], frontFacing: boolean) => {
    const capStart = positions.length / 3;
    for (const point of ring) positions.push(...point);
    const centerIndex = positions.length / 3;
    const centerY = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    positions.push(ring[0][0], centerY, 0);

    for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) {
      const nextRingIndex = (ringIndex + 1) % ringSize;
      if (frontFacing) {
        indices.push(centerIndex, capStart + ringIndex, capStart + nextRingIndex);
      } else {
        indices.push(centerIndex, capStart + nextRingIndex, capStart + ringIndex);
      }
    }
  };

  addCap(rings[0], false);
  addCap(rings[rings.length - 1], true);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
