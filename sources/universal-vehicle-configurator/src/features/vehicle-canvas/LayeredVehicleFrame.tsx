import type { CSSProperties } from "react";

/**
 * Composites a paint colour into a pre-rendered frame at runtime.
 *
 * This is the technique Tesla and Porsche use for their configurator imagery:
 * render the body once in near-white, keep a mask of the paintable region, and
 * multiply the chosen colour through that mask. One render then serves every
 * colour, which collapses a paints x wheels x angles matrix down to
 * wheels x angles and recolours with no GPU work and no extra download.
 *
 * Here it covers the window before the 4.6 MB GLB has loaded, and the
 * unsupported-WebGL path. That frame used to be a fixed Esker Silver still, so
 * opening a shared link to a green build showed the wrong colour until the live
 * renderer took over.
 *
 * The mask carries its coverage in the alpha channel, so this is plain CSS
 * masking plus a multiply blend: no canvas, no per-pixel work, and the base
 * stays a real <img> so load and error still surface normally.
 *
 * Frames are built by scripts/build-layered-frames.mjs.
 */

export interface LayeredVehicleFrameProps {
  baseSrc: string;
  maskSrc: string;
  paintColor: string;
  alt: string;
  className?: string;
  onReady?: () => void;
  onError?: () => void;
}

export function LayeredVehicleFrame({
  baseSrc,
  maskSrc,
  paintColor,
  alt,
  className,
  onReady,
  onError,
}: LayeredVehicleFrameProps) {
  const paintStyle: CSSProperties = {
    backgroundColor: paintColor,
    // Both spellings: Safari still wants the prefixed property.
    WebkitMaskImage: `url(${maskSrc})`,
    maskImage: `url(${maskSrc})`,
  };

  return (
    <div className={className} data-layered-frame="">
      <img
        className="layered-frame__base"
        src={baseSrc}
        alt={alt}
        onLoad={onReady}
        onError={onError}
      />
      <span className="layered-frame__paint" style={paintStyle} aria-hidden="true" />
    </div>
  );
}

export default LayeredVehicleFrame;
