import { Ref } from "@confect/core";
import type { DatabaseSchema, DataModel } from "@confect/server";
import { RegisteredConvexFunction } from "@confect/server";
import type {
  TestConvexForDataModel,
  TestConvexForDataModelAndIdentity,
} from "convex-test";
import { convexTest } from "convex-test";
import type {
  GenericMutationCtx,
  GenericSchema,
  SchemaDefinition,
  UserIdentity,
} from "convex/server";
import type { Value } from "convex/values";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export type TestConfectWithoutIdentity<
  ConfectSchema extends DatabaseSchema.AnyWithProps,
> = {
  query: <QueryRef extends Ref.AnyQuery>(
    queryRef: QueryRef,
    ...args: Ref.OptionalArgs<QueryRef>
  ) => Effect.Effect<
    Ref.Returns<QueryRef>,
    Ref.Error<QueryRef> | Schema.SchemaError
  >;
  mutation: <MutationRef extends Ref.AnyMutation>(
    mutationRef: MutationRef,
    ...args: Ref.OptionalArgs<MutationRef>
  ) => Effect.Effect<
    Ref.Returns<MutationRef>,
    Ref.Error<MutationRef> | Schema.SchemaError
  >;
  action: <ActionRef extends Ref.AnyAction>(
    actionRef: ActionRef,
    ...args: Ref.OptionalArgs<ActionRef>
  ) => Effect.Effect<
    Ref.Returns<ActionRef>,
    Ref.Error<ActionRef> | Schema.SchemaError
  >;
  run: {
    <E>(
      handler: Effect.Effect<
        void,
        E,
        RegisteredConvexFunction.MutationServices<ConfectSchema>
      >,
    ): Effect.Effect<void>;
    <A, B extends Value, E>(
      handler: Effect.Effect<
        A,
        E,
        RegisteredConvexFunction.MutationServices<ConfectSchema>
      >,
      returns: Schema.Codec<A, B>,
    ): Effect.Effect<A, Schema.SchemaError>;
  };
  fetch: (
    pathQueryFragment: string,
    init?: RequestInit,
  ) => Effect.Effect<Response>;
  finishInProgressScheduledFunctions: () => Effect.Effect<void>;
  finishAllScheduledFunctions: (
    advanceTimers: () => void,
  ) => Effect.Effect<void>;
};

export type TestConfect<ConfectSchema extends DatabaseSchema.AnyWithProps> = {
  /**
   * Register an installed component so the host's functions can call it, or so
   * it can be addressed directly through a bound component contract.
   *
   * `componentPath` must match the path the component is installed at. Each
   * call replaces any registration at the same path with a fresh database, so
   * documents written to that installation are lost; register the same
   * definition at distinct paths to test installation isolation.
   */
  registerComponent: (
    componentPath: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: Record<string, () => Promise<any>>,
  ) => Effect.Effect<void>;
  withIdentity: (
    userIdentity: Partial<UserIdentity>,
  ) => TestConfectWithoutIdentity<ConfectSchema>;
} & TestConfectWithoutIdentity<ConfectSchema>;

export const TestConfect = <
  ConfectSchema extends DatabaseSchema.AnyWithProps,
>() => Context.Service<TestConfect<ConfectSchema>>("@confect/test/TestConfect");

class TestConfectImplWithoutIdentity<
  ConfectSchema extends DatabaseSchema.AnyWithProps,
