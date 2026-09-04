import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "reference", "public/garage"] },
  {
    // Generated from public/garage/src by scripts/sync-r2-model.mjs. Garage is
    // the linted authoring surface; the Configure mirrors must stay byte-stable.
    ignores: ["src/scene/r2/geom.js", "src/scene/r2/vehicle.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The measurement instruments. These are Node scripts that also carry
    // browser code: the bodies of page.evaluate and addInitScript are
    // serialised and run inside the page, so both sets of globals are
    // legitimately in scope here and nowhere else.
    files: ["tools/eyes/**/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        document: "readonly",
        window: "readonly",
        HTMLCanvasElement: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
