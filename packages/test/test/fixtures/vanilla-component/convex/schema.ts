import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// A hand-written vanilla Convex component: no Confect codegen involved, so
// `@confect/test` exercises the same inputs a third-party component ships.
export default defineSchema({
  counters: defineTable({ count: v.number() }),
});
