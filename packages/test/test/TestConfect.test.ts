import { describe, expect, it } from "@effect/vitest";
import { Component, Ref } from "@confect/core";
import * as DatabaseSchema from "@confect/server/DatabaseSchema";
import { MutationRunner } from "@confect/server/MutationRunner";
import { TestConfect as TestConfect_ } from "@confect/test";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  type FunctionReference,
} from "convex/server";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import {
  CounterId,
  type CounterApi,
  contract,
} from "./fixtures/vanilla-component/contract";
import {
  componentSchema,
  componentModules,
  register,
} from "./fixtures/vanilla-component/register";

// The wire API a vanilla component ships in `_generated/component.js`: no
// Confect contract involved, so these types are written out by hand.
type VanillaCounterApi<ComponentName extends string> = {
  counter: {
    create: FunctionReference<
      "mutation",
      "internal",
      { count: number },
      string,
      ComponentName
    >;
    list: FunctionReference<
      "query",
      "internal",
      {},
      Array<{ _id: string; _creationTime: number; count: number }>,
      ComponentName
    >;
  };
};

const components = componentsGeneric() as unknown as {
  vanilla: VanillaCounterApi<"vanilla">;
  counter: CounterApi<"counter">;
  first: CounterApi<"first">;
  second: CounterApi<"second">;
};

// One contract bound to separate installations of the same component.
const counter = Component.bind(contract, components.counter);
const first = Component.bind(contract, components.first);
const second = Component.bind(contract, components.second);
const vanillaCreate = Ref.fromFunctionReference(
  components.vanilla.counter.create,
);
const vanillaList = Ref.fromFunctionReference(components.vanilla.counter.list);

const hostSchema = DatabaseSchema.make({});
const hostConvexSchema = defineSchema({});
const hostModules = { "_generated/server.ts": () => Promise.resolve({}) };
const layer = TestConfect_.layer(hostSchema, hostConvexSchema, hostModules);

const counts = (rows: ReadonlyArray<{ count: number }>) =>
  Array.map(rows, (row) => row.count);

