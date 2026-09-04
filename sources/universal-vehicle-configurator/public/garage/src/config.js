// All sheet text lives here so it is easy to edit.
export const CONFIG = {
  hdrLeft: { title: 'AUTOLAB · GARAGE', sub: 'AutoMoto Agentic Vehicle Laboratory' },
  hdrRight: { title: 'HUDIAN RX2 · DIGITAL TWIN', sub: 'Owner guidance, component inspection & service context' },
  title: ['MY HUDIAN RX2 · CONFIGURATION-SYNCED', 'OWNER & SERVICE GENERAL ARRANGEMENT'],
  titleBlock: [
    { lbl: 'ID NO.', val: 'RX2-4715-NY' }, { lbl: 'SHEET', val: '1 OF 1' }, { lbl: 'SCALE', val: '1 : 24' }, { lbl: 'REV.', val: 'C' },
    { lbl: 'MODEL', val: 'A. CARPENTER' }, { lbl: 'SYSTEM', val: 'AUTOLAB' }, { lbl: 'DATE', val: '03 · 09 · 26' }, { lbl: 'STATUS', val: 'LIVE TWIN', red: true },
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
