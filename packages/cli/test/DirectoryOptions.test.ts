import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ConfectDirectory } from "@confect/cli/ConfectDirectory";
import { ConvexDirectory } from "@confect/cli/ConvexDirectory";
import * as IdScope from "@confect/core/IdScope";
import * as DirectoryOptions from "@confect/cli/DirectoryOptions";
import { ProjectRoot } from "@confect/cli/ProjectRoot";

const directories = Effect.gen(function* () {
  const projectRoot = yield* ProjectRoot.get;
  const convexDirectory = yield* ConvexDirectory.get;
  const confectDirectory = yield* ConfectDirectory.get;
  const target = yield* ConvexDirectory.target;
  return { projectRoot, convexDirectory, confectDirectory, target };
});

it.effect(
  "keeps directories the caller provides instead of resolving its own",
  () =>
    Effect.gen(function* () {
      const provided = DirectoryOptions.provide({
        componentDir: Option.none(),
      })(directories);
      // Neither branch may leave a directory requirement behind.
      expectTypeOf<Effect.Services<typeof provided>>().toEqualTypeOf<
        FileSystem.FileSystem | Path.Path
      >();
      const result = yield* provided.pipe(
        Effect.provideService(
          ProjectRoot,
          ProjectRoot.of({ get: Effect.succeed("/caller/project") }),
        ),
        Effect.provideService(
          ConvexDirectory,
          ConvexDirectory.of({
            get: Effect.succeed("/caller/project/convex"),
          }),
        ),
        Effect.provideService(
          ConfectDirectory,
          ConfectDirectory.of({
            get: Effect.succeed("/caller/project/confect"),
          }),
        ),
      );
      expect(result).toEqual({
        projectRoot: "/caller/project",
        convexDirectory: "/caller/project/convex",
        confectDirectory: "/caller/project/confect",
        target: { kind: "app", scope: IdScope.app },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  { timeout: 30_000 },
);

it.effect(
  "resolves a component's directories and definition scope from --component-dir",
  () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      // Build the expectations with the same path service, so the assertion
      // holds on Windows too (`import.meta.dirname` uses native separators,
      // while string concatenation would mix in forward slashes).
      const fixture = path.join(
        import.meta.dirname,
        "fixtures/authored-component",
      );
      const result = yield* DirectoryOptions.provide({
        componentDir: Option.some(path.join(fixture, "convex")),
      })(directories).pipe(Effect.provide(NodeServices.layer));
      expect(result).toEqual({
        projectRoot: path.resolve(fixture),
        convexDirectory: path.join(fixture, "convex"),
        confectDirectory: path.join(fixture, "confect"),
        target: {
          kind: "component",
          scope: "component:@confect-fixtures/counter:convex",
        },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 30_000 },
);

it.effect(
  "fails with a tagged error when --component-dir holds no component definition",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const scratchRoot = `${import.meta.dirname}/../node_modules/.cache`;
      yield* fs.makeDirectory(scratchRoot, { recursive: true });
      const directory = yield* fs.makeTempDirectoryScoped({
        directory: scratchRoot,
        prefix: "no-component-definition-",
      });
      yield* fs.writeFileString(path.join(directory, "package.json"), "{}\n");
      const result = yield* Effect.result(
        DirectoryOptions.provide({
          componentDir: Option.some(path.join(directory, "convex")),
        })(directories),
      );
      assert(Result.isFailure(result));
      expect(result.failure).toMatchObject({
        _tag: "ComponentDefinitionNotFoundError",
        expectedConfigPath: path.join(directory, "convex", "convex.config.ts"),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 30_000 },
);
