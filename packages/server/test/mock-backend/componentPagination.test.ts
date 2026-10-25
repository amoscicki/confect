import type { Ref, GenericId } from "@confect/core";
import { Component } from "@confect/core";
import {
  MutationRunner,
  QueryRunner,
  RegisteredConvexFunction,
} from "@confect/server";
import { expect, it } from "@effect/vitest";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  defineTable,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import contract from "../../../cli/test/fixtures/paginated-component/confect/_generated/component";
import type { scope as definitionScope } from "../../../cli/test/fixtures/paginated-component/confect/_generated/id";
import componentSchema from "../../../cli/test/fixtures/paginated-component/convex/schema";
import { hostModules, hostSchema, registerComponent } from "./componentHarness";

// Confect adds no pagination rule of its own: `OrderedQuery.paginate` forwards
// to Convex's native `.paginate()`, so what a component may do is whatever the
// backend enforces. #646 documented "native database pagination is not
// supported inside components" when the deployed backend rejected it; current
// backends allow one native paginated query per overall query transaction,
// shared by the calling app function and every nested/component call.
//
// This suite pins the boundary under the pinned `convex-test` 0.0.60, whose
// mock differs from current backends:
//
// - 0.0.54 enforced one `.paginate()` per function execution (a per-execution
//   counter), so a component paginated query already worked in isolation.
// - 0.0.61 began rejecting `.paginate()` in components outright.
// - 0.0.64 reversed 0.0.61 and changed the budget to one call per overall
//   query transaction, shared with nested/component queries, while mutations
//   may paginate repeatedly.
//
// Adopting >= 0.0.61 therefore has to move these fixtures with it: 0.0.61
// makes the component's own paginated queries fail outright, and 0.0.64 makes
// the host-plus-component cases fail by sharing the host query's one-call
// budget with the component. So this suite asserts what 0.0.60 actually does,
// and each case names the version it observes so that a later mock upgrade
// flips the test consciously rather than silently.
//
// `QueryStream.paginate` is the sanctioned way to walk several pages or make
// more than one paginated read in one execution: its cursors are independent of
// the native budget pinned above. The last two cases cover that path inside a
// component, so a regression in the recommended alternative fails here too.

type PaginationApi<ComponentName extends string> = {
  pagination: {
    create: FunctionReference<
      "mutation",
      "internal",
      { text: string },
      string,
      ComponentName
    >;
    list: FunctionReference<
      "query",
      "internal",
      {
        paginationOpts: {
          numItems: number;
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumRowsRead?: number;
          maximumBytesRead?: number;
        };
      },
      {
        page: Array<{ _id: string; _creationTime: number; text: string }>;
        isDone: boolean;
        continueCursor: string;
        splitCursor?: string | null;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
      },
      ComponentName
    >;
    streamPage: FunctionReference<
      "query",
      "internal",
      {
        paginationOpts: {
          numItems: number;
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumRowsRead?: number;
          maximumBytesRead?: number;
        };
      },
      {
        page: Array<{ _id: string; _creationTime: number; text: string }>;
        isDone: boolean;
        continueCursor: string;
        splitCursor?: string | null;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
      },
      ComponentName
    >;
    paginateTwice: FunctionReference<
      "query",
      "internal",
      { numItems: number },
      boolean,
      ComponentName
    >;
  };
};

const components = componentsGeneric() as unknown as {
  pagination: PaginationApi<"pagination">;
  pagination2: PaginationApi<"pagination2">;
};
const bound = Component.bind(contract, components.pagination);
// A second installation of the same contract, bound only for its types: page
// IDs must be scoped to the installation that produced them, not to the shared
// definition scope or to a sibling installation. Runtime coverage of several
// installations lives in `components.test.ts`.
const other = Component.bind(contract, components.pagination2);

// The host needs one table of its own: these tests compare a component's
// native pagination budget with the host query's, so the host must paginate
// something. Everything else about the host comes from the shared harness.
const hostConvexSchema = defineSchema({
  notes: defineTable({ text: v.string() }),
});
const paginationModules = {
  "pagination.ts": () =>
    import("../../../cli/test/fixtures/paginated-component/convex/pagination"),
};

const register = (t: ReturnType<typeof convexTest>) =>
  registerComponent(t, "pagination", componentSchema, paginationModules);

/**
 * The mock's own rejection, kept typed so assertions read its message.
 */
class MockRejection extends Data.TaggedError("MockRejection")<{
  readonly message: string;
}> {}

const fromMock = (error: unknown) =>
  new MockRejection({ message: String(error) });

