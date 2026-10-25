---
"@confect/core": minor
"@confect/server": minor
"@confect/cli": minor
"@confect/test": minor
---

Support Confect-authored Convex components.

Author a component by running `confect codegen --component-dir <convex dir>` (and `confect dev --component-dir`) instead of application codegen. Generated code scopes the component's IDs, tables, and handler services to its own database, derives the component's definition scope from its package name and Convex directory path, and publishes a contract with `Component.make` that installers bind with `Component.bind`. Component codegen rejects a `confect/auth.ts`: only application handlers can require the application `Auth` service, so pass the identity a component needs through function arguments.

A component's generated database schema carries a component target, so its handlers receive scoped `Scheduler`, storage, database, and raw-context services and no application authentication. `DatabaseSchema.make` reports component misconfigurations with tagged errors, `HttpRouter.forSchema` derives HTTP handler capabilities and the mount prefix from the schema (component routes are relative to the installation's `CONVEX_SITE_URL` path), and component node actions compile their validators in the component's ID scope.

Bound references keep the component's decoded types: callers get decoded arguments, results, and declared errors, while vanilla Convex consumers keep using encoded values on the wire. IDs from different installations of the same component are distinct types; use `Component.id` and `Component.schema` to reference them from application schemas, and `Ref.fromFunctionReference` to adapt a native component reference without a Confect contract. `TestConfect.registerComponent` installs an installed component so bound references work in tests, and `TestConfect.layerFromInstance` wraps a preconfigured `convexTest` instance.
