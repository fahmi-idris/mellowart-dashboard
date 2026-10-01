import type { QueryClient } from "@tanstack/react-query";

import type { Paginated } from "./data-table";
import type { ApplicationStatus } from "./status";

type DecisionRow = {
  id: string;
  status: ApplicationStatus;
  decisionEmailSentAt: string | null;
};

/** Apply the confirmed send to every visible inquiry layout and the open profile. */
export function applySentDecisionToCache<T extends DecisionRow>(
  queryClient: QueryClient,
  result: { id: string; status: ApplicationStatus; decisionEmailSentAt: string },
) {
  const sentState = {
    status: result.status,
    decisionEmailSentAt: result.decisionEmailSentAt,
  };
  queryClient.setQueriesData<Paginated<T>>({ queryKey: ["inquiries"] }, (old) =>
    old && Array.isArray(old.data)
      ? {
          ...old,
          data: old.data.map((row) => (row.id === result.id ? { ...row, ...sentState } : row)),
        }
      : old,
  );
  queryClient.setQueryData<T>(["inquiry", result.id], (old) =>
    old ? { ...old, ...sentState } : old,
  );
}
