import {
  Component,
  FunctionSpec,
  GenericId,
  GroupSpec,
  IdScope,
  Spec,
} from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * The contract a component package publishes next to its vanilla Convex
 * sources: the component's public functions with decoded types and scoped IDs,
 * so a Confect consumer can bind an installation of it with `Component.bind`.
 *
 * The implementation in `convex/` stays plain Convex; only the types below
 * describe the wire boundary.
 */
export const scope = IdScope.component("@confect-test/fixtures:counter");

export const CounterId = GenericId.GenericId("counters", scope);

export const Rejected = Schema.TaggedStruct("Rejected", { id: CounterId });

const CounterDoc = Schema.Struct({
  _id: CounterId,
  _creationTime: Schema.Finite,
  count: Schema.Finite,
});

const counter = GroupSpec.make()
  .addFunction(
    FunctionSpec.publicMutation({
      name: "create",
      args: () => ({ count: Schema.Finite }),
      returns: () => CounterId,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "get",
      args: () => ({ id: CounterId }),
      returns: () => Schema.NullOr(CounterDoc),
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "reject",
      error: () => Rejected,
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "list",
      returns: () => Schema.Array(CounterDoc),
    }),
  );

export type CounterSpec = Spec.Spec<{
  readonly counter: GroupSpec.NamedAt<typeof counter, "counter">;
}>;

const spec: CounterSpec = Spec.fromGroups({ counter }) as CounterSpec;

export const contract = Component.make(spec, scope, ["counters"]);

/**
 * The `ComponentApi` shape Convex generates for an installed component with
 * this contract, keyed by mount name.
 */
export type CounterApi<Name extends string> = Component.Api<CounterSpec, Name>;
