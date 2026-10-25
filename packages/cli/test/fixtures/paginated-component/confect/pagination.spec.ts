import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Id } from "./_generated/id";
import items from "./_generated/tables/items";

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.publicMutation({
      name: "create",
      args: () => ({ text: Schema.String }),
      returns: () => Id("items"),
    }),
  )
  .addFunction(
    FunctionSpec.publicPaginatedQuery({
      name: "list",
      item: () => items.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.publicPaginatedQuery({
      name: "streamPage",
      item: () => items.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "paginateTwice",
      args: () => ({ numItems: Schema.Finite }),
      returns: () => Schema.Boolean,
    }),
  );
