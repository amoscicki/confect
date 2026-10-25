import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";

// The component's public API, written with vanilla Convex builders: nothing
// here depends on Confect, matching how third-party components ship.
export const create = mutationGeneric({
  args: { count: v.number() },
  handler: (ctx, { count }) => ctx.db.insert("counters", { count }),
});

export const get = queryGeneric({
  args: { id: v.id("counters") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const list = queryGeneric({
  args: {},
  handler: (ctx) => ctx.db.query("counters").collect(),
});

/**
 * Fails with a `ConvexError` the way a published component reports a declared
 * error. The row inserted before the throw must not survive the function.
 */
export const reject = mutationGeneric({
  args: {},
  handler: (ctx) =>
    ctx.db.insert("counters", { count: 999 }).then((id) => {
      throw new ConvexError({ _tag: "Rejected", id });
    }),
});
