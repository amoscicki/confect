import type { Ref } from "@confect/core";
import {
  Component,
  FunctionSpec,
  GenericId,
  GroupSpec,
  IdScope,
  Spec,
} from "@confect/core";
import {
  DatabaseSchema,
  MutationRunner,
  QueryRunner,
  RegisteredConvexFunction,
} from "@confect/server";
import { assert, expect, it } from "@effect/vitest";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  type FunctionReference,
} from "convex/server";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import type * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { vi } from "vitest";
import contract from "../../../cli/test/fixtures/authored-component/confect/_generated/component";
import { Id } from "../../../cli/test/fixtures/authored-component/confect/_generated/id";
import componentSchema from "../../../cli/test/fixtures/authored-component/convex/schema";

// Cross-package coverage for the CMS-style deployment shape: one authored
// component mounted several times in a single application. Convex gives every
// installation its own database, function namespace, and `ComponentApi` mount
// name, so the integration points are codegen's contract, `Component.bind`'s
// per-installation scope, and the Confect runners calling into each install.
// Kept out of the per-module suites because the point is the seam between them.

// The registry the CLI's components template emits for an application that
// installs one component three times (`app.use(counter, { name })`). This suite
// spells out the Convex-generated wire shape rather than importing a generated
// `convex/_generated/component.ts`, which only `convex codegen` produces and
// the CLI fixture does not commit.
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
type Components = {
  readonly alpha: CounterApi<"alpha">;
  readonly beta: CounterApi<"beta">;
  readonly gamma: CounterApi<"gamma">;
};
const components = componentsGeneric() as unknown as Components;
const alpha = Component.bind(contract, components.alpha);
const beta = Component.bind(contract, components.beta);
const gamma = Component.bind(contract, components.gamma);

const hostSchema = DatabaseSchema.make({});
const hostConvexSchema = defineSchema({});
const hostModules = { "_generated/server.ts": () => Promise.resolve({}) };
const componentModules = {
  "_generated/server.ts": () => Promise.resolve({}),
  "counter.ts": () =>
    import("../../../cli/test/fixtures/authored-component/convex/counter"),
};

/**
 * Adapter for convex-test's `runInComponent`, which exists on the runtime
 * accessor but is not part of its public `TestConvex` type. Narrowing it here
 * names the single extra capability this suite relies on: reading one
 * installation's database directly.
 */
type ComponentAccessor = {
  readonly runInComponent: <A>(
    componentPath: string,
    handler: (ctx: {
      readonly db: { readonly get: (id: string) => Promise<unknown> };
    }) => Promise<A>,
  ) => Promise<A>;
};

const asComponents = (t: unknown) => t as ComponentAccessor;

// `Spec.fromGroups` widens to `AnyWithProps`, which would collapse the spec's
// per-group types; re-narrow it so each registry entry keeps its mount name.
const specFrom = <
  const Groups extends Record.ReadonlyRecord<string, GroupSpec.AnyWithProps>,
>(
  groups: Groups,
): Spec.Spec<
  Extract<
    {
      readonly [Name in keyof Groups]: GroupSpec.NamedAt<
        Groups[Name],
        Name & string
      >;
    },
    Record.ReadonlyRecord<string, GroupSpec.AnyWithProps>
  >
> => Spec.fromGroups(groups) as never;

