import type * as IdScope from "@confect/core/IdScope";
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as ComponentCtx from "./ComponentCtx";

/**
 * The raw Convex mutation context. An application handler receives it
 * unchanged; a component handler receives the same ctx with application
 * authentication and every ID-bearing operation (database, scheduler, storage)
 * scoped to the component.
 */
export type MutationCtxTag<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Context.Service<
  MutationCtx<DataModel, Scope>,
  Scope extends IdScope.App
    ? GenericMutationCtx<DataModel>
    : ComponentCtx.Mutation<DataModel, Scope>
>;

export const MutationCtx = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
>(): MutationCtxTag<DataModel, Scope> =>
  Context.Service("@confect/server/MutationCtx");

export type MutationCtx<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Scope extends IdScope.App
  ? GenericMutationCtx<DataModel>
  : ComponentCtx.Identifier<"mutation", DataModel, Scope>;

export const layer = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope,
>(
  ctx: GenericMutationCtx<DataModel>,
  scope: Scope,
): Layer.Layer<MutationCtx<DataModel, Scope>> => {
  const tag = MutationCtx<DataModel, Scope>();
  const shape = (value: GenericMutationCtx<DataModel>) =>
    value as unknown as Context.Service.Shape<typeof tag>;
  // The application scope's identity is the empty string.
  if (scope === "") {
    return Layer.succeed(tag, shape(ctx));
  }
  // Only component contexts strip application authentication; the application
  // receives its ctx object untouched (and uncopied). Convex's context is a
  // plain object whose members are own enumerable properties, so the spread
  // copies every member a component handler can use while dropping `auth`.
  const { auth: _auth, ...componentCtx } = ctx;
  return Layer.succeed(
    tag,
    shape(componentCtx as GenericMutationCtx<DataModel>),
  );
};
