import type * as IdScope from "@confect/core/IdScope";
import type { GenericId } from "@confect/core/GenericId";
import type { StorageActionWriter as ConvexStorageActionWriter } from "convex/server";
import * as Context from "effect/Context";
import { flow } from "effect/Function";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { BlobNotFoundError } from "./BlobNotFoundError";

/**
 * The action writer's shape at a given ID scope. Storage IDs are scoped in the
 * type only: Convex still stores and returns the same ID strings.
 */
export type Service<Scope extends IdScope.IdScope = IdScope.App> = {
  get: (
    storageId: GenericId<"_storage", Scope>,
  ) => ReturnType<ReturnType<typeof make>["get"]>;
  store: (
    blob: Blob,
    options?: { sha256?: string },
  ) => Effect.Effect<GenericId<"_storage", Scope>>;
};

export const make = (storageActionWriter: ConvexStorageActionWriter) => ({
  get: (storageId: GenericId<"_storage">) =>
    Effect.promise(() => storageActionWriter.get(storageId)).pipe(
      Effect.andThen(
        flow(
          Option.fromNullishOr,
          Option.match({
            onNone: () => Effect.fail(new BlobNotFoundError({ id: storageId })),
            onSome: Effect.succeed,
          }),
        ),
      ),
    ),
  store: (blob: Blob, options?: { sha256?: string }) =>
    Effect.promise(() => storageActionWriter.store(blob, options)),
});

/**
 * The requirement a scoped action writer satisfies. A component must not be
 * able to demand (or accept) the application's unscoped writer.
 */
export type ForScope<Scope extends IdScope.IdScope> = Scope extends IdScope.App
  ? StorageActionWriter
  : { readonly "~ScopedStorageActionWriter": Scope };

export class StorageActionWriter extends Context.Service<
  StorageActionWriter,
  ReturnType<typeof make>
>()("@confect/server/StorageActionWriter") {
  static readonly forScope = <
    Scope extends IdScope.IdScope = IdScope.App,
  >(): Context.Service<ForScope<Scope>, Service<Scope>> =>
    Context.Service("@confect/server/StorageActionWriter");

  static readonly layer = <Scope extends IdScope.IdScope = IdScope.App>(
    storageActionWriter: ConvexStorageActionWriter,
    _scope?: Scope,
  ) =>
    Layer.succeed(
      this.forScope<Scope>(),
      make(storageActionWriter) as unknown as Service<Scope>,
    );
}