> implements TestConfectWithoutIdentity<ConfectSchema> {
  constructor(
    private confectSchema: ConfectSchema,
    private testConvex: TestConvexForDataModel<
      DataModel.ToConvex<DataModel.FromSchema<ConfectSchema>>
    >,
  ) {}

  readonly query = <QueryRef extends Ref.AnyQuery>(
    queryRef: QueryRef,
    ...args: Ref.OptionalArgs<QueryRef>
  ): Effect.Effect<
    Ref.Returns<QueryRef>,
    Ref.Error<QueryRef> | Schema.SchemaError
  > =>
    Ref.runWithCodec(
      queryRef,
      (args[0] ?? {}) as Ref.Args<QueryRef>,
      (functionReference, encodedArgs) =>
        this.testConvex.query(functionReference as any, encodedArgs),
    );

  readonly mutation = <MutationRef extends Ref.AnyMutation>(
    mutationRef: MutationRef,
    ...args: Ref.OptionalArgs<MutationRef>
  ): Effect.Effect<
    Ref.Returns<MutationRef>,
    Ref.Error<MutationRef> | Schema.SchemaError
  > =>
    Ref.runWithCodec(
      mutationRef,
      (args[0] ?? {}) as Ref.Args<MutationRef>,
      (functionReference, encodedArgs) =>
        this.testConvex.mutation(functionReference as any, encodedArgs),
    );

  readonly action = <ActionRef extends Ref.AnyAction>(
    actionRef: ActionRef,
    ...args: Ref.OptionalArgs<ActionRef>
  ): Effect.Effect<
    Ref.Returns<ActionRef>,
    Ref.Error<ActionRef> | Schema.SchemaError
  > =>
    Ref.runWithCodec(
      actionRef,
      (args[0] ?? {}) as Ref.Args<ActionRef>,
      (functionReference, encodedArgs) =>
        this.testConvex.action(functionReference as any, encodedArgs),
    );

  readonly run: TestConfectWithoutIdentity<ConfectSchema>["run"] = (<
    A,
    B extends Value,
    E,
  >(
    handler: Effect.Effect<
      A,
      E,
      RegisteredConvexFunction.MutationServices<ConfectSchema>
    >,
    returns?: Schema.Codec<A, B>,
  ): Effect.Effect<void> | Effect.Effect<A, Schema.SchemaError> => {
    const makeMutationLayer = (
      mutationCtx: GenericMutationCtx<
        DataModel.ToConvex<DataModel.FromSchema<ConfectSchema>>
      >,
    ): Layer.Layer<RegisteredConvexFunction.MutationServices<ConfectSchema>> =>
      RegisteredConvexFunction.mutationLayer(
        this.confectSchema,
        mutationCtx,
      ) as Layer.Layer<
        RegisteredConvexFunction.MutationServices<ConfectSchema>
      >;

    return returns === undefined
      ? Effect.promise(() =>
          this.testConvex.run((mutationCtx) =>
            Effect.runPromise(
              handler.pipe(
                Effect.asVoid,
                Effect.provide(makeMutationLayer(mutationCtx)),
              ),
            ),
          ),
        )
      : Effect.promise(() =>
          this.testConvex.run((mutationCtx) =>
            Effect.runPromise(
              handler.pipe(
                Effect.andThen(Schema.encodeEffect(returns)),
                Effect.provide(makeMutationLayer(mutationCtx)),
              ),
            ),
          ),
        ).pipe(Effect.andThen(Schema.decodeEffect(returns)));
  }) as TestConfectWithoutIdentity<ConfectSchema>["run"];

  readonly fetch = <PathQueryFragment extends string>(
    pathQueryFragment: PathQueryFragment,
    init?: RequestInit,
  ) => Effect.promise(() => this.testConvex.fetch(pathQueryFragment, init));

  readonly finishInProgressScheduledFunctions = () =>
    Effect.promise(() => this.testConvex.finishInProgressScheduledFunctions());

  readonly finishAllScheduledFunctions = (advanceTimers: () => void) =>
    Effect.promise(() =>
      this.testConvex.finishAllScheduledFunctions(advanceTimers),
    );
}

class TestConfectImpl<
  ConfectSchema extends DatabaseSchema.AnyWithProps,