it.effect(
  "isolates data, decoded values, and typed errors across three installations",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      t.registerComponent("alpha", componentSchema, componentModules);
      t.registerComponent("beta", componentSchema, componentModules);
      t.registerComponent("gamma", componentSchema, componentModules);

      // Vanilla wire calls on the same installations see Convex's encoded
      // values: `count` crosses the boundary as a string.
      const alphaWireId = yield* Effect.promise(() =>
        t.mutation(components.alpha.counter.create, { count: "2" }),
      );
      const betaWireId = yield* Effect.promise(() =>
        t.mutation(components.beta.counter.create, { count: "7" }),
      );
      const alphaWireDocs = yield* Effect.promise(() =>
        t.query(components.alpha.counter.list),
      );
      const betaWireDocs = yield* Effect.promise(() =>
        t.query(components.beta.counter.list),
      );
      expect(alphaWireDocs).toEqual([
        { _id: alphaWireId, _creationTime: expect.any(Number), count: "2" },
      ]);
      expect(betaWireDocs).toEqual([
        { _id: betaWireId, _creationTime: expect.any(Number), count: "7" },
      ]);

      const result = yield* Effect.promise(() =>
        t.run((ctx) =>
          // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- Convex invokes this callback in its transaction context; the handler needs its own per-call services.
          Effect.runPromise(
            Effect.gen(function* () {
              const { runMutation } = yield* MutationRunner.MutationRunner;
              const { runQuery } = yield* QueryRunner.QueryRunner;
              // Confect decodes the same wire values on both sides: the host
              // passes a number and reads back numbers, while the wire keeps
              // strings (asserted through the vanilla calls above).
              const alphaId = yield* runMutation(alpha.counter.create, {
                count: 3,
              });
              const betaId = yield* runMutation(beta.counter.create, {
                count: 5,
              });
              // Each reject keeps its own ref's failure type, so the typed
              // error—and the ID it carries—stays per-installation. Assertions
              // run inside the transaction because `Result` is not a Convex
              // value: only plain data may cross the `t.run` boundary.
              const alphaRejected = yield* Effect.result(
                runMutation(alpha.counter.reject),
              );
              const betaRejected = yield* Effect.result(
                runMutation(beta.counter.reject),
              );
              const gammaRejected = yield* Effect.result(
                runMutation(gamma.counter.reject),
              );
              assert(Result.isFailure(alphaRejected));
              assert(Result.isFailure(betaRejected));
              assert(Result.isFailure(gammaRejected));
              const alphaFailure = alphaRejected.failure;
              const betaFailure = betaRejected.failure;
              const gammaFailure = gammaRejected.failure;
              assert(alphaFailure._tag === "Rejected");
              assert(betaFailure._tag === "Rejected");
              assert(gammaFailure._tag === "Rejected");
              // The typed error keeps its tag and its installation's ID type.
              const alphaErrorId: Ref.Returns<typeof alpha.counter.create> =
                alphaFailure.id;
              const betaErrorId: Ref.Returns<typeof beta.counter.create> =
                betaFailure.id;
              const gammaErrorId: Ref.Returns<typeof gamma.counter.create> =
                gammaFailure.id;
              void [alphaErrorId, betaErrorId, gammaErrorId];
              // @ts-expect-error Component installations have different ID types.
              const wrongInstallationId: Ref.Returns<
                typeof beta.counter.create
              > = alphaFailure.id;
              void wrongInstallationId;
              // beta's codec decodes alpha's ID unchanged: scope is
              // compile-time identity, not a wire marker.
              expect(
                yield* Schema.decodeUnknownEffect(
                  Component.id(beta, "counters"),
                )(alphaFailure.id),
              ).toBe(alphaFailure.id);
              return {
                alphaId,
                betaId,
                rejections: {
                  alpha: { _tag: alphaFailure._tag, id: alphaFailure.id },
                  beta: { _tag: betaFailure._tag, id: betaFailure.id },
                  gamma: { _tag: gammaFailure._tag, id: gammaFailure.id },
                },
                alpha: yield* runQuery(alpha.counter.list),
                beta: yield* runQuery(beta.counter.list),
                gamma: yield* runQuery(gamma.counter.list),
              };
            }).pipe(
              Effect.provide(
                RegisteredConvexFunction.mutationLayer(hostSchema, ctx),
              ),
            ),
          ),
        ),
      );

      // Every installation only ever sees the rows written to it, whichever
      // side (wire or Confect) wrote them.
      expect(Array.map(result.alpha, (row) => row.count)).toEqual([2, 3]);
      expect(Array.map(result.beta, (row) => row.count)).toEqual([7, 5]);
      // The third installation received no successful write: its `reject`
      // call failed, so the row it inserted was rolled back with the
      // transaction rather than leaking into gamma.
      expect(Array.map(result.gamma, (row) => row.count)).toEqual([]);

      // Every installation's typed error keeps its tag and an ID of its own.
      expect(result.rejections).toEqual({
        alpha: { _tag: "Rejected", id: expect.any(String) },
        beta: { _tag: "Rejected", id: expect.any(String) },
        gamma: { _tag: "Rejected", id: expect.any(String) },
      });
      // A failure's ID is a plain string on the wire: it carries no marker
      // naming the installation that minted it, so each installation's own
      // codec—not the string—is what distinguishes them. (convex-test numbers
      // IDs per component database, so equal strings may name different rows.)
      for (const rejection of Object.values(result.rejections)) {
        expect(typeof rejection.id).toBe("string");
      }
      expect(
        yield* Schema.decodeEffect(Component.id(alpha, "counters"))(
          result.rejections.alpha.id,
        ),
      ).toBe(result.rejections.alpha.id);

      // Installation scopes are compile-time identity, not authorization: an
      // alpha ID is a plain string, decodes unchanged under beta's codec, and
      // beta's database simply has no such document.
      const alphaCodec = Component.schema(alpha, Id("counters"));
      const betaCodec = Component.schema(beta, Id("counters"));
      expect(yield* Schema.decodeEffect(alphaCodec)(result.alphaId)).toBe(
        result.alphaId,
      );
      // `decodeUnknownEffect` stands in for a boundary that has no compile-time
      // proof the string belongs to this installation.
      expect(yield* Schema.decodeUnknownEffect(betaCodec)(result.alphaId)).toBe(
        result.alphaId,
      );
      // @ts-expect-error A reused codec keeps its installation's identity.
      const betaTypedId: Ref.Returns<typeof beta.counter.create> =
        yield* Schema.decodeEffect(alphaCodec)(result.alphaId);
      void betaTypedId;

      const accessor = asComponents(t);
      const rowIn = (componentPath: string, id: string) =>
        Effect.promise(() =>
          accessor.runInComponent(componentPath, (ctx) => ctx.db.get(id)),
        );
      // The raw row stays wire-encoded even though Confect reads back numbers.
      expect(yield* rowIn("alpha", result.alphaId)).toMatchObject({
        _id: result.alphaId,
        count: "3",
      });
      // IDs are scopes, not authorisations, and the same string is not the
      // same document: each installation's database resolves it inside its
      // own storage. beta's row is the one beta wrote (wire-encoded "5"), not
      // alpha's "3"—only the compiler keeps installations apart.
      expect(yield* rowIn("beta", result.betaId)).toMatchObject({
        _id: result.betaId,
        count: "5",
      });
      // gamma received no successful write, so its database is empty.
      expect(yield* rowIn("gamma", result.alphaId)).toBeNull();
      // Type level: IDs minted by one installation are not interchangeable
      // with another's, whether typed through a ref, `Component.id`, or
      // `Component.schema`.
      const alphaTableId: Ref.Returns<typeof alpha.counter.create> =
        yield* Schema.decodeUnknownEffect(Component.id(alpha, "counters"))(
          "one",
        );
      void alphaTableId;
      // @ts-expect-error Table IDs are per-installation.
      const betaTableId: Ref.Returns<typeof beta.counter.create> = alphaTableId;
      void betaTableId;
      // @ts-expect-error So are whole-function refs from another install.
      const betaRef: typeof beta.counter.create = alpha.counter.create;
      void betaRef;
    }),
  { timeout: 30_000 },
);

