import { expect, it } from "@effect/vitest";
import {
  ComponentAuthNotSupportedError,
  isCodegenError,
  renderCodegenError,
} from "@confect/cli/CodegenError";
import { SnapshotError } from "@confect/cli/SnapshotError";

it("recognizes and renders structured snapshot failures without dumping their cause", () => {
  const error = new SnapshotError({
    reason: "NoncanonicalPath",
    relativePath: "notes.spec.ts",
    pathSegments: ["other"],
    cause: { detail: "unrendered-cause" },
  });
  expect(isCodegenError(error)).toBe(true);
  const rendered = renderCodegenError(error);
  expect(rendered).toContain(
    "Invalid generation metadata (NoncanonicalPath) for notes.spec.ts at other.",
  );
  expect(rendered).not.toContain("unrendered-cause");
});

it("renders malformed snapshot input without inventing a source location", () => {
  const error = new SnapshotError({
    reason: "InvalidShape",
    relativePath: "",
    pathSegments: [],
  });
  const rendered = renderCodegenError(error);
  expect(rendered).toContain("Invalid generation metadata (InvalidShape).");
  expect(rendered).not.toContain(" for ");
  expect(rendered).not.toContain(" at ");
});

it("renders a component's rejected auth configuration as a component violation", () => {
  const error = new ComponentAuthNotSupportedError({ authPath: "conf/a.ts" });
  expect(isCodegenError(error)).toBe(true);
  const rendered = renderCodegenError(error);
  expect(rendered).toContain("configures application authentication");
  expect(rendered).toContain("a.ts");
  // Not described as a Convex config that failed to evaluate.
  expect(rendered).not.toContain("could not be evaluated");
  expect(rendered).not.toContain("Convex config");
});
