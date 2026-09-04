export * from "./configurator.store";
export * from "./mutation.service";
export * from "./selectors";
export * from "./transactions";
export * from "./url-codec";

import { configuratorStore, r2Catalog } from "./configurator.store";
import { createMutationService } from "./mutation.service";

export const configuratorMutations = createMutationService(
  configuratorStore,
  r2Catalog,
);
