// The Home demo exposes a small set of direct interactions after its guided tour.
export function discoveryFraming(touring) {
  return { fitHeight: touring ? 4.8 : 3.6, tyOffset: touring ? 0 : -0.2 };
}

export function discoveryHasTransitions(state, vehicle, flashTime = Infinity) {
  // Simulation time is capped per frame, so it can lag behind the wall-clock hover
  // deadline on slower devices. Sleep only once the visible transitions have settled.
  return state.open !== (state.openOn ? 1 : 0)
    || state.explode !== (state.explodeOn ? 1 : 0)
    || vehicle.panelsT !== (state.panels ? 1 : 0)
    || Math.abs((state.lightsT ?? 0) - (state.lights ? 1 : 0)) > 0.001
    || flashTime < 0.6;
}

export function discoveryAction(partName, subId = 0) {
  if (partName === 'tailgate' && subId === 8) return 'lights';
  if (/^(door(?:FL|FR|RL|RR)|hood|tailgate|chargePort)$/.test(partName || '')) return 'open';
  if (/^(headlamps|lightBar|tailPills)$/.test(partName || '')) return 'lights';
  if (/^wheel(?:FL|FR|RL|RR)$/.test(partName || '')) return 'drive';
  return null;
}

export function resetDiscoveryState(state) {
  Object.assign(state, {
    view: 'iso', run: false, drive: false, lights: false, panels: true,
    explode: 0, open: 0, explodeOn: false, openOn: false,
    speed: 0, steer: 0, hoverId: -1, hoverPart: null, lampGlow: 0, lightsT: 0,
    gridOffset: 0, gridAlpha: 0, shellDissolve: 1, hidePanels: true,
  });
  return state;
}

// Track the complete gesture, including non-primary fingers. Once a gesture becomes
// a pinch or a drag, lifting the final finger must never turn it back into a tap.
export function createTapTracker({ travelLimit = 8, durationLimit = 600 } = {}) {
  const pointers = new Map();
  let candidate = null;
  return {
    down(event, blocked = false) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 1 || event.isPrimary === false || event.button !== 0 || blocked) {
        candidate = null;
        return;
      }
      candidate = { id: event.pointerId, time: event.timeStamp, travel: 0 };
    },
    move(event) {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      if (candidate?.id === event.pointerId) {
        candidate.travel += Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y);
        if (candidate.travel > travelLimit) candidate = null;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    up(event) {
      this.move(event);
      const tapped = candidate?.id === event.pointerId && pointers.size === 1
        && event.timeStamp - candidate.time <= durationLimit;
      pointers.delete(event.pointerId);
      candidate = null;
      return !!tapped;
    },
    cancel(event) { pointers.delete(event.pointerId); candidate = null; },
  };
}

export function demoVisibility(event, { origin, parent, self }) {
  if (parent === self || event.source !== parent || event.origin !== origin
    || event.data?.type !== 'autolab-demo-visibility' || typeof event.data.visible !== 'boolean') return null;
  return event.data.visible;
}

export function visibleInScene(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false;
  return true;
}

// The rendered shell discards door, cabin and hood apertures in its fragment shader.
// Raycasting sees the original mesh, so apply those same authored CUT boundaries to
// hit points before choosing a component. No model geometry is changed here.
export function inVehicleAperture(p, C) {
  const ramp = (knots, coordinate) => knots.slice(0, -1).reduce((value, knot, i) => {
    const next = knots[i + 1], span = next[0] - knot[0];
    return value + (next[1] - knot[1]) / span * Math.max(0, Math.min(span, coordinate - knot[0]));
  }, knots[0][1]);
  const az = Math.abs(p.z);
  if (az > C.doorZ && p.y > C.doorY0 && p.y < C.doorY1) {
    const lower = p.y < C.beltY;
    const rear = lower ? p.x > ramp(C.rearShut, p.y) && p.x < C.rearX1 : p.x > C.rearFrameX0 && p.x < C.rearGlassX1;
    const quarter = !lower && p.y > ramp(C.quarterY0, p.x) && p.x > C.quarterX0 && p.x < C.quarterX1;
    const xg = p.y >= C.sailY ? C.qa + C.qb * p.y + C.qc * p.y * p.y : C.frontGlassX1 - (p.y - C.beltY) * C.sailSlope;
    const front = p.x > (lower ? C.frontX0 : C.frontGlassX0) && p.x < (lower ? C.frontX1 : Math.min(C.frontX1, xg));
    if (rear || quarter || front) return true;
  }
  if (p.x > C.deckX0 && p.x < C.deckX1 && az < C.deckZ && p.y > C.deckY0 && p.y < Math.min(C.deckY1, ramp(C.deckCeil, p.x))) return true;
  return p.x > C.hoodX0 && p.x < C.hoodX1 && p.y > ramp(C.hoodEdge, p.x) && az < C.hoodZ;
}
