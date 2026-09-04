# AutoLab by AutoMoto

Agent-native, web 4.0 tools for car lovers. This repository is the site that
houses the three AutoLab experiences for
[The WebMCP Challenge](https://webmcp.devpost.com/):

| Path | Experience | Source | WebMCP tools |
| --- | --- | --- | --- |
| `/` | Landing page | `index.html`, `assets/` | 3 |
| `/configure/` | Web 4.0-enabled Vehicle Configurator (with the embedded **Garage** digital twin) | [`sources/universal-vehicle-configurator`](sources/universal-vehicle-configurator) | 17 (+14 inside Garage) |
| `/garage/` | Agentic Owner's Guide | [`sources/r2-blueprint`](sources/r2-blueprint) | 13 |
| `/engine/` | AutoLab 3D Creation Engine | [`sources/autolab-3d-creation-engine`](sources/autolab-3d-creation-engine) | 2 |

Live: **https://goodcarp.github.io/autolab/**

Every page publishes its tools on `document.modelContext` (falling back to
`navigator.modelContext`) with `registerTool`, and mirrors the same functions on a
`window.*` object so any browser, devtools session or Playwright script can drive
the page the way an agent would.

## Running it with an agent

- **ChatGPT desktop**: open any AutoLab URL in the app's built-in browser and ask it
  to read the current build.
- **Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, restart, load the page.

The header chip on each page reports how many tools registered. **Manual mode**
means the API was not found; the experiences remain fully usable by hand.

## How this site is assembled

The landing page (`index.html`, `assets/`) and the engine page (`engine/index.html`,
`engine/engine.js`) are authored here. `configure/`, `garage/` and the engine's
generated outputs are produced from `sources/` by one script:

```sh
./build.sh        # needs Node >= 22.12 (corepack for pnpm) and rsync
```

It builds the configurator (`pnpm install && pnpm build`), copies the owner's
guide's static files, runs the engine to cut the section drawings and profile
overlay straight off the model, and writes `ASSEMBLED.txt` with the commit of
each source and the engine's self-test result. The built output is committed so
GitHub Pages serves it without a build step. Serve the folder with any static server:

```sh
python3 -m http.server 8790
```

The configurator is built with a relative base, the owner's guide uses relative
module paths, and `.nojekyll` keeps GitHub Pages from dropping underscore-prefixed
files, so the whole tree works from any sub-path.

## License

Apache License 2.0 for everything authored here and in `sources/`; see
[LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party components (three.js under
MIT; the licensed EX30 reference GLB under MPL-2.0 AND CC-BY-4.0; the fonts under
OFL 1.1) keep their own licenses, listed in NOTICE. See
[sources/README.md](sources/README.md) for what was deliberately left out of the
public copies and why.

## Independence

AutoLab and AutoMoto are independent and unofficial. This project is not
associated with, endorsed by, or sponsored by Rivian or any manufacturer. The
vehicle geometry is an independent reconstruction fitted to published dimensions
and photographs, not manufacturer CAD. Vehicle names and specifications are used
nominatively to identify the products being discussed.
