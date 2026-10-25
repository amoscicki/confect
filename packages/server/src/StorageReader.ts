import type * as IdScope from "@confect/core/IdScope";
import type { GenericId } from "@confect/core/GenericId";
import type { StorageReader as ConvexStorageReader } from "convex/server";
import * as Context from "effect/Context";
import { flow, pipe } from "effect/Function";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { BlobNotFoundError } from "./BlobNotFoundError";

/**
 * The reader's shape at a given ID scope. Storage IDs are scoped in the type
 * only: Convex still stores and returns the same ID strings.
 */
export type Service<Scope extends IdScope.IdScope = IdScope.App> = {
  getUrl: (
    storageId: GenericId<"_storage", Scope>,
  ) => ReturnType<ReturnType<typeof make>["getUrl"]>;
};

export const make = (storageReader: ConvexStorageReader) => ({
  getUrl: (storageId: GenericId<"_storage">) =>
    Effect.promise(() => storageReader.getUrl(storageId)).pipe(
      Effect.andThen(
        flow(
          Option.fromNullishOr,
          Option.match({
            onNone: () => Effect.fail(new BlobNotFoundError({ id: storageId })),
            onSome: (doc) =>
              pipe(
                doc,
                Schema.decodeEffect(Schema.URLFromString),
                Effect.catchTag("SchemaError", Effect.die),
              ),
          }),
        ),
      ),
    ),
});

/**
 * The requirement a scoped reader satisfies. A component must not be able to
 * demand (or accept) the application's unscoped reader.
 */
export type ForScope<Scope extends IdScope.IdScope> = Scope extends IdScope.App
  ? StorageReader
  : { readonly "~ScopedStorageReader": Scope };

export class StorageReader extends Context.Service<
  StorageReader,
  ReturnType<typeof make>
>()("@confect/server/StorageReader") {
  static readonly forScope = <
    Scope extends IdScope.IdScope = IdScope.App,
  >(): Context.Service<ForScope<Scope>, Service<Scope>> =>
    Context.Service("@confect/server/StorageReader");

  static readonly layer = <Scope extends IdScope.IdScope = IdScope.App>(
    storageReader: ConvexStorageReader,
    _scope?: Scope,
  ) =>
    Layer.succeed(
      this.forScope<Scope>(),
      make(storageReader) as unknown as Service<Scope>,
    );
}
