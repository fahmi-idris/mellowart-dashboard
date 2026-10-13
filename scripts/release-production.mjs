import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig as readConfig } from "wrangler";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function assertProductionTarget(config) {
  const database = config.d1_databases?.find((binding) => binding.binding === "DB");
  const bucket = config.r2_buckets?.find((binding) => binding.binding === "BUCKET");
  if (
    config.name !== "mellow-cf" ||
    database?.database_name !== "mellow-db" ||
    bucket?.bucket_name !== "mellow-uploads"
  ) {
    throw new Error("Production release must target mellow-cf, mellow-db, and mellow-uploads.");
  }
  if (!config.account_id || !database.database_id)
    throw new Error("Production account/database IDs are missing.");
  return database;
}

export function assertProductionBuild(source, built) {
  const database = assertProductionTarget(source);
  const builtDatabase = assertProductionTarget(built);
  if (
    built.account_id !== source.account_id ||
    builtDatabase.database_id !== database.database_id
  ) {
    throw new Error("Built Worker does not target the configured production account/database.");
  }
}

export function assertDatabaseIntegrity(output) {
  const checks = JSON.parse(output);
  if (
    !Array.isArray(checks) ||
    checks.length === 0 ||
    checks.some(
      (check) => !check.success || !Array.isArray(check.results) || check.results.length > 0,
    )
  ) {
    throw new Error("Production database has foreign-key violations; deployment stopped.");
  }
}

function release() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run deploy:production [--check]\n--check runs local checks and deployment validation without changing production.",
    );
    return;
  }
  if (args.some((arg) => arg !== "--check"))
    throw new Error("Unknown option. Use --help for usage.");
  const checkOnly = args.includes("--check");

  // Vite selects the Cloudflare environment at build time. Never inherit dev.
  delete process.env.CLOUDFLARE_ENV;
  const configPath = join(projectRoot, "wrangler.jsonc");
  const config = readConfig(
    { config: configPath },
    { useRedirectIfAvailable: false, hideWarnings: true },
  );
  const database = assertProductionTarget(config);
  const releasesRoot = join(projectRoot, ".wrangler", "releases");
  mkdirSync(releasesRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const releaseDirectory = mkdtempSync(join(releasesRoot, `${timestamp}-`));
  chmodSync(releaseDirectory, 0o700);
  const env = { ...process.env, WRANGLER_LOG_PATH: join(releaseDirectory, "wrangler.log") };
  const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

  function run(label, command, commandArgs, capture = false) {
    console.log(`\n${label}`);
    const result = spawnSync(command, commandArgs, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${label} failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status})`}.`,
      );
    return result.stdout;
  }

  function wrangler(label, commandArgs, capture = false) {
    return run(label, process.execPath, [wranglerPath, ...commandArgs], capture);
  }

  console.log(`Production release: ${config.name} / ${database.database_name}`);
  run("Checking types", "bun", ["run", "typecheck"]);
  run("Running tests", "bun", ["run", "test"]);
  run("Building production", "bun", ["run", "build"]);
  const builtConfigPath = join(projectRoot, "build", "server", "wrangler.json");
  const readBuild = () => JSON.parse(readFileSync(builtConfigPath, "utf8"));
  assertProductionBuild(config, readBuild());
  wrangler("Validating production deployment", [
    "deploy",
    "--config",
    builtConfigPath,
    "--dry-run",
  ]);
  if (checkOnly) {
    console.log(
      "\nProduction release checks passed. No remote database or Worker changes were made.",
    );
    return;
  }

  const databaseArgs = [database.database_name, "--config", configPath, "--remote"];
  const backupPath = join(releaseDirectory, "production-before-release.sql");
  // Capture export output so its signed download URL is not printed in CI logs.
  wrangler(
    "Backing up production database",
    ["d1", "export", ...databaseArgs, "--output", backupPath, "--skip-confirmation"],
    true,
  );
  chmodSync(backupPath, 0o600);
  if (statSync(backupPath).size === 0)
    throw new Error("Production backup is empty; release stopped.");
  console.log(`Backup saved: ${backupPath}`);
  wrangler("Listing pending production migrations", ["d1", "migrations", "list", ...databaseArgs]);
  wrangler("Applying production migrations", ["d1", "migrations", "apply", ...databaseArgs]);
  assertDatabaseIntegrity(
    wrangler(
      "Checking database integrity",
      ["d1", "execute", ...databaseArgs, "--command", "PRAGMA foreign_key_check;", "--json"],
      true,
    ),
  );
  assertProductionBuild(config, readBuild());
  wrangler("Deploying production Worker", ["deploy", "--config", builtConfigPath]);
  console.log(`\nProduction release complete. Database backup: ${backupPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    release();
  } catch (error) {
    console.error(`\nProduction release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
