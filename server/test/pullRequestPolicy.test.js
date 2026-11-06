import test from "node:test";
import assert from "node:assert/strict";
import {evaluateReviewGate,branchPatternMatches,selectBranchProtection} from "../src/services/pullRequestPolicy.js";
const author="aaaaaaaaaaaaaaaaaaaaaaaa";
const reviewer="bbbbbbbbbbbbbbbbbbbbbbbb";
const secondReviewer="cccccccccccccccccccccccc";
const head="a".repeat(40);
const stale="b".repeat(40);

test("blocks a pull request with no review",()=>{
 const gate=evaluateReviewGate([],author);
 assert.equal(gate.allowed,false);assert.equal(gate.reason,"approval_required");assert.equal(gate.approvalCount,0);
});
test("does not count the author's own approval",()=>assert.equal(evaluateReviewGate([{user:author,decision:"approved"}],author).allowed,false));
test("allows an independent approval",()=>assert.equal(evaluateReviewGate([{user:reviewer,decision:"approved"}],author).allowed,true));
test("blocks merge while any independent reviewer requests changes",()=>{
 const reviews=[{user:reviewer,decision:"approved"},{user:secondReviewer,decision:"changes_requested"}];
 assert.equal(evaluateReviewGate(reviews,author).reason,"changes_requested");
});
test("counts the configured number of unique independent approvals",()=>{
 const reviews=[{user:reviewer,decision:"approved"},{user:secondReviewer,decision:"approved"},{user:reviewer,decision:"approved"}];
 const gate=evaluateReviewGate(reviews,author,{requiredApprovals:2});
 assert.equal(gate.allowed,true);assert.equal(gate.approvalCount,2);assert.equal(gate.requiredApprovals,2);
});
test("dismisses approvals that refer to an older source SHA",()=>{
 const reviews=[{user:reviewer,decision:"approved",commitSha:stale}];
 const gate=evaluateReviewGate(reviews,author,{requiredApprovals:1,currentSourceSha:head,dismissStaleApprovals:true});
 assert.equal(gate.allowed,false);assert.equal(gate.staleApprovals,1);
});
test("accepts only approvals recorded against the current source SHA",()=>{
 const reviews=[{user:reviewer,decision:"approved",commitSha:head}];
 assert.equal(evaluateReviewGate(reviews,author,{requiredApprovals:1,currentSourceSha:head,dismissStaleApprovals:true}).allowed,true);
});
test("blocks a pull request until current approvals reach a zero-to-ten configured threshold",()=>{
 assert.equal(evaluateReviewGate([{user:reviewer,decision:"approved"}],author,{requiredApprovals:2}).allowed,false);
 assert.equal(evaluateReviewGate([],author,{requiredApprovals:0}).allowed,true);
});
test("matches exact, wildcard and single-character branch patterns safely",()=>{
 assert.equal(branchPatternMatches("main","main"),true);
 assert.equal(branchPatternMatches("release/*","release/v1.2"),true);
 assert.equal(branchPatternMatches("feature/?","feature/a"),true);
 assert.equal(branchPatternMatches("feature/*","bugfix/a"),false);
 assert.equal(branchPatternMatches("release/*","releaseCandidate"),false);
 assert.equal(branchPatternMatches("[main]","main"),false);
});
test("selects the most specific applicable rule",()=>{
 const rules=[{pattern:"*"},{pattern:"release/*"},{pattern:"release/stable"}];
 assert.equal(selectBranchProtection(rules,"release/stable").pattern,"release/stable");
 assert.equal(selectBranchProtection(rules,"release/v2").pattern,"release/*");
 assert.equal(selectBranchProtection(rules,"main").pattern,"*");
});
