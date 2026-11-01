const priorities = new Set(["low", "medium", "high", "critical"]);
const scopes = new Set(["all", "assigned", "created", "unassigned"]);

export function buildIssueListFilter({repositoryIds, status = "open", priority, search, scope = "all", userId}) {
  const filter = {repository: {$in: repositoryIds}};
  if (status === "open" || status === "closed") filter.status = status;
  if (priorities.has(priority)) filter.priority = priority;
  if (scope === "assigned" && userId) filter.assignee = userId;
  if (scope === "created" && userId) filter.author = userId;
  if (scope === "unassigned") filter.assignee = null;

  const term = String(search || "").trim().slice(0, 100);
  if (term) {
    const escaped = term.split("").map(char => "\\^$.*+?()[]{}|".includes(char) ? "\\\\" + char : char).join("");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{title: expression}, {description: expression}, {labels: expression}];
  }
  return filter;
}

export function normalizeIssueListScope(value) {
  return scopes.has(value) ? value : "all";
}
