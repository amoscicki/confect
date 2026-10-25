import {
  Component,
  FunctionSpec,
  GenericId,
  GroupSpec,
  IdScope,
  type Ref,
  Spec,
  Table,
} from "@confect/core";
import {
  ConvexFunctionDefinitions,
  DatabaseReader,
  DatabaseSchema,
  DatabaseWriter,
  FunctionImpl,
  GroupImpl,
  MutationRunner,
  QueryRunner,
  RegisteredConvexFunction,
  Table as ServerTable,
} from "@confect/server";
import { expect, it } from "@effect/vitest";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  type FunctionReference,
} from "convex/server";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

// Cross-installation coverage for component handler capabilities: the same
// component definition is installed twice against one mock deployment, so any
// leaked ID, transaction, or runner state shows up as a cross-installation
// read. The component is defined here rather than imported from generated
// fixtures because the CLI codegen that emits component contracts and scoped
// `services.ts` files ships separately; nothing below depends on it.

const scope = IdScope.component("@confect/server-fixtures:counter");

const counters = Table.make(() =>
  Schema.Struct({ count: Schema.FiniteFromString }),
)("counters", scope);

const CounterId = GenericId.GenericId("counters", scope);
class Rejected extends Schema.TaggedError<Rejected>()("Rejected", {
  id: CounterId,
}) {}

const group = GroupSpec.make()
  .addFunction(
    FunctionSpec.publicMutation({
      name: "create",
      args: () => ({ count: Schema.FiniteFromString }),
      returns: () => CounterId,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "list",
      returns: () => Schema.Array(counters.Doc),
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "reject",
      error: () => Rejected,
      returns: () => Schema.Null,
    }),
  );

type CounterSpec = Spec.Spec<{
  readonly counter: GroupSpec.NamedAt<typeof group, "counter">;
}>;

const spec = Spec.fromGroups({
  ["counter"]: group,
}) as CounterSpec;

const contract = Component.make(spec, scope, ["counters"]);
const databaseSchema = DatabaseSchema.make(
  { counters },
  { kind: "component", scope },
);
type DatabaseSchema_ = typeof databaseSchema;
const hostSchema = DatabaseSchema.make({});
const hostConvexSchema = defineSchema({});

const create = FunctionImpl.make(databaseSchema, group, "create", ({ count }) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter.DatabaseWriter<DatabaseSchema_>();
    return yield* writer.table("counters").insert({ count });
  }).pipe(Effect.orDie),
);
const list = FunctionImpl.make(databaseSchema, group, "list", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader.DatabaseReader<DatabaseSchema_>();
    return yield* reader.table("counters").index("by_creation_time").collect();
  }).pipe(Effect.orDie),
);
const reject = FunctionImpl.make(databaseSchema, group, "reject", () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter.DatabaseWriter<DatabaseSchema_>();
    const id = yield* writer
      .table("counters")
      .insert({ count: 999 })
      .pipe(Effect.orDie);
    return yield* new Rejected({ id });
  }),
);

const componentLayer = GroupImpl.make(databaseSchema, group).pipe(
  Layer.provide([create, list, reject]),
  GroupImpl.finalize,
);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof group>(
  databaseSchema,
  componentLayer,
);

// The module Convex generates for an installed component's public API.
const componentModule = {
  create: RegisteredConvexFunction.register(definitions.create),
  list: RegisteredConvexFunction.register(definitions.list),
  reject: RegisteredConvexFunction.register(definitions.reject),
};

const componentSchema = defineSchema({
  counters: ServerTable.tableDefinition(counters),
});

const componentModules = {
  "_generated/server.ts": () => Promise.resolve({}),
  "counter.ts": () => Promise.resolve(componentModule),
};
const hostModules = { "_generated/server.ts": () => Promise.resolve({}) };

// The wire API Convex generates: component IDs cross the boundary as strings.
type CounterApi<ComponentName extends string> = {
  counter: {
    create: FunctionReference<
      "mutation",
      "internal",
      { count: string },
      string,
      ComponentName
    >;
    list: FunctionReference<
      "query",
      "internal",
      {},
      Array<{ _id: string; _creationTime: number; count: string }>,
      ComponentName
    >;
    reject: FunctionReference<"mutation", "internal", {}, null, ComponentName>;
  };
};
const components = componentsGeneric() as unknown as {
  first: CounterApi<"first">;
  second: CounterApi<"second">;
};
const first = Component.bind(contract, components.first);
const second = Component.bind(contract, components.second);

it.effect(
  "keeps two installations of one component isolated and typed apart",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      t.registerComponent("first", componentSchema, componentModules);
      t.registerComponent("second", componentSchema, componentModules);

      const wireId = yield* Effect.promise(() =>
        t.mutation(components.first.counter.create, { count: "2" }),
      );
      expect(
        yield* Effect.promise(() => t.query(components.first.counter.list)),
      ).toEqual([
        { _id: wireId, _creationTime: expect.any(Number), count: "2" },
      ]);

      const result = yield* Effect.promise(() =>
        t.run((ctx) =>
          // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- Convex invokes this callback in its transaction context; the handler needs its own per-call services.
          Effect.runPromise(
            Effect.gen(function* () {
              const { runMutation } = yield* MutationRunner.MutationRunner;
              const { runQuery } = yield* QueryRunner.QueryRunner;
              const id = yield* runMutation(second.counter.create, {
                count: 7,
              });
              const failure = yield* Effect.result(
                runMutation(first.counter.reject),
              );
              expect(Result.isFailure(failure)).toBe(true);
              if (Result.isFailure(failure))
                expect(failure.failure).toMatchObject({
                  _tag: "Rejected",
                  id: expect.any(String),
                });
              // Catching a typed component error must not commit its failed
              // subtransaction.
              return {
                id,
                first: yield* runQuery(first.counter.list),
                second: yield* runQuery(second.counter.list),
              };
            }).pipe(
              Effect.provide(
                RegisteredConvexFunction.mutationLayer(hostSchema, ctx),
              ),
            ),
          ),
        ),
      );
      // Each installation sees only its own documents. Typed readers decode
      // the stored string counts back to numbers.
      expect(Array.map(result.first, (row) => row.count)).toEqual([2]);
      expect(result.second).toEqual([
        { _id: result.id, _creationTime: expect.any(Number), count: 7 },
      ]);
      const own: Ref.Returns<typeof second.counter.create> = result.id;
      // @ts-expect-error Component installations have different ID types.
      const wrong: Ref.Returns<typeof first.counter.create> = result.id;
      void [own, wrong];
    }),
  { timeout: 30_000 },
);
