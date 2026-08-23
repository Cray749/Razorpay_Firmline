// scripts/run-tests.ts — imports every *.test.ts file in the repo. Each test file
// runs its assertions at module-load time (via runSuite) and throws on failure,
// so a non-zero exit code here means something is actually broken.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "public"]);

function findTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findTestFiles(full, out);
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = findTestFiles(ROOT).sort();
  console.log(`Found ${files.length} test file(s)\n`);
  let failed = 0;
  for (const file of files) {
    console.log(`--- ${path.relative(ROOT, file)} ---`);
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.default === "function") {
        await mod.default();
      }
    } catch (err) {
      failed++;
      console.error(`  SUITE FAILED: ${file}`);
      console.error(err);
    }
  }
  console.log("");
  if (failed > 0) {
    console.error(`${failed}/${files.length} test file(s) failed`);
    process.exit(1);
  }
  console.log(`All ${files.length} test file(s) passed`);
}

main();
