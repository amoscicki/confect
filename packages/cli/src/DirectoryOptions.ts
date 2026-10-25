import * as IdScope from "@confect/core/IdScope";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Flag from "effect/cli/Flag";
import * as ConfectDirectory from "./ConfectDirectory";
import * as ConvexDirectory from "./ConvexDirectory";
import * as ProjectRoot from "./ProjectRoot";

/**
 * `--component-dir <dir>` points codegen at a Convex component definition
 * directory (`<dir>/convex.config.ts`) instead of the application's `convex/`
 * directory found from the working directory. The component's source lives in
 * the sibling `confect/` directory.
 */
export const flags = {
  componentDir: Flag.String("component-dir").pipe(
    Flag.withDescription(
      "Generate a component instead of the application; its sibling confect/ directory contains the source.",
    ),
    Flag.optional,
  ),
};

const ComponentPackageManifest = Schema.fromJsonString(
  Schema.Struct({ name: Schema.String }),
);

/**
 * The component definition's stable identity, `<package name>:<path from the
 * package root to the component's Convex directory>`, e.g.
 * `@acme/counter:src/convex`. Generated IDs and schemas carry it as their ID
 * scope, so every installation of the same component shares an identity.
 */
const componentDefinitionName = Effect.fnUntraced(function* (
  projectRoot: string,
  componentDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { name } = yield* fs
    .readFileString(path.join(projectRoot, "package.json"))
    .pipe(Effect.flatMap(Schema.decodeEffect(ComponentPackageManifest)));
  const relative = path
    .relative(projectRoot, componentDirectory)
    .split(path.sep)
    .join("/");
  return `${name}:${relative}`;
});

/**
 * The directory services codegen and dev read.
 */
export type DirectoryServices =
  | ProjectRoot.ProjectRoot
  | ConfectDirectory.ConfectDirectory
  | ConvexDirectory.ConvexDirectory;

/**
 * `--component-dir` named a directory that exists but holds no component
 * definition. Distinct from {@link ConvexDirectory.ConvexDirectoryNotFoundError}
 * (which means the application's `convex/` directory is missing), so a mistyped
 * flag is reported as what it is.
 */
export class ComponentDefinitionNotFoundError extends Schema.TaggedError<ComponentDefinitionNotFoundError>()(
  "ComponentDefinitionNotFoundError",
  {
    componentDirectory: Schema.String,
    expectedConfigPath: Schema.String,
  },
) {
  override get message(): string {
    return `Could not find a component definition in ${this.componentDirectory} (expected ${this.expectedConfigPath})`;
  }
}

/**
 * Errors raised while resolving the directories.
 */
export type DirectoryError =
  | ComponentDefinitionNotFoundError
  | Layer.Error<typeof ConfectDirectory.layer>
  | Layer.Error<typeof ConvexDirectory.layer>
  | Layer.Error<typeof ProjectRoot.layer>
  | Schema.SchemaError;

/**
 * The directory layers selected by `--component-dir`: the application's
 * directories when the flag is absent, the component's when it is present.
 */
export const layer: (input: {
  readonly componentDir: Option.Option<string>;
}) => Layer.Layer<
  DirectoryServices,
  DirectoryError,
  FileSystem.FileSystem | Path.Path
> = ({ componentDir }) => {
  const projectRootLayer = Option.match(componentDir, {
    onNone: () => ProjectRoot.layer,
    onSome: (directory) =>
      Layer.effect(
        ProjectRoot.ProjectRoot,
        Effect.map(ProjectRoot.findProjectRootFrom(directory), (root) =>
          ProjectRoot.ProjectRoot.of({
            get: Effect.succeed(root),
          }),
        ),
      ),
  });
  const convex: Layer.Layer<
    ConvexDirectory.ConvexDirectory,
    | ComponentDefinitionNotFoundError
    | Layer.Error<typeof ConvexDirectory.layer>
    | Schema.SchemaError,
    FileSystem.FileSystem | Path.Path
  > = Option.match(componentDir, {
    onNone: () => ConvexDirectory.layer,
    onSome: (directory) =>
      Layer.effect(
        ConvexDirectory.ConvexDirectory,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* ProjectRoot.ProjectRoot.get;
          const absolute = path.resolve(directory);
          const configPath = path.join(absolute, "convex.config.ts");
          if (!(yield* fs.exists(configPath))) {
            return yield* new ComponentDefinitionNotFoundError({
              componentDirectory: absolute,
              expectedConfigPath: configPath,
            });
          }
          // The definition name identifies this component everywhere it is
          // installed: `<package name>:<path to its convex directory>`.
          const definition = yield* componentDefinitionName(
            projectRoot,
            absolute,
          );
          return ConvexDirectory.ConvexDirectory.of({
            get: Effect.succeed(absolute),
            target: {
              kind: "component",
              scope: IdScope.component(definition),
            },
          });
        }),
      ).pipe(Layer.provide(projectRootLayer)),
  });
  return Layer.mergeAll(
    projectRootLayer,
    convex,
    ConfectDirectory.layerFromConvexDirectory.pipe(Layer.provideMerge(convex)),
  );
};

/**
 * Resolve the directory services for one run.
 *
 * `--component-dir` always selects the component's directories. Without it,
 * services the caller already provides are kept (a test harness, or an
 * application embedding the command); only when none are present does the
 * command fall back to the application's directories found from the working
 * directory. Resolving at run time keeps `--component-dir` usable from a
 * directory that is not itself a Convex app.
 */
export const provide =
  (input: { readonly componentDir: Option.Option<string> }) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E | DirectoryError,
    Exclude<R, DirectoryServices> | FileSystem.FileSystem | Path.Path
  > =>
    Effect.flatMap(
      Option.isSome(input.componentDir)
        ? Effect.succeed(Option.none<Context.Context<DirectoryServices>>())
        : providedDirectoryServices,
      (
        provided,
      ): Effect.Effect<
        A,
        E | DirectoryError,
        Exclude<R, DirectoryServices> | FileSystem.FileSystem | Path.Path
      > =>
        // Both branches end with the directories in context; only where that
        // context comes from differs.
        Option.match(provided, {
          onNone: () => Effect.provide(self, layer(input)),
          onSome: (context) => Effect.provideContext(self, context),
        }),
    );

/**
 * The directory services already in context, when a caller (a test harness, or
 * an application embedding the command) provides all three. Resolving this at
 * run time rather than declaring the directories as requirements is what lets
 * `provide` accept a command that reads the directories either way.
 */
const providedDirectoryServices: Effect.Effect<
  Option.Option<Context.Context<DirectoryServices>>
> = Effect.gen(function* () {
  const projectRoot = yield* Effect.serviceOption(ProjectRoot.ProjectRoot);
  const confectDirectory = yield* Effect.serviceOption(
    ConfectDirectory.ConfectDirectory,
  );
  const convexDirectory = yield* Effect.serviceOption(
    ConvexDirectory.ConvexDirectory,
  );
  return Option.all([
    projectRoot,
    confectDirectory,
    convexDirectory,
  ] as const).pipe(
    Option.map(([root, confect, convex]) =>
      Context.empty().pipe(
        Context.add(ProjectRoot.ProjectRoot, root),
        Context.add(ConfectDirectory.ConfectDirectory, confect),
        Context.add(ConvexDirectory.ConvexDirectory, convex),
      ),
    ),
  );
});
