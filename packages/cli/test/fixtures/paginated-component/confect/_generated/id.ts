import { GenericId, IdScope } from "@confect/core";
import type { SystemTableNames } from "convex/server";

export const scope = IdScope.component("@confect-fixtures/paginated-component:convex");
export const target = { kind: "component", scope } as const;

export type TableNames = "items";

export type Id<TableName extends TableNames | SystemTableNames> = GenericId.GenericId<TableName, typeof scope>;

export const Id = <const TableName extends TableNames | SystemTableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName, scope);