describe("registerComponent", () => {
  it.effect("registers a vanilla component callable through native refs", () =>
    Effect.gen(function* () {
      const t = yield* TestConfect_.TestConfect<typeof hostSchema>();

      yield* t.registerComponent("vanilla", componentSchema, componentModules);
      const id = yield* t.mutation(vanillaCreate, { count: 3 });

      expect(counts(yield* t.query(vanillaList))).toEqual([3]);
      expect(id).toBeTypeOf("string");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps installations at distinct paths isolated", () =>
    Effect.gen(function* () {
      const t = yield* TestConfect_.TestConfect<typeof hostSchema>();

      yield* t.registerComponent("first", componentSchema, componentModules);
      yield* t.registerComponent("second", componentSchema, componentModules);

      const firstId = yield* t.mutation(first.counter.create, { count: 1 });
      yield* t.mutation(first.counter.create, { count: 10 });
      const secondId = yield* t.mutation(second.counter.create, { count: 2 });

      expect(counts(yield* t.query(first.counter.list))).toEqual([1, 10]);
      expect(counts(yield* t.query(second.counter.list))).toEqual([2]);
      // A document written through one installation is readable through that
      // installation.
      expect(
        yield* t.query(second.counter.get, { id: secondId }),
      ).toMatchObject({ count: 2 });
      expect(yield* t.query(first.counter.get, { id: firstId })).toMatchObject({
        count: 1,
      });

      // Reading another installation's ID through this one resolves in this
      // installation's own database, so it returns first's own row rather than
      // second's. convex-test gives every installation an independent ID
      // counter, so `secondId` can even be the same string as `firstId`; only
      // the per-installation ID types distinguish them, which is why crossing
      // them needs a cast.
      const crossRead = yield* t.query(first.counter.get, {
        id: secondId as unknown as Ref.Args<typeof first.counter.get>["id"],
      });
      expect(crossRead).toMatchObject({ count: 1 });
      expect(counts(yield* t.query(second.counter.list))).toEqual([2]);

      const own: Ref.Returns<typeof second.counter.create> = secondId;
      void own;
      // @ts-expect-error Component installations have different ID types.
      const foreign: Ref.Returns<typeof first.counter.create> = secondId;
      void foreign;
    }).pipe(Effect.provide(layer)),
  );

  it.effect("replacing a registration at a path resets that database", () =>
    Effect.gen(function* () {
      const t = yield* TestConfect_.TestConfect<typeof hostSchema>();

      yield* t.registerComponent("first", componentSchema, componentModules);
      yield* t.mutation(first.counter.create, { count: 7 });
      expect(counts(yield* t.query(first.counter.list))).toEqual([7]);

      // Registering the same path again replaces the installation with a fresh
      // database, so documents written to the previous one are gone.
      yield* t.registerComponent("first", componentSchema, componentModules);
      expect(yield* t.query(first.counter.list)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("decodes a bound component's typed error", () =>
    Effect.gen(function* () {
      const t = yield* TestConfect_.TestConfect<typeof hostSchema>();

      yield* t.registerComponent("counter", componentSchema, componentModules);
      const failure = yield* Effect.result(t.mutation(counter.counter.reject));

      expect(Result.isFailure(failure)).toBe(true);
      if (Result.isFailure(failure))
        expect(failure.failure).toMatchObject({
          _tag: "Rejected",
          id: expect.any(String),
        });
      // Catching the typed error must not commit its failed subtransaction.
      expect(yield* t.query(counter.counter.list)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lets a host function call a registered component", () =>
    Effect.gen(function* () {
      const t = yield* TestConfect_.TestConfect<typeof hostSchema>();

      yield* t.registerComponent("counter", componentSchema, componentModules);
      const id = yield* t.run(
        Effect.gen(function* () {
          const mutation = yield* MutationRunner;
          return yield* mutation.runMutation(counter.counter.create, {
            count: 4,
          });
        }),
        Component.schema(counter, CounterId),
      );

      expect(counts(yield* t.query(counter.counter.list))).toEqual([4]);
      expect(id).toBeTypeOf("string");
    }).pipe(Effect.provide(layer)),
  );
});

describe("layerFromInstance", () => {
  it.effect(
    "wraps an instance whose component was registered beforehand",
    () => {
      const instance = convexTest(hostConvexSchema, hostModules);
      register(instance, "vanilla");
      const sharedLayer = TestConfect_.layerFromInstance(hostSchema, instance);

      return Effect.gen(function* () {
        yield* Effect.promise(() =>
          instance.mutation(components.vanilla.counter.create, { count: 5 }),
        );

        const before = yield* Effect.gen(function* () {
          const t = yield* TestConfect_.TestConfect<typeof hostSchema>();
          const seen = counts(yield* t.query(vanillaList));
          yield* t.mutation(vanillaCreate, { count: 7 });
          return seen;
        }).pipe(Effect.provide(sharedLayer));

        // The supplied instance is shared in both directions: its earlier writes
        // are visible through TestConfect, and TestConfect's writes land in it.
        expect(before).toEqual([5]);
        const throughInstance = yield* Effect.promise(() =>
          instance.query(components.vanilla.counter.list),
        );
        expect(counts(throughInstance)).toEqual([5, 7]);

        // Building the layer again wraps the same instance instead of resetting
        // it, so everything written above is still there.
        const afterRebuild = yield* Effect.gen(function* () {
          const t = yield* TestConfect_.TestConfect<typeof hostSchema>();
          return counts(yield* t.query(vanillaList));
        }).pipe(
          Effect.provide(TestConfect_.layerFromInstance(hostSchema, instance)),
        );
        expect(afterRebuild).toEqual([5, 7]);
      });
    },
  );
});
