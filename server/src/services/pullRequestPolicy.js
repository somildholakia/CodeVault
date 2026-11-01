function idOf(value){return String(value?._id??value??"");}

export function branchPatternMatches(pattern, branch) {
  if (typeof pattern !== "string" || typeof branch !== "string" || !pattern || !branch) return false;
  let expression = "^";
  for (const char of pattern) {
    if (char === "*") expression += ".*";
    else if (char === "?") expression += ".";
    else expression += ".+?^${}()|[]\\\\\".includes(char) ? "\\\\" + char : char;
  }
  expression += "$";
  try { return new RegExp(expression).test(branch); } catch { return false; }
}

export function selectBranchProtection(rules = [], branch) {
  return (Array.isArray(rules) ? [...rules] : [])
    .filter(rule => branchPatternMatches(rule.pattern, branch))
    .sort((a, b) => {
      const aSpecificity = String(a.pattern || "").replace(/[?*]/g, "").length;
      const bSpecificity = String(b.pattern || "").replace(/[?*]/g, "").length;
      if (aSpecificity !== bSpecificity) return bSpecificity - aSpecificity;
      return String(a.pattern).length - String(b.pattern).length;
    })[0] || null;
}

export function evaluateReviewGate(reviews = [], authorId, options = {}) {
  const author = idOf(authorId);
  const requiredApprovals = Math.max(0, Math.min(10, Number(options.requiredApprovals ?? 1) || 0));
  const currentSourceSha = options.currentSourceSha || "";
  const dismissStaleApprovals = options.dismissStaleApprovals === true;
  const independent = (Array.isArray(reviews) ? reviews : [])
    .filter(review => idOf(review.user) !== author);
  if (independent.some(review => review.decision === "changes_requested")) {
    return {allowed:false,reason:"changes_requested",approvalCount:0,requiredApprovals};
  }
  const approvals = independent.filter(review =>
    review.decision === "approved" &&
    (!dismissStaleApprovals || !currentSourceSha || review.commitSha === currentSourceSha)
  );
  const approvalCount = new Set(approvals.map(review => idOf(review.user))).size;
  if (approvalCount < requiredApprovals) {
    const staleCount = independent.filter(review =>
      review.decision === "approved" && dismissStaleApprovals && currentSourceSha && review.commitSha !== currentSourceSha
    ).length;
    return {allowed:false,reason:"approval_required",approvalCount,requiredApprovals,staleApprovals:staleCount};
  }
  return {allowed:true,reason:null,approvalCount,requiredApprovals};
}
