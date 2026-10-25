import { IdScope, Table } from "@confect/core";
import { describe, expect, it } from "@effect/vitest";
import { assertEquals } from "@effect/vitest/utils";
import {
  ActionCtx,
  DatabaseSchema,
  HttpRouter as ConfectHttpRouter,
} from "@confect/server";
import type { DataModel } from "@confect/server";
import * as Storage from "@confect/server/Storage";
import { StorageReader } from "@confect/server/StorageReader";
import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import type { HttpRouter as ConvexHttpRouter } from "convex/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { vi } from "vitest";
import { DatabaseWriter } from "./fixtures/confect/_generated/services";
import { Id } from "./fixtures/confect/_generated/id";
import appSchema from "./fixtures/confect/_generated/schema";
import { NotesApi } from "./fixtures/confect/http";
import * as TestConfect from "./TestConfect";
import convexSchema from "./fixtures/confect/_generated/convexSchema";

// A component schema owned by a different installation than the fixtures' app.
// The table only gives the schema a shape; the routes below touch no database.
const componentScope = IdScope.component("@example/counter");
const componentUsers = Table.make(() => Schema.Struct({ name: Schema.String }))(
  "users",
  componentScope,
);
const componentSchema = DatabaseSchema.make(
  { users: componentUsers },
  { kind: "component", scope: componentScope },
);
type ComponentModel = DataModel.ToConvex<
  DataModel.FromSchema<typeof componentSchema>
>;

// Reads the raw component action context, which the schema-derived layer strips
// of application `auth`.
const componentRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/health",
    Effect.gen(function* () {
      const ctx = yield* ActionCtx.ActionCtx<
        ComponentModel,
        typeof componentScope
      >();
      return HttpServerResponse.text(
        Predicate.hasProperty(ctx, "auth")
          ? "unexpected-auth"
          : "component-ready",
      );
    }),
  ),
  HttpRouter.add(
    "POST",
    "/echo",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return HttpServerResponse.text(yield* request.text);
    }),
  ),
);

