import { GroupSpec, Spec } from "@confect/core";
import pagination from "../pagination.spec";

const spec: Spec.Spec<{
  readonly pagination: GroupSpec.NamedAt<typeof pagination, "pagination">;
}> = Spec.fromGroups({
  ["pagination"]: pagination,
}) as typeof spec;

export default spec;
