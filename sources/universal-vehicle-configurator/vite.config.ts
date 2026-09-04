/// <reference types="vitest/config" />

import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath, type Plugin } from "vite";
import {
  getCanonicalR2ModelPaths,
  syncCanonicalR2Model,
} from "./scripts/sync-r2-model.mjs";

function canonicalR2ModelPlugin(): Plugin {
  let projectRoot = "";
  let synchronizeOnBuildStart = true;

  return {
    name: "autolab-canonical-r2-model",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      // The test command synchronizes before Vitest starts. Skipping this hook
      // in test mode lets the parity test detect direct edits to a mirror.
      synchronizeOnBuildStart = config.mode !== "test";
    },
    async buildStart() {
      if (synchronizeOnBuildStart) await syncCanonicalR2Model(projectRoot);
    },
    configureServer(server) {
      const canonicalSources = new Set(
        getCanonicalR2ModelPaths(server.config.root).map(({ source }) =>
          normalizePath(source),
        ),
      );
      let pendingSync = Promise.resolve();

      const mirrorCanonicalChange = (changedPath: string) => {
        if (!canonicalSources.has(normalizePath(changedPath))) return;

        pendingSync = pendingSync
          .then(async () => {
            const result = await syncCanonicalR2Model(server.config.root);
            if (result.updated.length === 0) return;
            server.config.logger.info(
              `[AutoLab] Mirrored Garage R2 ${result.updated.join(", ")} into Configure.`,
            );
            server.ws.send({ type: "full-reload" });
          })
          .catch((error: unknown) => {
            server.config.logger.error(
              `[AutoLab] R2 model mirror failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      };

      server.watcher.add([...canonicalSources]);
      server.watcher.on("change", mirrorCanonicalChange);
    },
  };
}

export default defineConfig({
  plugins: [canonicalR2ModelPlugin(), react()],
  base: "./",
  build: {
    sourcemap: true,
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
