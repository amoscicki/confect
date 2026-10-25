import * as DatabaseSchema from "@confect/server/DatabaseSchema";
import * as Table from "@confect/server/Table";
import * as IdScope from "@confect/core/IdScope";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

describe("DatabaseSchema", () => {
  it("stores the precise table record without evaluating table schemas", () => {
    let evaluated = 0;
    const notes = Table.make(() => {
      evaluated++;
      return Schema.Struct({ text: Schema.String });
    })("notes");
    const users = Table.make(() => {
      evaluated++;
      return Schema.Struct({ name: Schema.String });
    })("users");
    const input = { notes, users };
    const schema = DatabaseSchema.make(input);
    expect(DatabaseSchema.isDatabaseSchema(schema)).toBe(true);
    expect(DatabaseSchema.tables(schema)).toBe(input);
    expect(evaluated).toBe(0);
    expectTypeOf(DatabaseSchema.tables(schema).notes).toEqualTypeOf<
      typeof notes
    >();
    expectTypeOf<DatabaseSchema.Tables<typeof schema>>().toEqualTypeOf<
      typeof notes | typeof users
    >();
    expectTypeOf<DatabaseSchema.TableNames<typeof schema>>().toEqualTypeOf<
      "notes" | "users"
    >();
    expectTypeOf<
      DatabaseSchema.TableWithName<typeof schema, "notes">
    >().toEqualTypeOf<typeof notes>();
    expectTypeOf<"~Tables">().not.toExtend<keyof typeof schema>();
  });

  it("represents an empty schema with no table members", () => {
    const schema = DatabaseSchema.make({});
    expect(DatabaseSchema.tables(schema)).toEqual({});
    expectTypeOf<DatabaseSchema.Tables<typeof schema>>().toBeNever();
    expectTypeOf<DatabaseSchema.TableNames<typeof schema>>().toBeNever();
  });

  it("retains component scope alongside the precise lazy table record", () => {
    const scope = IdScope.component("counter");
    const target = { kind: "component", scope } as const;
    let evaluated = 0;
    const counters = Table.make(() => {
      evaluated++;
      return Schema.Struct({ count: Schema.Finite });
    })("counters", scope);
    const input = { counters };
    const schema = DatabaseSchema.make(input, target);

    expect(DatabaseSchema.tables(schema)).toBe(input);
    expect(schema.target).toBe(target);
    expect(evaluated).toBe(0);
    expectTypeOf(DatabaseSchema.tables(schema).counters).toEqualTypeOf<
      typeof counters
    >();
    expectTypeOf<DatabaseSchema.Scope<typeof schema>>().toEqualTypeOf<
      typeof scope
    >();
    expectTypeOf<DatabaseSchema.Tables<typeof schema>>().toEqualTypeOf<
      typeof counters
    >();
    expectTypeOf<"~Tables">().not.toExtend<keyof typeof schema>();
  });

  it("reports an empty component scope with a tagged error", () => {
    expect(() =>
      DatabaseSchema.make(
        {},
        {
          kind: "component",
          scope: IdScope.app,
        },
      ),
    ).toThrow(
      expect.objectContaining<
        Partial<DatabaseSchema.InvalidComponentScopeError>
      >({
        _tag: "InvalidComponentScopeError",
        scope: IdScope.app,
      }),
    );
  });

  it("reports a table bound to another scope with a tagged error", () => {
    const scope = IdScope.component("counter");
    const otherScope = IdScope.component("other");
    const counters = Table.make(() => Schema.Struct({ count: Schema.Finite }))(
      "counters",
      otherScope,
    );
    expect(() =>
      DatabaseSchema.make({ counters }, { kind: "component", scope }),
    ).toThrow(
      expect.objectContaining<
        Partial<DatabaseSchema.InvalidDatabaseSchemaTableError>
      >({
        _tag: "InvalidDatabaseSchemaTableError",
        name: "counters",
        tableName: "counters",
        scope: otherScope,
        expectedScope: scope,
      }),
    );
  });

  it("reports a table keyed under another name with a tagged error", () => {
    const counters = Table.make(() => Schema.Struct({ count: Schema.Finite }))(
      "counters",
    );
    expect(() => DatabaseSchema.make({ notes: counters })).toThrow(
      expect.objectContaining<
        Partial<DatabaseSchema.InvalidDatabaseSchemaTableError>
      >({
        _tag: "InvalidDatabaseSchemaTableError",
        name: "notes",
        tableName: "counters",
      }),
    );
  });
});
