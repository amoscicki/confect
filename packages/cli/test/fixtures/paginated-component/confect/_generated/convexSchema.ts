import { defineSchema as $defineSchema } from "convex/server";
import { Table as $Table } from "@confect/server";

import items from "./tables/items";

export default $defineSchema({
  items: $Table.tableDefinition(items),
});
