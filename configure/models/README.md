# Shipped live vehicle model

`openx-volvo-ex30-2024.glb` is the licensed primary geometry for the live
Angle, Profile, and Wheel showroom views. It is a low-poly 2024 Volvo EX30
reference model and **is not R2 geometry**. The configurator applies
representative R2 paint and wheel treatments to this reference body. A separate
set of safety frames captured from this exact GLB provides loading and runtime
fallback without changing vehicle identity.

## Provenance

- Source: [OpenX Assets](https://github.com/vevalabs/openx-assets/tree/main/src/vehicles/main/m1_volvo_ex30_2024), asset version `2025.8.21`
- Original model: © 2023 Mehdi Lagzouli / [LagzDesign](https://sketchfab.com/LagzDesign), licensed under CC BY 4.0
- OpenX adaptation: © 2025 Dogan Ulus
- Combined asset license metadata: `MPL-2.0 AND CC-BY-4.0`
- Shipped file: `public/models/openx-volvo-ex30-2024.glb`
- Size: `4,597,256` bytes
- SHA-256: `6c9a190919432a379671c4a72fce7b9d575560b74de612b2d220f09328e9db4d`
- Release UUID: `9241b9d4-69b4-4510-945e-fb056afc5e42`

The runtime does not change the distributed GLB binary. It clones materials in
memory to apply selected paint, glazing, rim, and light presentation. The
license-plate node is omitted from the runtime clone, and configuration-only
hitch/focus geometry is added separately in code. See
`openx-volvo-ex30-2024.NOTICE.md` and `docs/asset-license.md` for the complete
deployment notice and mapping record.
