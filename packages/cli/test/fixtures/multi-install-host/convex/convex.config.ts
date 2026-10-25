import { defineApp } from "convex/server";
import counter from "../../authored-component/convex/convex.config";

// The CMS pattern: one component definition mounted several times, each
// installation with its own name, database, and function namespace.
const app = defineApp();
app.use(counter, { name: "alpha" });
app.use(counter, { name: "beta" });
app.use(counter, { name: "gamma" });

export default app;
