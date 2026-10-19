// Syntax-checks every JavaScript file the site runs or tests: `npm run check`.
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const dirs = ["src", "public/js", "test", "scripts"];
const files = dirs.flatMap(function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(m?js)$/.test(e.name) ? [join(dir, e.name)] : []);
});

let failed = 0;
for (const file of files) {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
  catch (e) { failed++; console.error(String(e.stderr || e.message)); }
}
console.log(failed ? `${failed} of ${files.length} files have syntax errors.` : `All ${files.length} files passed the syntax check.`);
process.exit(failed ? 1 : 0);
