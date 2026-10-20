// Run mode: what the tray's PLAY starts for a car that has one (the Roadster). start(), stop()
// and active() are the whole interface the sheet uses; the drive itself lands in the next
// build, so for now start() only says so on the status line and the button turns to STOP.
export const RUN_MODE_PENDING = 'Run mode: coming in the next build';

export function createRunMode({ onChange = () => {}, say = () => {} } = {}) {
  let on = false;
  return {
    start() {
      if (on) return false;
      on = true; say(RUN_MODE_PENDING); onChange(true);
      return true;
    },
    stop() {
      if (!on) return false;
      on = false; say(''); onChange(false);
      return true;
    },
    active: () => on,
  };
}
