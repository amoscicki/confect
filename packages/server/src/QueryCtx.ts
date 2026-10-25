import type * as IdScope from "@confect/core/IdScope";
import type { GenericDataModel, GenericQueryCtx } from "convex/server";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as ComponentCtx from "./ComponentCtx";

/**
 * The raw Convex query context. An application handler receives it unchanged; a
 * component handler receives the same ctx with application authentication and
 * every ID-bearing operation scoped to the component.
 */
export type QueryCtxTag<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Context.Service<
  QueryCtx<DataModel, Scope>,
  Scope extends IdScope.App
    ? GenericQueryCtx<DataModel>
    : ComponentCtx.Query<DataModel, Scope>
>;

export const QueryCtx = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
>(): QueryCtxTag<DataModel, Scope> =>
  Context.Service("@confect/server/QueryCtx");

export type QueryCtx<
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope = IdScope.App,
> = Scope extends IdScope.App
  ? GenericQueryCtx<DataModel>
  : ComponentCtx.Identifier<"query", DataModel, Scope>;

export const layer = <
  DataModel extends GenericDataModel,
  Scope extends IdScope.IdScope,
>(
  ctx: GenericQueryCtx<DataModel>,
  scope: Scope,
): Layer.Layer<QueryCtx<DataModel, Scope>> => {
  const tag = QueryCtx<DataModel, Scope>();
  const shape = (value: GenericQueryCtx<DataModel>) =>
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
  return Layer.succeed(tag, shape(componentCtx as GenericQueryCtx<DataModel>));
};
