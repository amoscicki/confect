import * as RegisteredFunction from "@confect/server/RegisteredFunction";
import { DatabaseSchema } from "@confect/server";
import type { DataModel } from "@confect/server";
import { describe, expect, it } from "@effect/vitest";
import type { GenericActionCtx } from "convex/server";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as TestConsole from "effect/testing/TestConsole";
import { vi } from "vitest";

describe("runHandlerPromise", () => {
  it.effect("keeps the captured console across overlapping invocations", () =>
    Effect.gen(function* () {
      const original = globalThis.console;
      const first = { ...original, info: vi.fn() };
      const second = { ...original, info: vi.fn() };
      const release = yield* Deferred.make<void>();
      const run = RegisteredFunction.runHandlerPromise(undefined);
      yield* Effect.promise(() => {
        globalThis.console = first;
        const firstResult = run(
          Deferred.await(release).pipe(Effect.andThen(Effect.log("first"))),
        );
        globalThis.console = second;
        const secondResult = run(Effect.log("second")).finally(() =>
          Deferred.doneUnsafe(release, Effect.void),
        );
        return Promise.all([firstResult, secondResult]).finally(() => {
          globalThis.console = original;
        });
      });
      expect(first.info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "first" }),
      );
      expect(second.info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "second" }),
      );
    }),
  );

  it.effect(
    "binds each invocation's console even after Effect caches a default",
    () =>
      Effect.gen(function* () {
        const original = globalThis.console;
        Context.get(Context.empty(), Console.Console);
        const first = { ...original, info: vi.fn(), log: vi.fn() };
        const second = { ...original, info: vi.fn(), log: vi.fn() };
        const run = RegisteredFunction.runHandlerPromise(undefined);
        yield* Effect.promise(() => {
          globalThis.console = first;
          return run(Effect.log("first"))
            .then(() => {
              globalThis.console = second;
              return run(Effect.log("second"));
            })
            .finally(() => {
              globalThis.console = original;
            });
        });
        expect(first.info).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message: "first" }),
        );
        expect(second.info).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message: "second" }),
        );
        expect(first.log).not.toHaveBeenCalled();
        expect(second.log).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "keeps Info filtering and tracer logging while allowing handler overrides",
    () =>
      Effect.gen(function* () {
        const console = {
          ...(yield* TestConsole.make),
          debug: vi.fn(),
          info: vi.fn(),
        };
        const run = RegisteredFunction.runHandlerPromise(undefined);
        const loggers = yield* Effect.promise(() =>
          run(
            Effect.gen(function* () {
              yield* Effect.logTrace("hidden trace");
              yield* Effect.logDebug("hidden debug");
              yield* Effect.logInfo("visible");
              expect(yield* References.MinimumLogLevel).toBe("Info");
              return yield* Logger.CurrentLoggers;
            }).pipe(Effect.provideService(Console.Console, console)),
          ),
        );
        expect(loggers.has(Logger.tracerLogger)).toBe(true);
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message: "visible" }),
        );

        const custom = vi.fn();
        yield* Effect.promise(() =>
          run(
            Effect.logInfo("custom").pipe(
              Effect.provideService(
                Logger.CurrentLoggers,
                new Set([Logger.make(custom)]),
              ),
              Effect.provideService(Console.Console, console),
            ),
          ),
        );
        expect(custom).toHaveBeenCalledOnce();
        expect(console.info).toHaveBeenCalledOnce();
      }),
  );
});

describe("action context layers", () => {
  // Both entry points build their ctx-backed services from one builder, so the
  // only tag that may differ between them is the schema-typed `VectorSearch`.
  it.effect("provide the same ctx-backed services for an app schema", () =>
    Effect.gen(function* () {
      const appSchema = DatabaseSchema.make({});
      type AppModel = DataModel.ToConvex<
        DataModel.FromSchema<typeof appSchema>
      >;
      const ctx = {
        auth: {},
        scheduler: {},
        storage: {},
        meta: {
          getFunctionMetadata: () => Promise.resolve(null),
          getDeploymentMetadata: () => Promise.resolve(null),
          getRequestMetadata: () => Promise.resolve(null),
        },
        runQuery: () => Promise.resolve(null),
        runMutation: () => Promise.resolve(null),
        runAction: () => Promise.resolve(null),
        vectorSearch: () => Promise.resolve([]),
      } as unknown as GenericActionCtx<AppModel>;

      const base = yield* Layer.build(RegisteredFunction.baseActionLayer(ctx));
      const schemaLayer = yield* Layer.build(
        RegisteredFunction.actionLayer(appSchema, ctx),
      );
      const tags = (context: Context.Context<never>) =>
        Array.from(context.mapUnsafe.keys()).sort();

      expect(tags(base)).toEqual(
        tags(schemaLayer).filter(
          (tag) => tag !== "@confect/server/VectorSearch",
        ),
      );
    }).pipe(Effect.scoped),
  );
});