> implements TestConfect<ConfectSchema> {
  private readonly testConfectImplWithoutIdentity: TestConfectImplWithoutIdentity<ConfectSchema>;

  constructor(
    private confectSchema: ConfectSchema,
    private testConvex: TestConvexForDataModelAndIdentity<
      DataModel.ToConvex<DataModel.FromSchema<ConfectSchema>>
    >,
  ) {
    this.testConfectImplWithoutIdentity = new TestConfectImplWithoutIdentity(
      confectSchema,
      testConvex,
    );
  }

  readonly withIdentity = (userIdentity: Partial<UserIdentity>) =>
    new TestConfectImplWithoutIdentity(
      this.confectSchema,
      this.testConvex.withIdentity(userIdentity),
    );

  readonly registerComponent: TestConfect<ConfectSchema>["registerComponent"] =
    Effect.fn("TestConfect.registerComponent")(
      (componentPath, schema, modules) =>
        Effect.sync(() =>
          this.testConvex.registerComponent(componentPath, schema, modules),
        ),
    );

  readonly query = <QueryRef extends Ref.AnyQuery>(
    queryRef: QueryRef,
    ...args: Ref.OptionalArgs<QueryRef>
  ) => this.testConfectImplWithoutIdentity.query(queryRef, ...args);

  readonly mutation = <MutationRef extends Ref.AnyMutation>(
    mutationRef: MutationRef,
    ...args: Ref.OptionalArgs<MutationRef>
  ) => this.testConfectImplWithoutIdentity.mutation(mutationRef, ...args);

  readonly action = <ActionRef extends Ref.AnyAction>(
    actionRef: ActionRef,
    ...args: Ref.OptionalArgs<ActionRef>
  ) => this.testConfectImplWithoutIdentity.action(actionRef, ...args);

  readonly run: TestConfect<ConfectSchema>["run"] = ((
    handler: any,
    returns?: any,
  ) =>
    this.testConfectImplWithoutIdentity.run(
      handler,
      returns,
    )) as TestConfect<ConfectSchema>["run"];

  readonly fetch = <PathQueryFragment extends string>(
    pathQueryFragment: PathQueryFragment,
    init?: RequestInit,
  ) => this.testConfectImplWithoutIdentity.fetch(pathQueryFragment, init);

  readonly finishInProgressScheduledFunctions = () =>
    this.testConfectImplWithoutIdentity.finishInProgressScheduledFunctions();

  readonly finishAllScheduledFunctions = (advanceTimers: () => void) =>
    this.testConfectImplWithoutIdentity.finishAllScheduledFunctions(
      advanceTimers,
    );
}

const makeLayer = <DatabaseSchema_ extends DatabaseSchema.AnyWithProps>(
  databaseSchema: DatabaseSchema_,
  makeInstance: () => TestConvexForDataModelAndIdentity<
    DataModel.ToConvex<DataModel.FromSchema<DatabaseSchema_>>
  >,
): Layer.Layer<TestConfect<DatabaseSchema_>> =>
  Layer.sync(
    TestConfect<DatabaseSchema_>(),
    () => new TestConfectImpl(databaseSchema, makeInstance()),
  );

/**
 * Build a `TestConfect` layer for a caller-supplied `convexTest` instance.
 *
 * Use this when the test needs to prepare the instance before Confect sees it,
 * e.g. to call a component package's own `register(t)` helper (which calls
 * `t.registerComponent`) so its components are installed.
 *
 * The supplied instance—its database and every component registered on it—is
 * shared and never reset: constructing the layer again wraps the same instance,
 * so state written through one layer is visible through the next. Build the
 * instance once per `describe` block and provide the layer per test; use
 * {@link layer} when each test needs its own database.
 *
 * @remarks
 *   The pairing between `databaseSchema` and `instance` is only partly checked
 *   by the type system: an instance built from a different, non-assignable
 *   deployment schema is rejected, but an instance type widened to an empty or
 *   structurally compatible schema is accepted. `databaseSchema` must therefore
 *   describe the deployment schema the instance was constructed from, or
 *   results are decoded against the wrong schema.
 */
export const layerFromInstance = <
  DatabaseSchema_ extends DatabaseSchema.AnyWithProps,
>(
  databaseSchema: DatabaseSchema_,
  instance: TestConvexForDataModelAndIdentity<
    DataModel.ToConvex<DataModel.FromSchema<DatabaseSchema_>>
  >,
): Layer.Layer<TestConfect<DatabaseSchema_>> =>
  makeLayer(databaseSchema, () => instance);

/**
 * Build a `TestConfect` layer around a fresh `convexTest` instance created from
 * the given deployment schema and function modules.
 */
export const layer = <DatabaseSchema_ extends DatabaseSchema.AnyWithProps>(
  databaseSchema: DatabaseSchema_,
  convexSchemaDefinition: SchemaDefinition<GenericSchema, true>,
  modules: Record<string, () => Promise<any>>,
): Layer.Layer<TestConfect<DatabaseSchema_>> =>
  makeLayer(
    databaseSchema,
    () => convexTest(convexSchemaDefinition, modules) as any,
  );
