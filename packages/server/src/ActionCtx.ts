import type * as IdScope from "@confect/core/IdScope";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as ComponentCtx from "./ComponentCtx";

/**
 * The raw Convex action context. An application handler receives it unchanged;
 * a component handler receives the same ctx with application authentication and
 * every ID-bearing operation (scheduler, storage, vector search) scoped to the
 * component.
 */
export type ActionCtxTag<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Context.Service<
  ActionCtx<DataModel, Scope>,
  Scope extends IdScope.App
    ? GenericActionCtx<DataModel>
    : ComponentCtx.Action<DataModel, Scope>
>;

export const ActionCtx = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
>(): ActionCtxTag<DataModel, Scope> =>
  Context.Service("@confect/server/ActionCtx");

export type ActionCtx<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Scope extends IdScope.App
  ? GenericActionCtx<DataModel>
  : ComponentCtx.Identifier<"action", DataModel, Scope>;

export const layer = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope,
>(
  ctx: GenericActionCtx<DataModel>,
  scope: Scope,
): Layer.Layer<ActionCtx<DataModel, Scope>> => {
  const tag = ActionCtx<DataModel, Scope>();
  const shape = (value: GenericActionCtx<DataModel>) =>
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
  return Layer.succeed(tag, shape(componentCtx as GenericActionCtx<DataModel>));
};
