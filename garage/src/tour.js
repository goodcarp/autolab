// Tool-call sequencer. No DOM, scene graph, or browser clock is required.
// schedule(callback, milliseconds) may return a cancellation function; tokens remain
// authoritative even when a scheduler cannot cancel, or a tool promise is in flight.
export function createTour({ steps, call, onStep = () => {}, onStop = () => {},
  now = () => Date.now(), schedule = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } }) {
  let token = 0, running = false, index = -1, cancel;
  const state = () => ({ running, step: index + 1, of: steps.length,
    id: steps[index]?.id ?? null, title: steps[index]?.title ?? null });
  const live = (run) => running && token === run;
  function stop(reason = 'stopped') {
    ++token;
    cancel?.(); cancel = undefined;
    if (!running) return state();
    running = false;
    onStop(state(), reason);
    return state();
  }
  async function enter(i, run) {
    if (!live(run)) return state();
    index = i;
    const step = steps[i], began = now();
    try {
      onStep(step, state());
      for (const action of step.actions) {
        if (!live(run)) return state();
        await call(action.name, action.args);
      }
      if (!live(run)) return state();
      // Infinity is the capture hold: actions complete, but no timer is installed.
      if (step.dwell !== Infinity) cancel = schedule(() => {
        if (!live(run)) return;
        cancel = undefined;
        if (i + 1 === steps.length) stop('complete');
        else void enter(i + 1, run).catch(() => {}); // onStop already reports the failure
      }, Math.max(0, step.dwell - (now() - began)));
    } catch (error) {
      if (live(run)) stop('error');
      throw error;
    }
    return state();
  }
  function start(fromIndex = 0) {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= steps.length)
      throw new RangeError(`tour index must be 0–${steps.length - 1}`);
    stop('restart');
    running = true;
    return enter(fromIndex, ++token);
  }
  return { start, stop, state };
}
