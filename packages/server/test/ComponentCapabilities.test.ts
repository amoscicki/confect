import {
  FunctionSpec,
  GenericId,
  GroupSpec,
  IdScope,
  Table,
} from "@confect/core";
import {
  Auth,
  DatabaseReader,
  DatabaseSchema,
  DatabaseWriter,
  FunctionImpl,
  HttpRouter,
  MutationCtx,
  QueryCtx,
  RegisteredConvexFunction,
  StorageReader,
  Scheduler,
} from "@confect/server";
import type {
  DataModel,
  Handler,
  Document,
  QueryInitializer,
  BlobNotFoundError,
} from "@confect/server";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
  Scheduler as ConvexScheduler,
} from "convex/server";
import { makeFunctionReference } from "convex/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Router from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { vi } from "vitest";

const scope = IdScope.component("@example/counter");
const users = Table.make(() => Schema.Struct({ name: Schema.String }))(
  "users",
  scope,
);
const databaseSchema = DatabaseSchema.make(
  { users },
  { kind: "component", scope },
);
type Database = typeof databaseSchema;
type Model = DataModel.ToConvex<DataModel.FromSchema<Database>>;
const group = GroupSpec.make().addFunction(
  FunctionSpec.publicMutation({
    name: "create",
    args: () => ({}),
    returns: () => Schema.Null,
  }),
);

