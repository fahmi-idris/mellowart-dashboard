import { paginate, type ListQuery, type Paginated } from "~/lib/data-table";

/**
 * Offset pagination against a D1 table, with search/filter/sort.
 *
 * Runs the page query and the COUNT query in ONE `db.batch()` round trip.
 *
 * Safety: values are always bound (`?`) so user input can't inject. Identifiers
 * (table, columns, sort field) are NOT bindable in SQL, so they come from the
 * developer-supplied `config` and the sort field is checked against an allowlist.
 * Never build `config` from request input.
 */
export interface D1ListConfig {
  table: string;
  /** Selected columns, default "*". */
  columns?: string;
  /** Columns matched with LIKE for the search box. */
  searchColumns?: string[];
  /**
   * Named search fields and their SQL expressions. Named fields are combined
   * with OR; expressions within one field are also combined with OR.
   * Keys and expressions must be developer-controlled.
   */
  searchFieldColumns?: Record<string, string[]>;
  /** Columns allowed as exact-match filters. */
  filterColumns?: string[];
  /** Columns allowed in ORDER BY (allowlist — prevents injection). */
  sortColumns?: string[];
  /** Applied when no valid sort is requested. */
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /**
   * Extra WHERE fragment AND-ed into every query (page + count), e.g.
   * "archived_at IS NULL". MUST be developer-controlled with no bound params —
   * never build it from request input.
   */
  extraWhere?: string;
}

interface CountRow {
  total: number;
}

export async function d1List<T>(
  db: D1Database,
  q: ListQuery,
  config: D1ListConfig,
): Promise<Paginated<T>> {
  const where: string[] = [];
  const args: unknown[] = [];

  // Search across configured columns: (a LIKE ? OR b LIKE ?)
  if (q.search && config.searchColumns?.length) {
    const like = `%${q.search}%`;
    where.push("(" + config.searchColumns.map((c) => `${c} LIKE ?`).join(" OR ") + ")");
    for (const _ of config.searchColumns) args.push(like);
  }

  // Advanced search: ((name expressions) OR (brand expressions) OR ...).
  // Unknown request keys are ignored because only config keys are used.
  const namedSearchGroups: string[] = [];
  if (q.searches && config.searchFieldColumns) {
    for (const criterion of q.searches) {
      const expressions = config.searchFieldColumns[criterion.field];
      if (!criterion.value || !expressions?.length) continue;
      namedSearchGroups.push(
        "(" + expressions.map((expression) => `${expression} LIKE ?`).join(" OR ") + ")",
      );
      const like = `%${criterion.value}%`;
      for (const _ of expressions) args.push(like);
    }
  }
  if (namedSearchGroups.length) {
    where.push("(" + namedSearchGroups.join(" OR ") + ")");
  }

  // Exact-match filters
  if (q.filters && config.filterColumns?.length) {
    for (const col of config.filterColumns) {
      const value = q.filters[col];
      if (value != null && value !== "") {
        where.push(`${col} = ?`);
        args.push(value);
      }
    }
  }

  // Developer-controlled scope (no bound params), e.g. "archived_at IS NULL".
  if (config.extraWhere) where.push(config.extraWhere);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Sort: only honor an allowlisted field, else fall back to default.
  const requested = q.sort && config.sortColumns?.includes(q.sort.field) ? q.sort : null;
  const sort = requested ?? config.defaultSort ?? null;
  const orderSql = sort ? `ORDER BY ${sort.field} ${sort.dir === "desc" ? "DESC" : "ASC"}` : "";

  const pageSize = Math.max(1, q.pageSize);
  const page = Math.max(1, q.page);
  const offset = (page - 1) * pageSize;
  const columns = config.columns ?? "*";

  const dataStmt = db
    .prepare(`SELECT ${columns} FROM ${config.table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...args, pageSize, offset);

  const countStmt = db
    .prepare(`SELECT COUNT(*) AS total FROM ${config.table} ${whereSql}`)
    .bind(...args);

  // Single round trip to D1.
  const [dataRes, countRes] = await db.batch([dataStmt, countStmt]);

  const data = (dataRes.results ?? []) as T[];
  const total = Number((countRes.results?.[0] as CountRow | undefined)?.total ?? 0);

  return paginate(data, total, page, pageSize);
}