it("binds one contract to three installations cheaply and independently", () => {
  // Binding is pure bookkeeping over lazy schemas: installing a contract
  // three times must not evaluate the author's thunks. The thunks below
  // are the only observable evidence, mirroring the core Component suite.
  const definitionScope = IdScope.component("@confect-fixtures/counter:convex");
  const args = vi.fn(() => ({
    id: GenericId.GenericId("counters", definitionScope),
  }));
  const returns = vi.fn(() => GenericId.GenericId("counters", definitionScope));
  const lazySpec = specFrom({
    counter: GroupSpec.make().addFunction(
      FunctionSpec.publicQuery({ name: "read", args, returns }),
    ),
  });
  const lazyContract = Component.make(lazySpec, definitionScope, ["counters"]);
  const registry = componentsGeneric() as unknown as {
    alpha: Component.Api<typeof lazySpec, "alpha">;
    beta: Component.Api<typeof lazySpec, "beta">;
    gamma: Component.Api<typeof lazySpec, "gamma">;
  };
  const left = Component.bind(lazyContract, registry.alpha);
  const middle = Component.bind(lazyContract, registry.beta);
  const right = Component.bind(lazyContract, registry.gamma);
  expect(args).not.toHaveBeenCalled();
  expect(returns).not.toHaveBeenCalled();

  assert(
    left.counter.read._tag === "Confect" &&
      middle.counter.read._tag === "Confect" &&
      right.counter.read._tag === "Confect",
  );
  // Reading one installation forces (and then memoises) the shared thunks;
  // the others still cost nothing until they are read themselves.
  expect(left.counter.read.args).toBe(left.counter.read.args);
  expect(args).toHaveBeenCalledTimes(1);
  expect(returns).not.toHaveBeenCalled();
  void middle.counter.read.returns;
  void right.counter.read.returns;
  expect(returns).toHaveBeenCalledTimes(1);

  const scopeOf = (installation: Parameters<typeof Component.id>[0]) =>
    GenericId.scope(Component.id(installation, "counters").ast);
  const scopes = [scopeOf(left), scopeOf(middle), scopeOf(right)];
  expect(new Set(scopes).size).toBe(3);
  // Each bound tree is its own object graph; nothing is shared between
  // installations except the author's schemas.
  expect(left).not.toBe(middle);
  expect(middle).not.toBe(right);
  expect(left.counter).not.toBe(middle.counter);
  expect(left.counter.read).not.toBe(middle.counter.read);
  expect(GenericId.scope(left.counter.read.args.fields.id.ast)).toBe(scopes[0]);
  expect(GenericId.scope(middle.counter.read.returns.ast)).toBe(scopes[1]);
  expect(GenericId.scope(right.counter.read.returns.ast)).toBe(scopes[2]);
  // Rebinding the same native reference is deterministic, so installs can
  // be re-bound without drifting their identity.
  expect(scopeOf(Component.bind(lazyContract, registry.gamma))).toBe(scopes[2]);
  // Rebinding reuses the author's memoised schemas rather than re-evaluating
  // them, so only the first read of each schema ran the thunk.
  expect(args).toHaveBeenCalledTimes(1);
});