it.effect(
  "pages a component's paginated query through Component.bind",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      register(t);

      const result = yield* Effect.promise(() =>
        t.run((ctx) =>
          // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- Convex invokes this callback in its transaction context; the handler needs its own per-call services.
          Effect.runPromise(
            Effect.gen(function* () {
              const { runMutation } = yield* MutationRunner.MutationRunner;
              const { runQuery } = yield* QueryRunner.QueryRunner;

              const ids = yield* Effect.forEach(
                ["a", "b", "c", "d", "e"],
                (text) => runMutation(bound.pagination.create, { text }),
              );

              const pages: Array<Ref.Returns<typeof bound.pagination.list>> =
                [];
              let cursor: string | null = null;
              // Each page is a separate `runQuery`, so every call gets its own
              // native pagination budget and the returned cursor can be
              // replayed. This is the supported component pagination loop.
              // The bound is deliberate: a regression that returned
              // `isDone: false` with a non-advancing cursor should fail on the
              // assertion, not by burning the test timeout.
              for (let index = 0; index < 4; index++) {
                const page: Ref.Returns<typeof bound.pagination.list> =
                  yield* runQuery(bound.pagination.list, {
                    paginationOpts: { numItems: 2, cursor },
                  });
                pages.push(page);
                if (page.isDone) break;
                expect(page.continueCursor).not.toBe(cursor);
                cursor = page.continueCursor;
              }

              return { ids, pages };
            }).pipe(
              Effect.provide(
                RegisteredConvexFunction.mutationLayer(hostSchema, ctx),
              ),
            ),
          ),
        ),
      );

      // 0.0.60: a component's paginated query runs and the page items carry
      // the installation's typed IDs, rebound from the definition scope.
      const docs = result.pages.flatMap((page) =>
        page.page.map((doc) => doc.text),
      );
      expect(docs).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.pages.map((page) => page.page.length)).toEqual([2, 2, 1]);
      expect(result.pages.map((page) => page.isDone)).toEqual([
        false,
        false,
        true,
      ]);
      // Every page but the last returns a cursor the next call can replay.
      expect(
        result.pages
          .slice(0, -1)
          .every((page) => page.continueCursor.length > 0),
      ).toBe(true);
      const pageIds = result.pages.flatMap((page) =>
        page.page.map((doc) => doc._id),
      );
      expect(pageIds).toEqual(result.ids);
      // Decoding a page preserves each item's typed ID: the item schema is
      // rebound from the definition scope to this installation's.
      const own: Ref.Returns<typeof bound.pagination.create> = pageIds[0];
      // @ts-expect-error Page IDs belong to this installation, not the definition's scope.
      const definitionScoped: GenericId.GenericId<
        "items",
        typeof definitionScope
      > = pageIds[0];
      // Two installations of the same contract get mutually exclusive page
      // element ID types, so a page from one cannot be typed as the other's.
      // @ts-expect-error Page IDs are scoped to the installation that produced them.
      const otherId: Ref.Returns<
        typeof other.pagination.list
      >["page"][number]["_id"] = pageIds[0];
      // @ts-expect-error …in both directions.
      const ownId: Ref.Returns<
        typeof bound.pagination.list
      >["page"][number]["_id"] = otherId;
      // @ts-expect-error A whole page item carries the same installation scope.
      const otherDoc: Ref.Returns<
        typeof other.pagination.list
      >["page"][number] = result.pages[0]!.page[0]!;
      void [own, definitionScoped, otherId, ownId, otherDoc];
    }),
  { timeout: 30_000 },
);

it.effect(
  "rejects a second native paginate in one component query execution under convex-test 0.0.60",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      register(t);
      yield* Effect.promise(() =>
        t.mutation(components.pagination.pagination.create, { text: "x" }),
      );

      // 0.0.60 keeps a single-paginate budget per function execution (0.0.54
      // semantics), and its error message names that rule. 0.0.61 would reject
      // the first call in a component instead; 0.0.64 allows component
      // pagination and instead shares one budget across the overall query.
      const failure = yield* Effect.flip(
        Effect.tryPromise({
          try: () =>
            t.query(components.pagination.pagination.paginateTwice, {
              numItems: 1,
            }),
          catch: fromMock,
        }),
      );
      expect(failure.message).toMatch(
        /Only a single paginated query \(`\.paginate\(\)`\) is allowed per function execution/,
      );
    }),
  { timeout: 30_000 },
);

it.effect(
  "counts a component's paginate against its own execution budget, not the host's, under convex-test 0.0.60",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      register(t);
      yield* Effect.promise(() =>
        t.mutation(components.pagination.pagination.create, { text: "x" }),
      );
      yield* Effect.promise(() =>
        t.mutation((ctx) => ctx.db.insert("notes", { text: "host" })),
      );

      // 0.0.60 gives every nested query a fresh budget, so a host query can
      // paginate both its own table and a component in one transaction. 0.0.64
      // shares the host query's budget with its component calls, so the second
      // `.paginate()` here would throw once the mock is adopted.
      const result = yield* Effect.promise(() =>
        // oxlint-disable-next-line effecttsgo/async-function -- Convex runs inline queries as async functions; the awaits are the backend boundary.
        t.query(async (ctx) => {
          const componentPage = await ctx.runQuery(
            components.pagination.pagination.list,
            { paginationOpts: { numItems: 1, cursor: null } },
          );
          const hostPage = await ctx.db
            .query("notes")
            .paginate({ numItems: 1, cursor: null });
          return {
            component: componentPage.page.map((doc) => doc.text),
            host: hostPage.page.map((doc) => doc.text),
          };
        }),
      );
      expect(result).toEqual({ component: ["x"], host: ["host"] });
    }),
  { timeout: 30_000 },
);

