import type * as IdScope from "@confect/core/IdScope";
import type { GenericId } from "@confect/core/GenericId";
import type { StorageWriter as ConvexStorageWriter } from "convex/server";
import * as Context from "effect/Context";
import { pipe } from "effect/Function";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { BlobNotFoundError } from "./BlobNotFoundError";

/**
 * The writer's shape at a given ID scope. Storage IDs are scoped in the type
 * only: Convex still stores and returns the same ID strings.
 */
export type Service<Scope extends IdScope.IdScope = IdScope.App> = {
  generateUploadUrl: ReturnType<typeof make>["generateUploadUrl"];
  delete: (
    storageId: GenericId<"_storage", Scope>,
  ) => ReturnType<ReturnType<typeof make>["delete"]>;
};

export const make = (storageWriter: ConvexStorageWriter) => ({
  generateUploadUrl: Effect.promise(() =>
    storageWriter.generateUploadUrl(),
  ).pipe(
    Effect.andThen((url) =>
      pipe(
        url,
        Schema.decodeEffect(Schema.URLFromString),
        Effect.catchTag("SchemaError", Effect.die),
      ),
    ),
  ),
  delete: (storageId: GenericId<"_storage">) =>
    Effect.tryPromise({
      try: () => storageWriter.delete(storageId),
      catch: () => new BlobNotFoundError({ id: storageId }),
    }),
});

/**
 * The requirement a scoped writer satisfies. A component must not be able to
 * demand (or accept) the application's unscoped writer.
 */
export type ForScope<Scope extends IdScope.IdScope> = Scope extends IdScope.App
  ? StorageWriter
  : { readonly "~ScopedStorageWriter": Scope };

export class StorageWriter extends Context.Service<
  StorageWriter,
  ReturnType<typeof make>
>()("@confect/server/StorageWriter") {
  static readonly forScope = <
    Scope extends IdScope.IdScope = IdScope.App,
  >(): Context.Service<ForScope<Scope>, Service<Scope>> =>
    Context.Service("@confect/server/StorageWriter");

  static readonly layer = <Scope extends IdScope.IdScope = IdScope.App>(
    storageWriter: ConvexStorageWriter,
    _scope?: Scope,
  ) =>
    Layer.succeed(
      this.forScope<Scope>(),
      make(storageWriter) as unknown as Service<Scope>,
    );
}
