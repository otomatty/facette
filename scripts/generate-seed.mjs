import { writeFileSync } from "node:fs";

writeFileSync(new URL("../seed/seed.sql", import.meta.url), "SELECT 1;\n");
