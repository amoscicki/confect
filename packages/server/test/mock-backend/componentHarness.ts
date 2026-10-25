import { DatabaseSchema } from "@confect/server";
import type { convexTest } from "convex-test";
import { defineSchema } from "convex/server";

// Shared setup for the mock-backend suites that install a generated component
// with `convex-test`: the host schema, the module stubs a component needs to
// load, and the `registerComponent` call. Those suites exercise the seam
// between codegen's contract, the wire API Convex derives from it, and
// Confect's scoped runners, so they share one host rather than each declaring a
// slightly different one.

/**
 * Runtime schema for the empty host, for
 * `RegisteredConvexFunction.mutationLayer`. Host tables would only matter to
 * Confect-managed host functions; a suite whose Convex-side code reads host
 * tables declares its own deploy-time host schema (and passes it to
 * `convexTest`) instead of using `hostConvexSchema`.
 */
export const hostSchema = DatabaseSchema.make({});

/**
 * Deploy-time schema of the empty host.
 */
export const hostConvexSchema = defineSchema({});

/**
 * Modules for a host or component: the Convex-side `server.ts` stub only.
 */
export const hostModules = {
  "_generated/server.ts": () => Promise.resolve({}),
};

type ComponentSchema = Parameters<
  ReturnType<typeof convexTest>["registerComponent"]
>[1];

/**
 * Install one generated component under `componentPath`. `functions` are the
 * component's generated Convex wrappers, keyed by path relative to the
 * component's `convex/` directory; the `server.ts` stub is added here so every
 * suite loads a component the same way.
 */
export const registerComponent = (
  t: ReturnType<typeof convexTest>,
  componentPath: string,
  schema: ComponentSchema,
  functions: Record<string, () => Promise<unknown>>,
) =>
  t.registerComponent(componentPath, schema, { ...hostModules, ...functions });
