import type * as IdScope from "@confect/core/IdScope";
import type { GenericId } from "@confect/core/GenericId";
import type { StorageReader as ConvexStorageReader } from "convex/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { BlobNotFoundError } from "./BlobNotFoundError";
import * as StorageActionWriter from "./StorageActionWriter";
import * as StorageReader from "./StorageReader";
import * as StorageWriter from "./StorageWriter";

/**
 * The unified storage facade at a given ID scope. Storage IDs are scoped in the
 * type only: Convex still stores and returns the same ID strings.
 */
export type Service<Scope extends IdScope.IdScope = IdScope.App> = {
  readonly getUrl: (
    storageId: GenericId<"_storage", Scope>,
  ) => Effect.Effect<URL, BlobNotFoundError>;
  readonly generateUploadUrl: Effect.Effect<
    URL,
    never,
    StorageWriter.ForScope<Scope>
  >;
  readonly delete: (
    storageId: GenericId<"_storage", Scope>,
  ) => Effect.Effect<void, BlobNotFoundError, StorageWriter.ForScope<Scope>>;
  readonly get: (
    storageId: GenericId<"_storage", Scope>,
  ) => Effect.Effect<
    Blob,
    BlobNotFoundError,
    StorageActionWriter.ForScope<Scope>
  >;
  readonly store: (
    blob: Blob,
    options?: { sha256?: string },
  ) => Effect.Effect<
    GenericId<"_storage", Scope>,
    never,
    StorageActionWriter.ForScope<Scope>
  >;
};

/**
 * The requirement a scoped facade satisfies. A component must not be able to
 * demand (or accept) the application's unscoped facade.
 */
export type ForScope<Scope extends IdScope.IdScope> = Scope extends IdScope.App
  ? Storage
  : { readonly "~ScopedStorage": Scope };

const make = <Scope extends IdScope.IdScope>(
  reader: StorageReader.Service<Scope>,
): Service<Scope> => ({
  getUrl: reader.getUrl,
  generateUploadUrl: Effect.flatMap(
    StorageWriter.StorageWriter.forScope<Scope>(),
    (writer) => writer.generateUploadUrl,
  ),
  delete: (storageId: GenericId<"_storage", Scope>) =>
    Effect.flatMap(StorageWriter.StorageWriter.forScope<Scope>(), (writer) =>
      writer.delete(storageId),
    ),
  get: (storageId: GenericId<"_storage", Scope>) =>
    Effect.flatMap(
      StorageActionWriter.StorageActionWriter.forScope<Scope>(),
      (writer) => writer.get(storageId),
    ),
  store: (blob: Blob, options?: { sha256?: string }) =>
    Effect.flatMap(
      StorageActionWriter.StorageActionWriter.forScope<Scope>(),
      (writer) => writer.store(blob, options),
    ),
});

export class Storage extends Context.Service<Storage, Service<IdScope.App>>()(
  "@confect/server/Storage",
) {}

/**
 * The storage facade tag at a given ID scope. Tags are keyed at runtime by
 * their string, so scoping changes only the static shape.
 */
export const forScope = <
  Scope extends IdScope.IdScope = IdScope.App,
>(): Context.Service<ForScope<Scope>, Service<Scope>> =>
  Context.Service("@confect/server/Storage");

export const layer = <Scope extends IdScope.IdScope = IdScope.App>(
  storageReader: ConvexStorageReader,
  scope?: Scope,
): Layer.Layer<ForScope<Scope> | StorageReader.ForScope<Scope>> =>
  Layer.effect(
    forScope<Scope>(),
    Effect.map(StorageReader.StorageReader.forScope<Scope>(), (reader) =>
      make(reader),
    ),
  ).pipe(
    Layer.provideMerge(StorageReader.StorageReader.layer(storageReader, scope)),
  ) as Layer.Layer<ForScope<Scope> | StorageReader.ForScope<Scope>>;