describe("HttpRouter", () => {
  it.effect(
    "provides unified storage and both writer capabilities to HTTP handlers",
    () =>
      Effect.gen(function* () {
        const http = ConfectHttpRouter.make(
          HttpRouter.add(
            "GET",
            "/storage",
            Effect.gen(function* () {
              const storage = yield* Storage.Storage;
              const legacy = yield* StorageReader;
              expect(yield* storage.generateUploadUrl).toBeInstanceOf(URL);
              const id = yield* storage.store(new Blob(["HTTP storage"]));
              expect((yield* storage.getUrl(id)).href).toBe(
                (yield* legacy.getUrl(id)).href,
              );
              const blob = yield* storage.get(id);
              const contents = yield* Effect.promise(() => blob.text());
              yield* storage.delete(id);
              expect((yield* Effect.flip(storage.get(id))).id).toBe(id);
              return HttpServerResponse.text(contents);
            }).pipe(Effect.orDie),
          ),
        );
        const t = convexTest(convexSchema, {
          ...import.meta.glob("./fixtures/convex/_generated/*.js"),
          "./fixtures/convex/http.ts": () => Promise.resolve({ default: http }),
        });
        const response = yield* Effect.promise(() => t.fetch("/storage"));
        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.text())).toBe(
          "HTTP storage",
        );
      }),
  );

  it.effect(
    "uses each request's console and respects route logger overrides",
    () =>
      Effect.gen(function* () {
        const c = yield* TestConfect.TestConfect;
        const original = globalThis.console;
        const first = { ...original, warn: vi.fn(), log: vi.fn() };
        const second = { ...original, warn: vi.fn(), log: vi.fn() };
        yield* Effect.gen(function* () {
          globalThis.console = first;
          expect((yield* c.fetch("/logging")).status).toBe(200);
          globalThis.console = second;
          expect((yield* c.fetch("/logging")).status).toBe(200);
          expect((yield* c.fetch("/logging/disabled")).status).toBe(200);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              globalThis.console = original;
            }),
          ),
        );
        for (const console of [first, second]) {
          expect(console.warn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ level: "WARN", message: "HTTP request" }),
          );
          expect(console.log).not.toHaveBeenCalled();
        }
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "serves an HttpApi endpoint whose handler uses a Confect service",
    () =>
      Effect.gen(function* () {
        const c = yield* TestConfect.TestConfect;

        const text = "Hello, HTTP!";

        yield* c.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;

            return yield* writer.table("notes").insert({ text });
          }),
          Id("notes"),
        );

        const response = yield* c.fetch("/api/notes");
        assertEquals(response.status, 200);

        const body = (yield* Effect.promise(() => response.json())) as Array<{
          text: string;
        }>;
        assertEquals(body.length, 1);
        assertEquals(body[0]?.text, text);
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("serves a second HttpApi merged onto the same router", () =>
    Effect.gen(function* () {
      const c = yield* TestConfect.TestConfect;

      const response = yield* c.fetch("/meta/ping");
      assertEquals(response.status, 200);
      assertEquals(yield* Effect.promise(() => response.json()), "pong");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("serves a plain HttpRouter.add route", () =>
    Effect.gen(function* () {
      const c = yield* TestConfect.TestConfect;

      const response = yield* c.fetch("/health");
      assertEquals(response.status, 200);
      assertEquals(yield* Effect.promise(() => response.text()), "OK");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("global middleware modifies responses", () =>
    Effect.gen(function* () {
      const c = yield* TestConfect.TestConfect;

      const response = yield* c.fetch("/health");
      assertEquals(response.headers.get("x-confect-middleware"), "applied");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("serves the Scalar docs page", () =>
    Effect.gen(function* () {
      const c = yield* TestConfect.TestConfect;

      const response = yield* c.fetch("/api/docs");
      assertEquals(response.status, 200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "a plain Convex route on the returned router shadows the catch-all",
    () =>
      Effect.gen(function* () {
        const c = yield* TestConfect.TestConfect;

        const response = yield* c.fetch("/convex-native");
        assertEquals(response.status, 200);
        assertEquals(yield* Effect.promise(() => response.text()), "native");
        // The Effect router (and so its global middleware) never ran.
        assertEquals(response.headers.get("x-confect-middleware"), null);
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("unmatched paths get the Effect router's 404", () =>
    Effect.gen(function* () {
      const c = yield* TestConfect.TestConfect;

      const response = yield* c.fetch("/no-such-route");
      assertEquals(response.status, 404);
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});

describe("HttpRouter.forSchema", () => {
  // oxlint-disable effecttsgo/process-env-in-effect, effecttsgo/process-env -- Convex injects CONVEX_SITE_URL per environment; standing in for several installations means manipulating the real environment around each router build. Keep this file out of any suite that reads CONVEX_SITE_URL concurrently: the mutation is process-global, not fiber-scoped.
  const withSiteUrl = <A, E, R>(
    siteUrl: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env["CONVEX_SITE_URL"];
        process.env["CONVEX_SITE_URL"] = siteUrl;
        return () => {
          if (previous === undefined) {
            delete process.env["CONVEX_SITE_URL"];
          } else {
            process.env["CONVEX_SITE_URL"] = previous;
          }
        };
      }),
      () => effect,
      (restore) => Effect.sync(restore),
    );

  // The environment must be left exactly as found after every block, so a
  // leaked value cannot steer a later case.
  const siteUrl = (): string | undefined => process.env["CONVEX_SITE_URL"];
  // oxlint-enable effecttsgo/process-env-in-effect, effecttsgo/process-env

  // Convex gives every installation of a component its own environment, with
  // `CONVEX_SITE_URL` carrying that installation's full mount prefix and its
  // own copy of the component's `http` module. Building one router per prefix
  // and registering them as separate components of a single deployment
  // reproduces that layout, including a child mounted under a parent.
  const mounts = ["first", "second", "left/child", "right/child"] as const;
  type Mount = (typeof mounts)[number];

  const buildInstallations = (): Record<Mount, ConvexHttpRouter> =>
    Object.fromEntries(
      mounts.map((mount) => {
        let router: ConvexHttpRouter | undefined;
        Effect.runSync(
          withSiteUrl(
            `https://some.convex.site/${mount}`,
            Effect.sync(() => {
              router =
                ConfectHttpRouter.forSchema(componentSchema)(componentRoutes);
            }),
          ).pipe(Effect.scoped),
        );
        if (router === undefined) {
          throw new Error(`Failed to build the ${mount} installation.`);
        }
        return [mount, router];
      }),
    ) as Record<Mount, ConvexHttpRouter>;

  interface Reply {
    readonly status: number;
    readonly body: string;
  }

  // `runInComponent` runs a body as if it were that installation's module, so
  // `t.fetch` resolves that component's own `http` router and request context.
  // Its result crosses Convex's serialization boundary, so read the response
  // inside the body. `convex-test` implements `runInComponent` but leaves it
  // off `TestConvex`'s public type.
  const inComponent = (
    t: ReturnType<typeof convexTest>,
    mount: Mount,
    path: string,
    init?: RequestInit,
  ): Promise<Reply> =>
    (
      t as unknown as {
        runInComponent: (
          path: string,
          f: () => Promise<Reply>,
        ) => Promise<Reply>;
      }
    ).runInComponent(mount, () =>
      t
        .fetch(path, init)
        .then((response) =>
          response.text().then((body) => ({ status: response.status, body })),
        ),
    );

  const deployment = (routers: Record<Mount, ConvexHttpRouter>) => {
    const t = convexTest(convexSchema, {
      ...import.meta.glob("./fixtures/convex/_generated/*.js"),
    });
    for (const mount of mounts) {
      t.registerComponent(mount, defineSchema({}), {
        "./convex/_generated/api.js": () => Promise.resolve({}),
        "./convex/http.ts": () => Promise.resolve({ default: routers[mount] }),
      });
    }
    return t;
  };

  it.effect(
    "serves each installation's routes under its own mount prefix only",
    () =>
      Effect.gen(function* () {
        const before = siteUrl();
        const installations = buildInstallations();
        assertEquals(siteUrl(), before);

        const t = deployment(installations);
        const request = (mount: Mount, path: string, init?: RequestInit) =>
          Effect.promise(() => inComponent(t, mount, path, init));

        for (const mount of mounts) {
          // Component contexts are stripped of application `auth`, so the same
          // route module reports `component-ready` in every installation.
          const health = yield* request(mount, `/${mount}/health`);
          assertEquals(health.status, 200);
          assertEquals(health.body, "component-ready");

          const echo = yield* request(mount, `/${mount}/echo`, {
            method: "POST",
            body: `body for ${mount}`,
          });
          assertEquals(echo.status, 200);
          assertEquals(echo.body, `body for ${mount}`);

          // Every other installation's prefix—including the parent segment of
          // a nested mount—falls through to the Effect router's 404.
          for (const other of mounts) {
            if (other === mount) continue;
            assertEquals(
              (yield* request(mount, `/${other}/health`)).status,
              404,
            );
            assertEquals(
              (yield* request(mount, `/${other}/echo`, {
                method: "POST",
                body: "not mine",
              })).status,
              404,
            );
          }

          assertEquals(
            (yield* request(mount, `/${mount}/missing`)).status,
            404,
          );
        }
      }),
  );

  it.effect("leaves an application schema's routes unprefixed", () =>
    Effect.gen(function* () {
      const http = ConfectHttpRouter.forSchema(appSchema)(
        HttpRouter.add("GET", "/health", HttpServerResponse.text("app-ready")),
      );
      const t = convexTest(convexSchema, {
        ...import.meta.glob("./fixtures/convex/_generated/*.js"),
        "./fixtures/convex/http.ts": () => Promise.resolve({ default: http }),
      });
      const response = yield* Effect.promise(() => t.fetch("/health"));
      assertEquals(response.status, 200);
      assertEquals(yield* Effect.promise(() => response.text()), "app-ready");
      assertEquals(
        (yield* Effect.promise(() => t.fetch("/first/health"))).status,
        404,
      );
    }),
  );

  it.effect(
    "reports a missing or invalid CONVEX_SITE_URL as a diagnosable defect",
    () =>
      Effect.gen(function* () {
        const before = siteUrl();
        for (const value of ["", "not a url"]) {
          yield* withSiteUrl(
            value,
            Effect.gen(function* () {
              const router =
                ConfectHttpRouter.forSchema(componentSchema)(componentRoutes);
              const t = convexTest(convexSchema, {
                ...import.meta.glob("./fixtures/convex/_generated/*.js"),
                "./fixtures/convex/http.ts": () =>
                  Promise.resolve({ default: router }),
              });
              // The router still builds; the failure surfaces as the
              // rejection of the first request that reaches it.
              const message = yield* Effect.promise(() =>
                t.fetch("/first/health").then(
                  () => "",
                  (error: unknown) => String(error),
                ),
              );
              expect(message).toContain("CONVEX_SITE_URL");
              expect(message).toContain("component:@example/counter");
            }),
          ).pipe(Effect.scoped);
          assertEquals(siteUrl(), before);
        }
      }),
  );
});

describe("HttpRouter.make type-level guarantees", () => {
  it("rejects a routes layer whose group handlers are not provided", () => {
    // HttpApiBuilder.layer(NotesApi) still requires the NotesApi group handler
    // services; without Layer.provide(NotesApiLive) the layer does not satisfy
    // Routes.
    const _missingGroupLayerIsRejected = () =>
      // @ts-expect-error
      // @effect-diagnostics-next-line missingLayerContext:off
      ConfectHttpRouter.make(HttpApiBuilder.layer(NotesApi));

    expect(_missingGroupLayerIsRejected).toBeDefined();
  });
});
