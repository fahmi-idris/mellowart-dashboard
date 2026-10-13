import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  LayoutGrid,
  List as ListIcon,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type ListQuery,
  type Paginated,
  type SearchCriterion,
  type SortState,
} from "~/lib/data-table";
import { cn } from "~/lib/utils";
import { shouldActivateTableRow } from "~/lib/table-row-click";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export type ViewMode = "table" | "list" | "grid";

export interface FilterDef {
  /** Column/field id sent to the API. */
  id: string;
  label: string;
  options: { label: string; value: string }[];
}

export interface SearchFieldDef {
  /** Named field id sent to the API. */
  id: string;
  label: string;
  placeholder?: string;
}

interface SearchCriterionDraft {
  field: string;
  value: string;
}

export interface BaseTableProps<T> {
  /** Stable base key for the query cache, e.g. ["inquiries"]. */
  queryKey: unknown[];
  /** Fetches one page given the current query state. */
  queryFn: (query: ListQuery) => Promise<Paginated<T>>;
  /** Column defs (table mode). Set `enableSorting` per column. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  /** Open a row without intercepting its links, buttons or selection controls. */
  onRowClick?: (row: T) => void;
  getRowLabel?: (row: T) => string;

  searchable?: boolean;
  searchPlaceholder?: string;
  /** Search state restored from the page URL on first render. */
  initialSearch?: string;
  initialSearches?: SearchCriterion[];
  initialPage?: number;
  initialPageSize?: number;
  initialSort?: SortState | null;
  /** Optional field-specific search controls. Populated fields use OR. */
  advancedSearchFields?: SearchFieldDef[];
  filters?: FilterDef[];

  pageSize?: number;
  pageSizeOptions?: number[];

  /** Auto-refetch interval in ms (e.g. 15000). Omit to disable polling. */
  refetchInterval?: number;

  modes?: ViewMode[];
  defaultMode?: ViewMode;
  renderGridItem?: (row: T) => React.ReactNode;
  renderListItem?: (row: T) => React.ReactNode;

  /** Filters applied on first render (e.g. event scoping from a link). */
  initialFilters?: Record<string, string>;
  /** Notified whenever search/sort/filter/pagination changes. */
  onQueryChange?: (q: ListQuery) => void;
  /** Extra controls rendered at the end of the toolbar (e.g. Copy emails). */
  toolbarExtra?: React.ReactNode;
  /** Optional selection is limited to rows on the current page. */
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  selectionToolbar?: React.ReactNode;
  /** Columns users may show or hide; other columns stay visible. */
  columnOptions?: { id: string; label: string; defaultVisible?: boolean }[];

  emptyMessage?: string;
}

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const MODE_ICON: Record<ViewMode, React.ComponentType<{ className?: string }>> = {
  table: Table2,
  list: ListIcon,
  grid: LayoutGrid,
};

