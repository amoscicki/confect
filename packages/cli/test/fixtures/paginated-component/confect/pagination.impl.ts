import { FunctionImpl, GroupImpl, QueryStream } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import schema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter } from "./_generated/services";
import pagination from "./pagination.spec";

const create = FunctionImpl.make(schema, pagination, "create", ({ text }) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer.table("items").insert({ text });
  }).pipe(Effect.orDie),
);

const list = FunctionImpl.make(
  schema,
  pagination,
  "list",
  ({ paginationOpts }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      return yield* reader
        .table("items")
        .index("by_creation_time")
        .paginate(paginationOpts);
    }).pipe(Effect.orDie),
);

// The stream-first alternative: `QueryStream.paginate` reads through the
// index query stream instead of the native `.paginate()`, so its cursors do not
// consume the backend's native pagination budget. This is the supported way to
// walk several pages from inside a component.
const streamPage = FunctionImpl.make(
  schema,
  pagination,
  "streamPage",
  ({ paginationOpts }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      return yield* reader
        .table("items")
        .stream("by_creation_time")
        .pipe(QueryStream.paginate(paginationOpts));
    }).pipe(Effect.orDie),
);

// Deliberately exceeds the backend's per-execution pagination budget: the
// second `.paginate()` in one query execution is what the mock must reject.
// Each call builds its own query, since a Convex query object can only be
// chained once.
const paginateTwice = FunctionImpl.make(
  schema,
  pagination,
  "paginateTwice",
  ({ numItems }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const first = yield* reader
        .table("items")
        .index("by_creation_time")
        .paginate({ numItems, cursor: null });
      yield* reader
        .table("items")
        .index("by_creation_time")
        .paginate({ numItems, cursor: first.continueCursor });
      return first.isDone;
    }).pipe(Effect.orDie),
);

export default GroupImpl.make(schema, pagination).pipe(
  Layer.provide([create, list, streamPage, paginateTwice]),
  GroupImpl.finalize,
);
