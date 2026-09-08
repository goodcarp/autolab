import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Use the installed Three runtime without requiring WebGL or a second dependency tree.
const threeUrl = new URL('../../universal-vehicle-configurator/node_modules/three/build/three.module.js', import.meta.url).href;
const loadSource = async name => (await readFile(new URL(name, import.meta.url), 'utf8')).replace("from 'three'", `from '${threeUrl}'`);
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const geomUrl = dataUrl(await loadSource('./geom.js'));
const cameraSource = (await loadSource('./camera.js')).replace("from './geom.js'", `from '${geomUrl}'`);
const { Rig, PRESETS, presentationFit } = await import(dataUrl(cameraSource));
const { Vector3 } = await import(threeUrl);
const roundedUrl = new URL('../../universal-vehicle-configurator/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js', import.meta.url).href;
const vehicleSource = (await loadSource('./vehicle.js')).replace("from './geom.js'", `from '${geomUrl}'`).replace("from 'three/addons/geometries/RoundedBoxGeometry.js'", `from '${roundedUrl}'`);
const { buildVehicle } = await import(dataUrl(vehicleSource));

test('every preset fits the vehicle bounds inside unobstructed portrait and landscape stages', () => {
  // Standalone 390×844 and 844×390, plus the host frame after its own header/footer.
  for (const [width, height] of [[358, 632], [288, 356], [808, 236], [600, 216], [360, 280]]) {
    const rig = new Rig(); rig.setViewport(width / height, 4.8);
    for (const view of Object.keys(PRESETS)) {
      rig.goTo(view, 0); rig.apply(width / height);
      for (const x of [-2.411, 2.311]) for (const y of [0, 1.699]) for (const z of [-1.0755, 1.0755]) {
        const p = rig.project(new Vector3(x, y, z), width, height);
        assert.equal(p.behind, false, `${view} ${width}×${height}: vehicle behind camera`);
        assert.ok(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${view} ${width}×${height}: point outside stage ${JSON.stringify(p)}`);
      }
    }
  }
});

test('rotation during a preset transition refits its destination and settled views retain the height floor', () => {
  const rig = new Rig(); rig.setViewport(358 / 632, 4.8); rig.goTo('q34f');
  const portraitDistance = rig.to.dist;
  rig.setViewport(808 / 236, 4.8);
  assert.notEqual(rig.to.dist, portraitDistance);
  assert.ok(rig.to.dist > 7, 'landscape must not push the camera into the vehicle');
  rig.update(2);
  assert.equal(rig.settled, true);
  assert.ok(rig.cur.dist > 7);
});

test('zooming out from a tall phone preset moves away while agent zoom keeps its existing limit', () => {
  const rig = new Rig(); rig.setViewport(288 / 632, 4.8); rig.goTo('iso', 0);
  const original = rig.cur.dist;
  assert.ok(original > 22);
  rig.zoom(1.1, true);
  assert.ok(rig.cur.dist > original);
  rig.zoom(4);
  assert.equal(rig.cur.dist, 22);
});

test('open and exploded presentations keep actual model components inside phone stages', () => {
  const vehicle = buildVehicle();
  for (const [width, height] of [[808, 236], [288, 632]]) for (const [open, explode] of [[1, 0], [0, 1], [1, 1]]) {
    vehicle.openT = open; vehicle.explodeT = explode;
    vehicle.update(0, { run: false, drive: false, time: 0, speed: 0, steer: 0 });
    vehicle.root.updateMatrixWorld(true);
    for (const view of Object.keys(PRESETS)) {
      const rig = new Rig(); rig.setViewport(width / height, 4.8);
      Object.assign(rig, presentationFit(view, explode, open));
      rig.goTo(view, 0); rig.apply(width / height);
      for (const part of vehicle.order) for (const mesh of part.meshes) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const { min, max } = mesh.geometry.boundingBox;
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          const point = new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
          const p = rig.project(point, width, height);
          assert.ok(!p.behind && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${view} ${width}×${height}, open ${open}, explode ${explode}, ${part.name}: ${JSON.stringify(p)}`);
        }
      }
    }
  }
});
