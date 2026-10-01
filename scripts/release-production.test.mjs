import { describe, expect, it } from "vitest";

import {
  assertDatabaseIntegrity,
  assertProductionBuild,
  assertProductionTarget,
} from "./release-production.mjs";

const production = {
  name: "mellow-cf",
  account_id: "production-account",
  d1_databases: [{ binding: "DB", database_name: "mellow-db", database_id: "production-db" }],
  r2_buckets: [{ binding: "BUCKET", bucket_name: "mellow-uploads" }],
};

describe("production release safeguards", () => {
  it("rejects development resources before a release", () => {
    expect(() => assertProductionTarget({ ...production, name: "mellowart-dev" })).toThrow();
    expect(() =>
      assertProductionTarget({
        ...production,
        d1_databases: [{ binding: "DB", database_name: "mellowart-dev-db", database_id: "dev-db" }],
      }),
    ).toThrow();
    expect(() =>
      assertProductionTarget({
        ...production,
        r2_buckets: [{ binding: "BUCKET", bucket_name: "mellowart-dev-uploads" }],
      }),
    ).toThrow();
  });

  it("rejects a build pointing to another database or account", () => {
    expect(() =>
      assertProductionBuild(production, {
        ...production,
        d1_databases: [{ ...production.d1_databases[0], database_id: "dev-db" }],
      }),
    ).toThrow();
    expect(() =>
      assertProductionBuild(production, { ...production, account_id: "other-account" }),
    ).toThrow();
    expect(() => assertProductionBuild(production, production)).not.toThrow();
  });

  it("stops deployment for foreign-key violations or failed integrity checks", () => {
    expect(() =>
      assertDatabaseIntegrity(
        JSON.stringify([
          {
            success: true,
            results: [{ table: "submission_images", rowid: 1, parent: "submissions", fkid: 0 }],
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      assertDatabaseIntegrity(JSON.stringify([{ success: false, results: [] }])),
    ).toThrow();
    expect(() => assertDatabaseIntegrity("[]")).toThrow();
    expect(() => assertDatabaseIntegrity("{}")).toThrow();
    expect(() =>
      assertDatabaseIntegrity(JSON.stringify([{ success: true, results: [] }])),
    ).not.toThrow();
  });
});
