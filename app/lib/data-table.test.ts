import { describe, expect, it } from "vitest";

import {
  clientPaginate,
  listQueryToSearchParams,
  paginate,
  parseListQuery,
  type ListQuery,
} from "./data-table";

const rows = [
  { id: "A1", name: "Alice", email: "alice@x.com", brand: "Lumen", status: "pending" },
  { id: "B2", name: "Bob", email: "bob@y.com", brand: "North", status: "approved" },
  { id: "C3", name: "Carol", email: "carol@x.com", brand: "Field", status: "rejected" },
  { id: "D4", name: "Dave", email: "dave@z.com", brand: "Studio", status: "pending" },
  { id: "E5", name: "Eve", email: "eve@x.com", brand: "Common", status: "approved" },
];

const base: ListQuery = { page: 1, pageSize: 10, filters: {} };

describe("paginate", () => {
  it("computes pageCount and prev/next flags", () => {
    const p = paginate([1, 2], 5, 1, 2);
    expect(p.pageCount).toBe(3);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(true);
  });

  it("flags last page correctly", () => {
    const p = paginate([5], 5, 3, 2);
    expect(p.hasPrev).toBe(true);
    expect(p.hasNext).toBe(false);
  });
});

describe("clientPaginate", () => {
  it("slices the correct page and reports total", () => {
    const r = clientPaginate(rows, { ...base, pageSize: 2, page: 2 });
    expect(r.total).toBe(5);
    expect(r.pageCount).toBe(3);
    expect(r.data.map((x) => x.id)).toEqual(["C3", "D4"]);
    expect(r.hasPrev).toBe(true);
    expect(r.hasNext).toBe(true);
  });

  it("searches across fields, case-insensitively", () => {
    const r = clientPaginate(
      rows,
      { ...base, search: "ALICE" },
      { searchFields: ["name", "email"] },
    );
    expect(r.data.map((x) => x.id)).toEqual(["A1"]);
  });

  it("filters by exact field value", () => {
    const r = clientPaginate(rows, {
      ...base,
      filters: { status: "approved" },
    });
    expect(r.total).toBe(2);
    expect(r.data.every((x) => x.status === "approved")).toBe(true);
  });

  it("combines named search fields with OR", () => {
    const r = clientPaginate(
      rows,
      {
        ...base,
        searches: [
          { field: "name", value: "alice" },
          { field: "brand", value: "studio" },
        ],
      },
      {
        namedSearchFields: {
          name: ["name"],
          brand: ["brand"],
          email: ["email"],
        },
      },
    );
    expect(r.data.map((x) => x.id)).toEqual(["A1", "D4"]);
  });

  it("allows the same named search field more than once", () => {
    const r = clientPaginate(
      rows,
      {
        ...base,
        searches: [
          { field: "name", value: "alice" },
          { field: "name", value: "bob" },
        ],
      },
      { namedSearchFields: { name: ["name"] } },
    );
    expect(r.data.map((x) => x.id)).toEqual(["A1", "B2"]);
  });

  it("sorts ascending and descending", () => {
    const asc = clientPaginate(rows, {
      ...base,
      sort: { field: "name", dir: "asc" },
    });
    expect(asc.data[0].name).toBe("Alice");
    const desc = clientPaginate(rows, {
      ...base,
      sort: { field: "name", dir: "desc" },
    });
    expect(desc.data[0].name).toBe("Eve");
  });

  it("combines search and filter", () => {
    const r = clientPaginate(
      rows,
      { ...base, search: "x.com", filters: { status: "approved" } },
      { searchFields: ["email"] },
    );
    expect(r.data.map((x) => x.id)).toEqual(["E5"]);
  });
});

describe("list query params roundtrip", () => {
  it("serializes and parses back losslessly", () => {
    const q: ListQuery = {
      page: 3,
      pageSize: 20,
      search: "hello world",
      searches: [
        { field: "name", value: "Alice" },
        { field: "name", value: "Bob" },
        { field: "brand", value: "Studio" },
        { field: "email", value: "alice@example.com" },
      ],
      sort: { field: "name", dir: "desc" },
      filters: { status: "pending" },
    };
    const parsed = parseListQuery(listQueryToSearchParams(q));
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.search).toBe("hello world");
    expect(parsed.searches).toEqual([
      { field: "name", value: "Alice" },
      { field: "name", value: "Bob" },
      { field: "brand", value: "Studio" },
      { field: "email", value: "alice@example.com" },
    ]);
    expect(parsed.sort).toEqual({ field: "name", dir: "desc" });
    expect(parsed.filters).toEqual({ status: "pending" });
  });

  it("clamps pageSize to the max and defaults page", () => {
    const parsed = parseListQuery(new URLSearchParams("pageSize=9999"));
    expect(parsed.pageSize).toBe(100);
    expect(parsed.page).toBe(1);
  });

  it("defaults sort dir to asc when only the field is given", () => {
    const parsed = parseListQuery(new URLSearchParams("sort=name"));
    expect(parsed.sort).toEqual({ field: "name", dir: "asc" });
  });
});