export function BaseTable<T>({
  queryKey,
  queryFn,
  columns,
  getRowId,
  onRowClick,
  getRowLabel,
  searchable = true,
  searchPlaceholder = "Search…",
  initialSearch = "",
  initialSearches = [],
  initialPage = 1,
  initialPageSize,
  initialSort,
  advancedSearchFields = [],
  filters = [],
  pageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  refetchInterval,
  modes = ["table", "list", "grid"],
  defaultMode,
  renderGridItem,
  renderListItem,
  initialFilters,
  onQueryChange,
  toolbarExtra,
  selectedIds,
  onSelectedIdsChange,
  selectionToolbar,
  columnOptions = [],
  emptyMessage = "No results.",
}: BaseTableProps<T>) {
  const [mode, setMode] = React.useState<ViewMode>(defaultMode ?? modes[0]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: Math.max(0, initialPage - 1),
    pageSize:
      initialPageSize && pageSizeOptions.includes(initialPageSize) ? initialPageSize : pageSize,
  });
  const [sorting, setSorting] = React.useState<SortingState>(
    initialSort ? [{ id: initialSort.field, desc: initialSort.dir === "desc" }] : [],
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() =>
    Object.fromEntries(columnOptions.map((option) => [option.id, option.defaultVisible !== false])),
  );
  const [searchInput, setSearchInput] = React.useState(initialSearch);
  const [advancedSearchOpen, setAdvancedSearchOpen] = React.useState(false);
  const [advancedSearchDraft, setAdvancedSearchDraft] = React.useState<SearchCriterionDraft[]>([]);
  const [advancedSearches, setAdvancedSearches] = React.useState<SearchCriterionDraft[]>(() =>
    initialSearches
      .filter((criterion) => advancedSearchFields.some((field) => field.id === criterion.field))
      .map((criterion) => ({ ...criterion })),
  );
  const advancedSearchId = React.useId();
  const [activeFilters, setActiveFilters] = React.useState<Record<string, string>>(
    initialFilters ?? {},
  );
  const search = useDebounced(searchInput);

  // Any change to search/filters should send us back to the first page, but
  // preserve a page restored from the URL on the initial render.
  const initializedQuery = React.useRef(false);
  React.useEffect(() => {
    if (!initializedQuery.current) {
      initializedQuery.current = true;
      return;
    }
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [search, advancedSearches, activeFilters]);

  // Drop any active filter value that the current filter defs no longer offer
  // (e.g. a stall filter whose options changed because the selected event
  // changed). Otherwise we'd keep querying by a value the user can't see or
  // clear from the toolbar.
  React.useEffect(() => {
    setActiveFilters((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const def = filters.find((f) => f.id === key);
        if (def && (value === "all" || def.options.some((o) => o.value === value))) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filters]);

  const listQuery: ListQuery = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined,
    searches: advancedSearches.length > 0 ? advancedSearches : undefined,
    sort: sorting[0] ? { field: sorting[0].id, dir: sorting[0].desc ? "desc" : "asc" } : null,
    filters: activeFilters,
  };

  // Surface the live query to the parent (Copy emails, deep links, etc.).
  const queryJson = JSON.stringify(listQuery);
  React.useEffect(() => {
    onQueryChange?.(JSON.parse(queryJson) as ListQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryJson]);

  const query = useQuery({
    queryKey: [...queryKey, listQuery],
    queryFn: () => queryFn(listQuery),
    placeholderData: keepPreviousData,
    refetchInterval,
  });

  const rows = query.data?.data ?? [];

  const table = useReactTable({
    data: rows,
    columns,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: query.data?.pageCount ?? -1,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = query.data?.total ?? 0;
  const start = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const end = Math.min(start + pagination.pageSize - 1, total);
  const showLoading = query.isPending;
  const activeAdvancedSearches = advancedSearches.flatMap((criterion, index) => {
    const field = advancedSearchFields.find((candidate) => candidate.id === criterion.field);
    return field && criterion.value ? [{ field, value: criterion.value, index }] : [];
  });
  const pageIds = rows.map(getRowId);
  const selectedOnPage = pageIds.filter((id) => selectedIds?.includes(id));
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const togglePage = () => {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange(allSelected ? [] : pageIds);
  };

  const handleAdvancedSearchOpenChange = (open: boolean) => {
    if (open) {
      setAdvancedSearchDraft(
        advancedSearches.length > 0
          ? advancedSearches.map((criterion) => ({ ...criterion }))
          : advancedSearchFields[0]
            ? [{ field: advancedSearchFields[0].id, value: "" }]
            : [],
      );
    }
    setAdvancedSearchOpen(open);
  };

  const applyAdvancedSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = advancedSearchDraft.flatMap((criterion) => {
      const value = criterion.value.trim();
      const validField = advancedSearchFields.some((field) => field.id === criterion.field);
      return value && validField ? [{ field: criterion.field, value }] : [];
    });
    setAdvancedSearches(next);
    setAdvancedSearchOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {columnOptions.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Columns3 className="size-4" /> Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56">
                <p className="mb-2 text-xs text-muted-foreground">Columns shown in the table</p>
                <div className="grid gap-2">
                  {columnOptions.map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        aria-label={`Show ${option.label} column`}
                        checked={table.getColumn(option.id)?.getIsVisible() ?? false}
                        onCheckedChange={(checked) =>
                          table.getColumn(option.id)?.toggleVisibility(checked === true)
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() =>
                    setColumnVisibility(
                      Object.fromEntries(
                        columnOptions.map((option) => [option.id, option.defaultVisible !== false]),
                      ),
                    )
                  }
                >
                  Reset to default
                </Button>
              </PopoverContent>
            </Popover>
          )}
          {searchable && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Quick search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {advancedSearchFields.length > 0 && (
            <Popover open={advancedSearchOpen} onOpenChange={handleAdvancedSearchOpenChange}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <SlidersHorizontal className="size-4" />
                  Advanced search
                  {activeAdvancedSearches.length > 0 && (
                    <span
                      className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground"
                      aria-label={`${activeAdvancedSearches.length} active search criteria`}
                    >
                      {activeAdvancedSearches.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[28rem] overflow-hidden p-0">
                <form
                  className="flex max-h-[min(36rem,var(--radix-popover-content-available-height))] flex-col"
                  onSubmit={applyAdvancedSearch}
                >
                  <div className="grid shrink-0 gap-1 border-b p-4">
                    <p className="font-medium">Build your search</p>
                    <p className="text-xs text-muted-foreground">
                      Add one or more conditions. A result appears when any (OR) condition matches.
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                    <div className="grid gap-2">
                      {advancedSearchDraft.map((criterion, index) => {
                        const selectedField = advancedSearchFields.find(
                          (field) => field.id === criterion.field,
                        );
                        const inputId = `${advancedSearchId}-value-${index}`;
                        return (
                          <div key={index} className="flex items-center gap-2">
                            <Select
                              value={criterion.field}
                              onValueChange={(field) =>
                                setAdvancedSearchDraft((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, field } : item,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-28 shrink-0"
                                aria-label={`Search field ${index + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {advancedSearchFields.map((field) => (
                                  <SelectItem key={field.id} value={field.id}>
                                    {field.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Label htmlFor={inputId} className="sr-only">
                              {selectedField?.label ?? "Search"} value
                            </Label>
                            <Input
                              id={inputId}
                              value={criterion.value}
                              placeholder={selectedField?.placeholder ?? "Enter a value"}
                              onChange={(event) =>
                                setAdvancedSearchDraft((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, value: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              onClick={() =>
                                setAdvancedSearchDraft((previous) =>
                                  previous.filter((_, itemIndex) => itemIndex !== index),
                                )
                              }
                              aria-label={`Remove condition ${index + 1}`}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        );
                      })}
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-start"
                          onClick={() => {
                            const nextField = advancedSearchFields[0];
                            if (nextField) {
                              setAdvancedSearchDraft((previous) => [
                                ...previous,
                                { field: nextField.id, value: "" },
                              ]);
                            }
                          }}
                        >
                          <Plus className="size-4" />
                          Add condition
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-between gap-2 border-t bg-muted/30 p-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAdvancedSearchDraft([]);
                        setAdvancedSearches([]);
                        setAdvancedSearchOpen(false);
                      }}
                    >
                      Clear all
                    </Button>
                    <Button type="submit" size="sm">
                      Apply search
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>
          )}
          {filters.map((f) => (
            <Select
              key={f.id}
              value={activeFilters[f.id] ?? "all"}
              onValueChange={(value) =>
                setActiveFilters((prev) => {
                  const next = { ...prev };
                  if (value === "all" && f.id !== "view") delete next[f.id];
                  else next[f.id] = value;
                  return next;
                })
              }
            >
              <SelectTrigger
                className="w-auto min-w-32"
                size="sm"
                aria-label={`Filter by ${f.label}`}
              >
                <SelectValue placeholder={f.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {f.label.toLowerCase()}</SelectItem>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          {toolbarExtra}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {modes.length > 1 && (
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {modes.map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <Button
                  key={m}
                  type="button"
                  variant={mode === m ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-pressed={mode === m}
                  aria-label={`${m} view`}
                  onClick={() => {
                    if (mode === m) return;
                    onSelectedIdsChange?.([]);
                    setMode(m);
                  }}
                >
                  <Icon className="size-4" />
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {activeAdvancedSearches.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Active advanced search criteria"
        >
          <span className="text-xs font-medium text-muted-foreground">Match any:</span>
          {activeAdvancedSearches.map(({ field, value, index }) => (
            <Button
              key={`${field.id}-${index}`}
              type="button"
              variant="outline"
              size="xs"
              className="max-w-full gap-1"
              onClick={() =>
                setAdvancedSearches((previous) =>
                  previous.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              aria-label={`Remove ${field.label} search: ${value}`}
            >
              <span className="max-w-48 truncate">
                {field.label}: {value}
              </span>
              <X className="size-3" />
            </Button>
          ))}
        </div>
      )}

      {selectedIds && selectedIds.length > 0 && selectionToolbar}

      {/* Body */}
      <div>
        {mode === "table" && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {onSelectedIdsChange && (
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Select all rows on this page"
                          checked={
                            allSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false
                          }
                          onCheckedChange={togglePage}
                        />
                      </TableHead>
                    )}
                    {hg.headers.map((header) => {
                      if (!header.column.getIsVisible()) return null;
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            canSort
                              ? sorted === "asc"
                                ? "ascending"
                                : sorted === "desc"
                                  ? "descending"
                                  : "none"
                              : undefined
                          }
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              className="inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === "asc" ? (
                                <ArrowUp className="size-3.5" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="size-3.5" />
                              ) : (
                                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {showLoading ? (
                  <SkeletonRows
                    rows={pagination.pageSize}
                    cols={table.getVisibleLeafColumns().length + (onSelectedIdsChange ? 1 : 0)}
                  />
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length + (onSelectedIdsChange ? 1 : 0)}
                      className="h-24 text-center text-muted-foreground"
                    >
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={
                        onRowClick
                          ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                          : undefined
                      }
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-label={onRowClick ? getRowLabel?.(row.original) : undefined}
                      onClick={(event) => {
                        if (
                          !onRowClick ||
                          !shouldActivateTableRow(event, window.getSelection()?.toString())
                        )
                          return;
                        onRowClick(row.original);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || !onRowClick) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row.original);
                        }
                      }}
                    >
                      {onSelectedIdsChange && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${row.id}`}
                            checked={selectedIds?.includes(row.id) ?? false}
                            onCheckedChange={(checked) =>
                              onSelectedIdsChange(
                                checked === true
                                  ? [...(selectedIds ?? []), row.id]
                                  : (selectedIds ?? []).filter((id) => id !== row.id),
                              )
                            }
                          />
                        </TableCell>
                      )}
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {mode === "grid" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {showLoading ? (
              Array.from({ length: pagination.pageSize }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))
            ) : rows.length === 0 ? (
              <p className="col-span-full py-12 text-center text-muted-foreground">
                {emptyMessage}
              </p>
            ) : (
              rows.map((row) => (
                <div
                  key={getRowId(row)}
                  className={
                    onRowClick
                      ? "cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? getRowLabel?.(row) : undefined}
                  onClick={(event) => {
                    if (
                      onRowClick &&
                      shouldActivateTableRow(event, window.getSelection()?.toString())
                    ) {
                      onRowClick(row);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || !onRowClick) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                >
                  {renderGridItem?.(row)}
                </div>
              ))
            )}
          </div>
        )}

        {mode === "list" && (
          <div className="flex flex-col divide-y rounded-md border">
            {showLoading ? (
              Array.from({ length: pagination.pageSize }).map((_, i) => (
                <div key={i} className="p-3">
                  <Skeleton className="h-10 w-full" />
                </div>
              ))
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">{emptyMessage}</p>
            ) : (
              rows.map((row) => (
                <div
                  key={getRowId(row)}
                  className={
                    onRowClick
                      ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? getRowLabel?.(row) : undefined}
                  onClick={(event) => {
                    if (
                      onRowClick &&
                      shouldActivateTableRow(event, window.getSelection()?.toString())
                    ) {
                      onRowClick(row);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || !onRowClick) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                >
                  {renderListItem?.(row)}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer / pagination */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {total > 0 ? `Showing ${start}–${end} of ${total}` : "No results"}
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-18" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground">
            Page {pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              aria-label="First page"
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
