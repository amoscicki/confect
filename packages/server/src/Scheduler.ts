import type * as IdScope from "@confect/core/IdScope";
import { Ref } from "@confect/core";
import type { GenericId } from "@confect/core/GenericId";
import type { Scheduler as ConvexScheduler } from "convex/server";
import type { GenericId as ConvexGenericId } from "convex/values";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Left unannotated so the application tag keeps printing the concrete scheduler
// shape it always has; `Service<IdScope.App>` is structurally identical.
const make = (scheduler: ConvexScheduler) => ({
  cancel: (id: ConvexGenericId<"_scheduled_functions">) =>
    Effect.promise(() => scheduler.cancel(id)),
  runAfter: <Ref_ extends Ref.AnyMutation | Ref.AnyAction>(
    delay: Duration.Duration,
    ref: Ref_,
    ...args: Ref.OptionalArgs<Ref_>
  ) => {
    const delayMs = Duration.toMillis(delay);
    const functionReference = Ref.getFunctionReference(ref);
    const encodedArgs = Ref.encodeArgsSync(
      ref,
      (args[0] ?? {}) as Ref.Args<Ref_>,
    );

    return Effect.promise(() =>
      scheduler.runAfter(delayMs, functionReference, encodedArgs),
    );
  },
  runAt: <Ref_ extends Ref.AnyMutation | Ref.AnyAction>(
    dateTime: DateTime.DateTime,
    ref: Ref_,
    ...args: Ref.OptionalArgs<Ref_>
  ) => {
    const timestamp = DateTime.toEpochMillis(dateTime);
    const functionReference = Ref.getFunctionReference(ref);
    const encodedArgs = Ref.encodeArgsSync(
      ref,
      (args[0] ?? {}) as Ref.Args<Ref_>,
    );

    return Effect.promise(() =>
      scheduler.runAt(timestamp, functionReference, encodedArgs),
    );
  },
});

export const Scheduler = Context.Service<ReturnType<typeof make>>(
  "@confect/server/Scheduler",
);
export type Scheduler = typeof Scheduler.Identifier;

/**
 * The scheduler's shape at a given ID scope: scheduled-function IDs it returns
 * (and cancels) belong to the same namespace as the rest of the handler's IDs.
 *
 * Members are function-valued properties rather than methods so the shape stays
 * structurally identical to the plain object {@link make} builds, which is what
 * application handlers already see.
 */
export interface Service<Scope extends IdScope.IdScope = IdScope.App> {
  readonly cancel: (
    id: GenericId<"_scheduled_functions", Scope>,
  ) => Effect.Effect<void>;
  readonly runAfter: <Ref_ extends Ref.AnyMutation | Ref.AnyAction>(
    delay: Duration.Duration,
    ref: Ref_,
    ...args: Ref.OptionalArgs<Ref_>
  ) => Effect.Effect<GenericId<"_scheduled_functions", Scope>>;
  readonly runAt: <Ref_ extends Ref.AnyMutation | Ref.AnyAction>(
    dateTime: DateTime.DateTime,
    ref: Ref_,
    ...args: Ref.OptionalArgs<Ref_>
  ) => Effect.Effect<GenericId<"_scheduled_functions", Scope>>;
}

/**
 * The requirement a scoped scheduler satisfies. A component must not be able to
 * demand (or accept) the application's unscoped scheduler.
 */
export type ForScope<Scope extends IdScope.IdScope> = Scope extends IdScope.App
  ? Scheduler
  : { readonly "~ScopedScheduler": Scope };

export const forScope = <
  Scope extends IdScope.IdScope = IdScope.App,
>(): Context.Service<ForScope<Scope>, Service<Scope>> =>
  Context.Service("@confect/server/Scheduler");

export const layer = <Scope extends IdScope.IdScope = IdScope.App>(
  scheduler: ConvexScheduler,
  _scope?: Scope,
) =>
  // Scopes are phantom: Convex still receives and returns the same ID strings.
  Layer.succeed(
    forScope<Scope>(),
    make(scheduler) as unknown as Service<Scope>,
  );
