// All sheet text lives here so it is easy to edit.
//
// STATUS and CHECKED are deliberately honest. A title block reading RELEASED, REV. C and a checker's
// name is drawing-office language for "this has been through change control", which this has not --
// harmless on a personal sheet, misleading the moment the sheet is published. The names, the drawing
// number and the revision are Alexander's to set; nothing here should invent them for him.
export const CONFIG = {
  hdrLeft: { title: "AGENTIC OWNER'S GUIDE", sub: 'Hudian Motors · MY CAR' },
  hdrRight: { title: 'HUDIAN RX2 · MIDSIZE ELECTRIC WAGON', sub: 'Session ID: 16974 Knowledge Base: Online' },
  title: ['MY HUDIAN RX2 · DUAL-MOTOR AWD', 'LAUNCH EDITION'],
  titleBlock: [
    { lbl: 'ID NO.', val: 'RX2-4715-NY' }, { lbl: 'REF', val: '1 OF 1' }, { lbl: 'SCALE', val: '1 : 24' }, { lbl: 'CLASS', val: 'C' },
    { lbl: 'OWNER', val: 'H. YUTANI' }, { lbl: 'CHECKED', val: '—' }, { lbl: 'BORN', val: '01 · 09 · 26' }, { lbl: 'STATUS', val: 'SYNCED', red: true },
  ],
  zonesX: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'],
  zonesY: ['6', '5', '4', '3', '2', '1'],
  // Key items: n = callout number, part = part id name in vehicle.js
  keyItems: [
    { n: 1, label: 'Stadium headlamp, LED', part: 'headlamps' },
    { n: 2, label: 'Full-width light bar', part: 'lightBar' },
    { n: 3, label: 'Front drive unit', part: 'driveUnitF' },
    { n: 4, label: 'Structural battery pack', part: 'battery' },
    { n: 5, label: '20 in wheel, 255/60 R20', part: 'wheelFR' },
    { n: 6, label: 'Five-link rear suspension', part: 'suspension' },
    { n: 7, label: 'Liftgate & drop rear glass', part: 'tailgate' },
    { n: 8, label: 'NACS charge port', part: 'chargePort' },
    { n: 9, label: 'Panoramic glass roof', part: 'roofGlass' },
    { n: 10, label: 'Front trunk (frunk)', part: 'hood' },
  ],
  instr: [
    { k: 'STEERING ANGLE', id: 'steer' },
    { k: 'WHEEL SPEED', id: 'rpm' },
    { k: 'ROAD SPEED', id: 'speed' },
    { k: 'RIDE HEIGHT', id: 'ride' },
    { k: 'STATE OF CHARGE', id: 'soc' },
    { k: 'REFRESH', id: 'fps' },
  ],
  views: [
    { id: 'iso', label: 'ISO' }, { id: 'q34f', label: '3/4 F' }, { id: 'q34r', label: '3/4 R' },
    { id: 'side', label: 'SIDE' }, { id: 'front', label: 'FRONT' }, { id: 'top', label: 'TOP' },
  ],
  motions: [
    { id: 'run', label: 'RUN', toggle: true }, { id: 'drive', label: 'DRIVE', toggle: true }, { id: 'lights', label: 'LIGHTS', toggle: true },
    { id: 'panels', label: 'PANELS', toggle: true }, { id: 'explode', label: 'EXPLODE', toggle: true }, { id: 'open', label: 'OPEN', toggle: true },
  ],
  viewTitles: {
    side: ['SIDE ELEVATION', 'Scale 1:24 · datum condition · wheels straight ahead'],
    front: ['FRONT ELEVATION', 'Scale 1:24 · viewed on arrow F · mirrors deployed'],
    top: ['TOP VIEW', 'Scale 1:24 · viewed from above · mirrors deployed'],
  },
};
