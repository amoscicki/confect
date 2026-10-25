import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import items from "./tables/items";

import { target as $target } from "./id";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly items: typeof items;
}, typeof $target> = $DatabaseSchema.make({
  items,
}, $target);

export default databaseSchema;
