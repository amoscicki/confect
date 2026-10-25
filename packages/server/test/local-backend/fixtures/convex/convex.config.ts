import { defineApp } from "convex/server";
import counter from "../components/counter/convex/convex.config";
import parent from "../components/parent/convex/convex.config";

const app = defineApp();
app.use(counter, { name: "first" });
app.use(counter, { name: "second" });
app.use(parent, { name: "left" });
app.use(parent, { name: "right" });
export default app;
