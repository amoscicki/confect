import type { GenericSchema, SchemaDefinition } from "convex/server";

import componentSchema from "./convex/schema";

export { componentSchema };

/**
 * The subset of a `convexTest` instance a component package needs to install
 * itself. Kept structural rather than importing convex-test's accessor type so
 * the helper does not pin the convex-test version a consumer resolves.
 */
interface ComponentRegistrar {
  registerComponent: (
    componentPath: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: Record<string, () => Promise<any>>,
  ) => void;
}

export const componentModules: Record<string, () => Promise<any>> = {
  "_generated/server.ts": () => Promise.resolve({}),
  "counter.ts": () => import("./convex/counter"),
};

/**
 * Register this component on a caller-created `convexTest` instance, the way a
 * component package's own `register(t)` helper would. Each call installs an
 * independent instance at `componentPath`.
 */
export const register = (
  t: ComponentRegistrar,
  componentPath = "counter",
): void =>
  t.registerComponent(componentPath, componentSchema, componentModules);
