import { RegisteredNodeFunction } from "@confect/server/node";
import { DatabaseSchema, FunctionImpl, GroupImpl } from "@confect/server";
import {
  FunctionSpec,
  GenericId,
  GroupSpec,
  IdScope,
  Table,
} from "@confect/core";
import { expect, expectTypeOf, it } from "@effect/vitest";
import type { RegisteredAction } from "convex/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

it("registers a Node group without a factory parameter", () => {
  const group = GroupSpec.makeNode().addFunction(
    FunctionSpec.publicNodeAction({
      name: "run",
      returns: () => Schema.String,
    }),
  );
  const database = DatabaseSchema.make({});
  const layer = GroupImpl.make(database, group).pipe(
    Layer.provide(
      FunctionImpl.make(database, group, "run", () => Effect.succeed("ok")),
    ),
    GroupImpl.finalize,
  );
  const registered = RegisteredNodeFunction.buildForGroup<typeof group>(
    database,
    layer,
  );
  expect(registered.run).toBeDefined();
  expectTypeOf(registered.run).toExtend<
    RegisteredAction<"public", Record<string, unknown>, unknown>
  >();
  expectTypeOf<
    Parameters<typeof RegisteredNodeFunction.buildForGroup>["length"]
  >().toEqualTypeOf<2>();
});

it("compiles a component Node action's args and returns in the component scope", () => {
  const scope = IdScope.component("@example/counter");
  const counters = Table.make(() => Schema.Struct({ count: Schema.Finite }))(
    "counters",
    scope,
  );
  const database = DatabaseSchema.make(
    { counters },
    { kind: "component", scope },
  );
  // A scoped ID is typed as the raw Convex ID (string at the wire level), so
  // the handler's declared types accept the component's own ID schema.
  const group = GroupSpec.makeNode().addFunction(
    FunctionSpec.publicNodeAction({
      name: "touch",
      args: () => ({
        id: GenericId.GenericId("counters", scope),
      }),
      returns: () => GenericId.GenericId("counters", scope),
    }),
  );
  const layer = GroupImpl.make(database, group).pipe(
    Layer.provide(
      FunctionImpl.make(database, group, "touch", ({ id }) =>
        Effect.succeed(id),
      ),
    ),
    GroupImpl.finalize,
  );
  const registered = RegisteredNodeFunction.buildForGroup<typeof group>(
    database,
    layer,
  );

  // The compiled validators must keep Convex-side `v.id("counters")` checking:
  // compiling in the app scope would silently degrade these to `v.string()`.
  expect(exportedArgs(registered.touch)).toEqual(
    JSON.stringify({
      type: "object",
      value: {
        id: {
          fieldType: { type: "id", tableName: "counters" },
          optional: false,
        },
      },
    }),
  );
  expect(exportedReturns(registered.touch)).toEqual(
    JSON.stringify({ type: "id", tableName: "counters" }),
  );
});

const exportedArgs = (registered: RegisteredAction<any, any, any>): string =>
  (registered as unknown as { exportArgs: () => string }).exportArgs();

const exportedReturns = (registered: RegisteredAction<any, any, any>): string =>
  (registered as unknown as { exportReturns: () => string }).exportReturns();