describe("component capabilities", () => {
  it("keeps the implementation builder while rejecting app authentication", () => {
    const auth = Effect.gen(function* () {
      yield* Auth.Auth;
      return null;
    });
    // @ts-expect-error Component handlers are not provided application Auth.
    FunctionImpl.make(databaseSchema, group, "create", () => auth);
    const rawApp = Effect.gen(function* () {
      yield* MutationCtx.MutationCtx<Model>();
      return null;
    });
    // @ts-expect-error An unscoped raw app context cannot bypass component capabilities.
    FunctionImpl.make(databaseSchema, group, "create", () => rawApp);
    FunctionImpl.make(databaseSchema, group, "create", () =>
      Effect.succeed(null),
    );
    const appScheduler = Effect.gen(function* () {
      yield* Scheduler.Scheduler;
      return null;
    });
    // @ts-expect-error A component cannot acquire root-scoped scheduled-function IDs.
    FunctionImpl.make(databaseSchema, group, "create", () => appScheduler);
  });

  it("scopes database and raw-context IDs", () => {
    const program: Effect.Effect<
      void,
      | Document.DocumentDecodeError
      | Document.DocumentEncodeError
      | QueryInitializer.GetByIdFailure
      | BlobNotFoundError.BlobNotFoundError
      | Schema.SchemaError,
      Handler.MutationServices<Database>
    > = Effect.gen(function* () {
      const writer = yield* DatabaseWriter.DatabaseWriter<Database>();
      const reader = yield* DatabaseReader.DatabaseReader<Database>();
      const id = yield* writer.table("users").insert({ name: "Ada" });
      yield* reader.table("users").get(id);
      const appId = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("users"),
      )("app-id");
      // @ts-expect-error The host's users table is a different table.
      yield* reader.table("users").get(appId);
      // @ts-expect-error Writes must also reject a foreign ID.
      yield* writer.table("users").delete(appId);
      const raw = yield* MutationCtx.MutationCtx<Model, typeof scope>();
      // @ts-expect-error Component raw contexts don't expose auth.
      void raw.auth;
      yield* Effect.promise(() => raw.db.get("users", id));
      // @ts-expect-error Raw database operations preserve the same ID boundary.
      yield* Effect.promise(() => raw.db.get("users", appId));
      const scheduled = yield* Effect.promise(() =>
        raw.scheduler.runAfter(
          100,
          makeFunctionReference<"mutation", {}>("counter:tick"),
          {},
        ),
      );
      const scoped: GenericId.GenericId<"_scheduled_functions", typeof scope> =
        scheduled;
      void scoped;
      // @ts-expect-error Raw scheduling returns an ID in the component's system table.
      const rootScheduled: GenericId.GenericId<"_scheduled_functions"> =
        scheduled;
      void rootScheduled;
      const storage =
        yield* StorageReader.StorageReader.forScope<typeof scope>();
      const storageId = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("_storage", scope),
      )("file");
      yield* storage.getUrl(storageId);
      const appStorageId = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("_storage"),
      )("file");
      // @ts-expect-error File storage is scoped too.
      yield* storage.getUrl(appStorageId);
      const scheduler = yield* Scheduler.forScope<typeof scope>();
      yield* scheduler.cancel(scheduled);
      const appScheduledId = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("_scheduled_functions"),
      )("scheduled");
      // @ts-expect-error A component cancels only its own scheduled functions.
      yield* scheduler.cancel(appScheduledId);
    });
    void program;
  });

  it("exposes cancellation in the component's scheduler scope", () => {
    const appScheduler = Effect.gen(function* () {
      const scheduler = yield* Scheduler.Scheduler;
      return (id: GenericId.GenericId<"_scheduled_functions">) =>
        scheduler.cancel(id);
    });
    expectTypeOf<Effect.Success<typeof appScheduler>>().toEqualTypeOf<
      (id: GenericId.GenericId<"_scheduled_functions">) => Effect.Effect<void>
    >();

    const program = Effect.gen(function* () {
      const scheduler = yield* Scheduler.forScope<typeof scope>();
      expectTypeOf(scheduler).toEqualTypeOf<Scheduler.Service<typeof scope>>();
      const id = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("_scheduled_functions", scope),
      )("scheduled");
      const cancellation = scheduler.cancel(id);
      expectTypeOf(cancellation).toEqualTypeOf<Effect.Effect<void>>();
      const appId = yield* Schema.decodeUnknownEffect(
        GenericId.GenericId("_scheduled_functions"),
      )("scheduled");
      // @ts-expect-error Component scheduling cannot cancel host functions.
      yield* scheduler.cancel(appId);
    });
    void program;
  });

  it.effect("cancels scheduled functions through the component layer", () => {
    const scheduledFunctionId =
      "scheduled" as GenericId.GenericId<"_scheduled_functions">;
    const cancel = vi.fn(() => Promise.resolve());
    const convexScheduler = {
      runAfter: () => Promise.resolve(scheduledFunctionId),
      runAt: () => Promise.resolve(scheduledFunctionId),
      cancel,
    } satisfies ConvexScheduler;
    return Effect.gen(function* () {
      const scheduler = yield* Scheduler.forScope<typeof scope>();
      yield* scheduler.cancel(
        scheduledFunctionId as unknown as GenericId.GenericId<
          "_scheduled_functions",
          typeof scope
        >,
      );
      expect(cancel).toHaveBeenCalledExactlyOnceWith(scheduledFunctionId);
      expect(cancel.mock.contexts[0]).toBe(convexScheduler);
    }).pipe(Effect.provide(Scheduler.layer(convexScheduler, scope)));
  });

  it.effect(
    "omits authentication from the runtime query layer and raw context",
    () => {
      // Only ctx construction is faked here; no database row is read. The
      // spies show that a component's `_storage` reads route through Convex's
      // system reader, i.e. the component-scoped system tables are resolved.
      const systemGet = vi.fn(() => Promise.resolve(null));
      const appGet = vi.fn(() => Promise.resolve(null));
      const ctx = {
        auth: {},
        db: {
          get: appGet,
          query: () => ({ withIndex: () => ({ unique: () => null }) }),
          system: {
            get: systemGet,
            query: () => ({ withIndex: () => ({ unique: () => null }) }),
          },
        },
        storage: {},
        runQuery: () => Promise.resolve(null),
        meta: {
          getFunctionMetadata: () => Promise.resolve(null),
          getDeploymentMetadata: () => Promise.resolve(null),
          getTransactionMetrics: () => Promise.resolve(null),
          getRequestMetadata: () => Promise.resolve(null),
        },
      } as unknown as GenericQueryCtx<Model>;
      return Effect.gen(function* () {
        const context = yield* Layer.build(
          RegisteredConvexFunction.queryLayer(databaseSchema, ctx),
        );
        expect(Option.isNone(Context.getOption(context, Auth.Auth))).toBe(true);
        const raw = Context.get(
          context,
          QueryCtx.QueryCtx<Model, typeof scope>(),
        );
        expect(Object.hasOwn(raw, "auth")).toBe(false);
        const reader = Context.get(
          context,
          DatabaseReader.DatabaseReader<typeof databaseSchema>(),
        );
        const storageId = yield* Schema.decodeUnknownEffect(
          GenericId.GenericId("_storage", scope),
        )("file");
        const result = yield* Effect.result(
          reader.table("_storage").get(storageId),
        );
        expect(result._tag).toBe("Failure");
        expect(systemGet).toHaveBeenCalledExactlyOnceWith("file");
        expect(appGet).not.toHaveBeenCalled();
      }).pipe(Effect.scoped);
    },
  );

  it("derives HTTP handler capabilities from the same schema", () => {
    const withAuth = Router.add(
      "GET",
      "/",
      Auth.Auth.pipe(Effect.as(HttpServerResponse.text("OK"))),
    );
    // @ts-expect-error Component HTTP handlers also cannot require application Auth.
    HttpRouter.forSchema(databaseSchema)(withAuth);
    HttpRouter.forSchema(databaseSchema)(
      Router.add("GET", "/", HttpServerResponse.text("OK")),
    );
    const withAppStorage = Router.add(
      "GET",
      "/",
      Effect.gen(function* () {
        yield* StorageReader.StorageReader;
        return HttpServerResponse.text("OK");
      }),
    );
    // @ts-expect-error Component HTTP handlers read scoped, not application, storage.
    HttpRouter.forSchema(databaseSchema)(withAppStorage);
  });

  it.effect(
    "omits authentication from the runtime layer and raw context",
    () => {
      // Only ctx construction is faked here; no database or storage method is called.
      const ctx = {
        auth: {},
        db: {},
        scheduler: {},
        storage: {},
        runQuery: () => Promise.resolve(null),
        runMutation: () => Promise.resolve(null),
      } as unknown as GenericMutationCtx<Model>;
      return Effect.gen(function* () {
        const context = yield* Layer.build(
          RegisteredConvexFunction.mutationLayer(databaseSchema, ctx),
        );
        expect(Option.isNone(Context.getOption(context, Auth.Auth))).toBe(true);
        const raw = Context.get(
          context,
          MutationCtx.MutationCtx<Model, typeof scope>(),
        );
        expect(Object.hasOwn(raw, "auth")).toBe(false);
      }).pipe(Effect.scoped);
    },
  );
});
