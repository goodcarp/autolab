# Where to make a change

Three surfaces, three repositories' worth of code, and only one of the sync
hops is automatic. This is the map.

## The model

```
~/Desktop/r2-blueprint/src/{geom,vehicle}.js     the origin — authored here
      |   pnpm model:promote        (BY HAND, after a release)
      v
public/garage/src/{geom,vehicle}.js              canonical source for AutoLab
      |   scripts/sync-r2-model.mjs (AUTOMATIC on dev, build and test)
      v
src/scene/r2/{geom,vehicle}.js                   generated mirror, never edited
```

Edit the model in **r2-blueprint**. Nothing else. The mirror carries a
`@generated` header and is overwritten on every build.

The first hop is manual, and it has already bitten once: the Garage sat a
release behind its own model, with a bar across the door opening and an
inverted rear lamp that the origin had already fixed. Run `pnpm model:check`
before a demo, or `pnpm model:promote` after tagging a release upstream.

## Shared by descent, deliberately divergent — never copy these

| File | Why it differs in AutoLab |
| --- | --- |
| `public/garage/src/blueprint.js` | Caps `devicePixelRatio` at 1.35 and tunes the three GPU passes so the drawing survives running in an iframe beside the configurator. |
| `public/garage/src/main.js` | Adds the synced vehicle context and a 30 Hz frame cap. |
| `public/garage/src/config.js` | AutoLab's title block and branding. |
| `public/garage/src/webmcp.js` | The 14 Garage agent tools. Substantially rewritten for AutoLab. |

A model fix and its shader fix often land together upstream, so
`pnpm model:promote` prints which of these have drifted. Move those across by
hand, reading both sides.

## Everything else

| What you want to change | Where |
| --- | --- |
| Configurator UI, layout, copy, canvas chrome | `src/features/vehicle-canvas/`, `src/app/` |
| How the R2 is lit, painted and materialled in the showroom | `src/scene/r2/showroom.ts`, `src/scene/r2/detail.ts` |
| Camera framing per view, per body | `src/scene/camera-presets.ts` |
| Studio lighting and backdrop | `src/scene/LiveVehicleViewport.tsx`, `src/scene/studio-backdrop.ts` |
| Which body draws, and what the page says about it | `src/scene/vehicle-model-source.ts` |
| Host agent tools | `src/webmcp/configurator-tools.ts` |
| Garage agent tools | `public/garage/src/webmcp.js` |
| The bridge between the two surfaces | `src/owner-guide/owner-guide-bridge.ts` |
| Catalog, pricing, incentives, sources | `src/data/catalogs/` |

`src/scene/r2/showroom.ts` assigns a material to every mesh by the drawing's
own part name and sub-id. If a promote renumbers a sub-id, that table is what
breaks, and it fails quietly — a mesh falls through to the default. After any
promote, look at the car.

## Order of work

Model first, in r2-blueprint, because a promote can shift what the material
table is pointing at. Then promote, then look at the render, then do
configurator UI work on top of a model that has stopped moving.