it.effect(
  "walks several QueryStream pages of a component query through Component.bind",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      register(t);

      const result = yield* Effect.promise(() =>
        t.run((ctx) =>
          // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- Convex invokes this callback in its transaction context; the handler needs its own per-call services.
          Effect.runPromise(
            Effect.gen(function* () {
              const { runMutation } = yield* MutationRunner.MutationRunner;
              const { runQuery } = yield* QueryRunner.QueryRunner;

              const ids = yield* Effect.forEach(
                ["a", "b", "c", "d", "e"],
                (text) => runMutation(bound.pagination.create, { text }),
              );

              const pages: Array<
                Ref.Returns<typeof bound.pagination.streamPage>
              > = [];
              let cursor: string | null = null;
              // `QueryStream.paginate` walks the index query stream rather
              // than the native `.paginate()`, so its cursors are independent
              // of the backend's native pagination budget. This is the
              // documented way to page a component several times.
              for (let index = 0; index < 4; index++) {
                const page: Ref.Returns<typeof bound.pagination.streamPage> =
                  yield* runQuery(bound.pagination.streamPage, {
                    paginationOpts: { numItems: 2, cursor },
                  });
                pages.push(page);
                if (page.isDone) break;
                expect(page.continueCursor).not.toBe(cursor);
                cursor = page.continueCursor;
              }

              // Both pagination paths agree on the same pages of the same
              // component rows.
              const native = yield* runQuery(bound.pagination.list, {
                paginationOpts: { numItems: 5, cursor: null },
              });

              return { ids, pages, native };
            }).pipe(
              Effect.provide(
                RegisteredConvexFunction.mutationLayer(hostSchema, ctx),
              ),
            ),
          ),
        ),
      );

      const docs = result.pages.flatMap((page) =>
        page.page.map((doc) => doc.text),
      );
      expect(docs).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.pages.map((page) => page.page.length)).toEqual([2, 2, 1]);
      expect(result.pages.map((page) => page.isDone)).toEqual([
        false,
        false,
        true,
      ]);
      expect(
        result.pages
          .slice(0, -1)
          .every((page) => page.continueCursor.length > 0),
      ).toBe(true);
      const pageIds = result.pages.flatMap((page) =>
        page.page.map((doc) => doc._id),
      );
      // Stream pages carry the same installation-scoped IDs as the creates
      // and as native pagination of the same rows.
      expect(pageIds).toEqual(result.ids);
      expect(result.native.page.map((doc) => doc._id)).toEqual(pageIds);
      const own: Ref.Returns<typeof bound.pagination.create> = pageIds[0];
      // @ts-expect-error Stream page IDs belong to this installation, not the definition's scope.
      const definitionScoped: GenericId.GenericId<
        "items",
        typeof definitionScope
      > = pageIds[0];
      // @ts-expect-error …and not to a sibling installation of the same contract.
      const otherId: Ref.Returns<
        typeof other.pagination.streamPage
      >["page"][number]["_id"] = pageIds[0];
      void [own, definitionScoped, otherId];
    }),
  { timeout: 30_000 },
);

it.effect(
  "mixes a host native paginate with component stream pages in one execution",
  () =>
    Effect.gen(function* () {
      const t = convexTest(hostConvexSchema, hostModules);
      register(t);
      yield* Effect.promise(() =>
        t.mutation(components.pagination.pagination.create, { text: "x" }),
      );
      yield* Effect.promise(() =>
        t.mutation((ctx) => ctx.db.insert("notes", { text: "host" })),
      );

      // Under 0.0.60 every nested query gets its own native budget; under
      // 0.0.64 the host query's single native budget is shared with nested
      // calls. Stream pagination bypasses that budget entirely, so this
      // combination works on both: the host native paginate is the
      // execution's only native read, whatever the component does.
      const result = yield* Effect.promise(() =>
        // oxlint-disable-next-line effecttsgo/async-function -- Convex runs inline queries as async functions; the awaits are the backend boundary.
        t.query(async (ctx) => {
          const first = await ctx.runQuery(
            components.pagination.pagination.streamPage,
            { paginationOpts: { numItems: 1, cursor: null } },
          );
          const second = await ctx.runQuery(
            components.pagination.pagination.streamPage,
            {
              paginationOpts: {
                numItems: 1,
                cursor: first.continueCursor,
              },
            },
          );
          const hostPage = await ctx.db
            .query("notes")
            .paginate({ numItems: 1, cursor: null });
          return {
            component: [
              ...first.page.map((doc) => doc.text),
              ...second.page.map((doc) => doc.text),
            ],
            host: hostPage.page.map((doc) => doc.text),
          };
        }),
      );
      expect(result).toEqual({ component: ["x"], host: ["host"] });
    }),
  { timeout: 30_000 },
);
