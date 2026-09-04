/**
 * Frame sources for the layered compositor, relative to the app base. The
 * caller resolves them, so this stays free of bundler globals.
 *
 * Built by scripts/build-layered-frames.mjs.
 */
export type LayeredView = "angle" | "profile";

export const LAYERED_SOURCES: Record<LayeredView, { base: string; mask: string }> = {
  angle: {
    base: "images/layered/angle-base.webp",
    mask: "images/layered/angle-paintmask.webp",
  },
  profile: {
    base: "images/layered/profile-base.webp",
    mask: "images/layered/profile-paintmask.webp",
  },
};
