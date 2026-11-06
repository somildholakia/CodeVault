import test,{after} from "node:test";
import {execFileSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-tests-"));
process.env.REPO_STORAGE_PATH=path.join(temp,"repos");
const git=await import("../src/services/git.js");
const {restoreGitBundle}=await import("../../scripts/restore-git-bundle.js");
const dependencyScanner=await import("../src/services/dependencyScanner.js");
let seq=1;
async function makeRepo(){const id=(seq++).toString(16).padStart(24,"0");await git.initRepository({_id:id,name:"test-project",description:"Test repository"},{addReadme:true,authorName:"Test User",authorEmail:"test@codevault.local"});return id;}
after(async()=>fs.rm(temp,{recursive:true,force:true}));
test("creates a real Git repository with its first commit",async()=>{const id=await makeRepo();assert.ok((await git.listFiles(id)).some(f=>f.path==="README.md"));const commits=await git.listCommits(id);assert.equal(commits.length,1);assert.equal(commits[0].message,"Initial commit");assert.match(commits[0].sha,/^[a-f0-9]{40}$/);});
test("creates branches and previews an ordinary merge",async()=>{const id=await makeRepo();await git.createBranch(id,"feature/demo","main");assert.ok((await git.listBranches(id)).some(b=>b.name==="feature/demo"));const preview=await git.previewMerge(id,"feature/demo","main");assert.equal(preview.canMerge,true);});
test("creates a branch directly from a selected historical commit SHA",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const selected=await git.commitFile(id,"main","history.js","export const historical = true;","Add historical checkpoint",author);
 await git.commitFile(id,"main","later.js","export const later = true;","Add later checkpoint",author);
 await git.createBranch(id,"feature/historical",selected.sha);
 const branches=await git.listBranches(id);
 assert.equal(branches.find(item=>item.name==="feature/historical").sha,selected.sha);
 assert.ok((await git.listFiles(id,"feature/historical")).some(item=>item.path==="history.js"));
 assert.ok(!(await git.listFiles(id,"feature/historical")).some(item=>item.path==="later.js"));
});

test("commits files, reads content and returns a real diff",async()=>{const id=await makeRepo();const r=await git.commitFile(id,"main","src/example.js","export const answer = 42;\\n","Add example module",{username:"testuser",displayName:"Test User",email:"test@codevault.local"});assert.match(r.sha,/^[a-f0-9]{40}$/);assert.equal((await git.readFile(id,"main","src/example.js")).content,"export const answer = 42;\\n");assert.match(await git.diffCommit(id,r.sha),/answer = 42/);});
test("rejects traversal and invalid refs",async()=>{const id=await makeRepo();await assert.rejects(()=>git.readFile(id,"main","../outside.env"),e=>e.code==="INVALID_FILE_PATH");await assert.rejects(()=>git.listFiles(id,"../main"),e=>e.code==="INVALID_GIT_REF");});
test("merges a clean feature branch with native Git",async()=>{const id=await makeRepo();await git.createBranch(id,"feature/clean","main");await git.commitFile(id,"feature/clean","feature.js","export const ok = true;\\n","Add feature",{username:"testuser",displayName:"Test User",email:"test@codevault.local"});const head=(await git.listBranches(id)).find(b=>b.name==="main").sha;assert.equal((await git.previewMerge(id,"feature/clean","main")).canMerge,true);await git.mergeBranches(id,"feature/clean","main",head);assert.ok((await git.listCommits(id,"main")).some(c=>c.message==="Add feature"));});

test("detects a conflicting merge without changing the target branch",async()=>{const id=await makeRepo();await git.createBranch(id,"feature/conflict","main");const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};await git.commitFile(id,"feature/conflict","README.md","# feature version\n","Change README on feature",author);await git.commitFile(id,"main","README.md","# main version\n","Change README on main",author);const before=(await git.listBranches(id)).find(b=>b.name==="main").sha;const preview=await git.previewMerge(id,"feature/conflict","main");assert.equal(preview.canMerge,false);const after=(await git.listBranches(id)).find(b=>b.name==="main").sha;assert.equal(after,before);});

test("searches committed text for exact literal matches on a selected ref",async()=>{
 const id=await makeRepo();
 const fixture = ['export const tokenPattern = "TOKEN.*";', 'export const tokenLabel = "token.*";'].join(String.fromCharCode(10));
 await git.commitFile(id,"main","src/search.js",fixture,"Add search fixture",{username:"testuser",displayName:"Test User",email:"test@codevault.local"});
 const result=await git.searchCode(id,"token.*","main");
 assert.equal(result.query,"token.*");
 assert.equal(result.ref,"main");
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].path,"src/search.js");
 assert.equal(result.results[0].line,2);
 assert.ok(result.results[0].snippet.includes("token.*"));
 assert.equal(result.truncated,false);
});

test("searches only the selected branch and returns no-match results safely",async()=>{
 const id=await makeRepo();
 await git.createBranch(id,"feature/search","main");
 await git.commitFile(id,"feature/search","src/feature.js","export const featureFlag = true;\\n","Add feature flag",{username:"testuser",displayName:"Test User",email:"test@codevault.local"});
 assert.equal((await git.searchCode(id,"featureFlag","main")).results.length,0);
 assert.equal((await git.searchCode(id,"featureFlag","feature/search")).results[0].path,"src/feature.js");
 assert.deepEqual((await git.searchCode(id,"not-in-this-repo","main")).results,[]);
});

test("caps code search results and rejects invalid search input or refs",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.commitFile(id,"main","a.js","const needle = 1;\\n","Add first needle",{...author});
 await git.commitFile(id,"main","b.js","const needle = 2;\\n","Add second needle",{...author});
 const result=await git.searchCode(id,"needle","main",1);
 assert.equal(result.results.length,1);
 assert.equal(result.truncated,true);
 await assert.rejects(()=>git.searchCode(id,"","main"),e=>e.code==="INVALID_SEARCH_QUERY");
 await assert.rejects(()=>git.searchCode(id,"needle","../main"),e=>e.code==="INVALID_GIT_REF");
});

test("publishes annotated release tags against the selected Git branch",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"release/stable","main");
 await git.commitFile(id,"release/stable","src/release.js","export const releaseReady = true;","Prepare stable release",author);
 const created=await git.createTag(id,"v1.0.0","release/stable","CodeVault 1.0.0",{...author});
 assert.match(created.commitSha,/^[a-f0-9]{40}$/);
 const tags=await git.listTags(id);
 assert.equal(tags.length,1);
 assert.equal(tags[0].name,"v1.0.0");
 assert.equal(tags[0].commitSha,created.commitSha);
 assert.equal(tags[0].subject,"CodeVault 1.0.0");
 await assert.rejects(()=>git.createTag(id,"v1.0.0","main","Duplicate release",{...author}),e=>e.code==="GIT_REF_EXISTS");
});

test("rejects invalid release targets and tag names",async()=>{
 const id=await makeRepo();
 await assert.rejects(()=>git.createTag(id,"../v1","main","Invalid tag"),e=>e.code==="INVALID_GIT_REF");
 await assert.rejects(()=>git.createTag(id,"v1.0.0","missing-branch","Invalid target"),e=>e.code==="GIT_OPERATION_FAILED");
});

test("builds a commit graph across branches with parent pointers and refs",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const initial=(await git.listCommits(id,"main",1))[0];
 await git.createBranch(id,"feature/graph","main");
 const feature=await git.commitFile(id,"feature/graph","feature.js","export const feature = true;","Add feature branch commit",author);
 const main=await git.commitFile(id,"main","main.js","export const main = true;","Add main branch commit",author);
 const graph=await git.listCommitGraph(id,"all",50);
 const bySha=new Map(graph.commits.map(commit=>[commit.sha,commit]));
 assert.ok(bySha.has(feature.sha));
 assert.ok(bySha.has(main.sha));
 assert.ok(bySha.has(initial.sha));
 assert.deepEqual(bySha.get(feature.sha).parents,[initial.sha]);
 assert.deepEqual(bySha.get(main.sha).parents,[initial.sha]);
 assert.ok(bySha.get(main.sha).refs.some(ref=>ref.name==="main"&&ref.type==="branch"));
 assert.ok(bySha.get(feature.sha).refs.some(ref=>ref.name==="feature/graph"&&ref.type==="branch"));
 assert.ok(graph.branches.some(item=>item.name==="feature/graph"));
});

test("compares two commits and rejects identical or invalid refs",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const base=(await git.listCommits(id,"main",1))[0];
 const next=await git.commitFile(id,"main","compare.js","export const compared = true;","Add comparison fixture",author);
 const comparison=await git.compareCommits(id,base.sha,next.sha);
 assert.equal(comparison.base,base.sha);
 assert.equal(comparison.target,next.sha);
 assert.match(comparison.diff,/compare.js/);
 assert.match(comparison.diff,/compared/);
 await assert.rejects(()=>git.compareCommits(id,base.sha,base.sha),e=>e.code==="SAME_COMMIT");
 await assert.rejects(()=>git.compareCommits(id,"missing","main"),e=>e.code==="GIT_OPERATION_FAILED");
});

test("reverts a normal commit by adding a new inverse commit without rewriting history",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const before=(await git.listCommits(id,"main",1))[0];
 const created=await git.commitFile(id,"main","src/revert-me.js","export const temporary = true;","Add temporary feature",author);
 const result=await git.revertCommit(id,"main",created.sha,(await git.listBranches(id)).find(item=>item.name==="main").sha,author);
 assert.equal(result.revertedCommit,created.sha);
 assert.notEqual(result.revertCommit,created.sha);
 assert.equal((await git.readFile(id,"main","src/revert-me.js").catch(error=>error.code)), "GIT_OPERATION_FAILED");
 const history=await git.listCommits(id,"main",5);
 assert.equal(history[0].sha,result.revertCommit);
 assert.match(history[0].message,/Revert/);
 assert.ok(history.some(item=>item.sha===created.sha));
 assert.ok(history.some(item=>item.sha===before.sha));
});

test("rejects stale, unrelated, root and malformed commit reverts",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const initial=(await git.listCommits(id,"main",1))[0];
 await git.createBranch(id,"feature/unrelated","main");
 const side=await git.commitFile(id,"feature/unrelated","side.js","export const side = true;","Add side branch commit",author);
 const next=await git.commitFile(id,"main","main.js","export const main = true;","Add main branch commit",author);
 const mainHead=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 await assert.rejects(()=>git.revertCommit(id,"main",next.sha,initial.sha,author),e=>e.code==="BRANCH_MOVED");
 await assert.rejects(()=>git.revertCommit(id,"main",side.sha,mainHead,author),e=>e.code==="COMMIT_NOT_ON_BRANCH");
 await assert.rejects(()=>git.revertCommit(id,"main",initial.sha,mainHead,author),e=>e.code==="ROOT_COMMIT_REVERT_UNSUPPORTED");
 await assert.rejects(()=>git.revertCommit(id,"main","bad",mainHead,author),e=>e.code==="INVALID_COMMIT");
});

test("adapter-backed revert retries deterministically after failures before object creation and after object persistence",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const created=await git.commitFile(id,"main","src/retry-revert.js","export const retryMe = true;\\n","Add retry revert fixture",author);
 const head=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 const operationId="revert-retry-object-001";
 await assert.rejects(()=>git.revertCommit(id,"main",created.sha,head,author,{operationId,failureAt:"beforeObjectCreation"}),/Injected revert failure at beforeObjectCreation/);
 assert.equal((await git.listBranches(id)).find(item=>item.name==="main").sha,head);
 const persisted=[];
 await assert.rejects(()=>git.revertCommit(id,"main",created.sha,head,author,{
  operationId,failureAt:"afterObjectPersistence",
  onStage:(stage,details)=>{if(stage==="afterObjectPersistence")persisted.push(details.commitSha);}
 }),/Injected revert failure at afterObjectPersistence/);
 assert.equal(persisted.length,1);
 assert.equal(execFileSync("git",["cat-file","-t",persisted[0]],{cwd:git.repositoryPath(id),encoding:"utf8"}).trim(),"commit");
 assert.equal((await git.listBranches(id)).find(item=>item.name==="main").sha,head);
 const recovered=await git.revertCommit(id,"main",created.sha,head,author,{operationId});
 assert.equal(recovered.revertCommit,persisted[0]);
 assert.equal(recovered.replayed,false);
 const matching=execFileSync("git",["log","--format=%H","--fixed-strings","--grep=CodeVault-Operation-Id: "+operationId,"refs/heads/main"],{cwd:git.repositoryPath(id),encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
 assert.equal(matching.length,1);
 assert.equal((await git.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
});

test("adapter-backed revert fails closed after journal preparation and immediately before ref publication",async()=>{
 for(const [failureAt,suffix] of [["afterJournalPreparation","journal"],["beforeRefPublication","publish"]]){
  const id=await makeRepo();
  const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
  const created=await git.commitFile(id,"main","src/"+suffix+"-revert.js","export const value = true;\\n","Add "+suffix+" revert fixture",author);
  const head=(await git.listBranches(id)).find(item=>item.name==="main").sha;
  const operationId="revert-fail-"+suffix+"-001";
  await assert.rejects(()=>git.revertCommit(id,"main",created.sha,head,author,{operationId,failureAt}),/Injected revert failure/);
  const operations=path.join(process.env.REPO_STORAGE_PATH,".codevault-state",id,"operations");
  const journal=JSON.parse(await fs.readFile(path.join(operations,operationId+".json"),"utf8"));
  assert.equal(journal.status,"aborted");
  assert.equal((await git.listBranches(id)).find(item=>item.name==="main").sha,head);
  await assert.rejects(()=>git.revertCommit(id,"main",created.sha,head,author,{operationId}),
   error=>error.code==="STORAGE_OPERATION_FAILED"||error.code==="STORAGE_OPERATION_INTERRUPTED");
  assert.equal((await git.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
 }
});

test("adapter-backed revert recovers a process failure immediately after ref publication but before journal finalization",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const created=await git.commitFile(id,"main","src/response-loss.js","export const responseLoss = true;\\n","Add response-loss fixture",author);
 const head=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 const operationId="revert-response-loss-001";
 await assert.rejects(()=>git.revertCommit(id,"main",created.sha,head,author,{operationId,failureAt:"afterRefPublication"}),/Injected revert failure at afterRefPublication/);
 const published=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 assert.notEqual(published,head);
 const stateDirectory=path.join(process.env.REPO_STORAGE_PATH,".codevault-state",id);
 const journalFile=path.join(stateDirectory,"operations",operationId+".json");
 const journalBeforeRetry=JSON.parse(await fs.readFile(journalFile,"utf8"));
 const stateBeforeRetry=JSON.parse(await fs.readFile(path.join(stateDirectory,"state.json"),"utf8"));
 assert.equal(journalBeforeRetry.status,"prepared");
 assert.equal(stateBeforeRetry.generation,journalBeforeRetry.generationBefore);
 assert.equal(await git.gitStorageAdapter.readRef({repositoryId:id,ref:"refs/heads/main"}),published);
 const retried=await git.revertCommit(id,"main",created.sha,head,author,{operationId});
 assert.equal(retried.revertCommit,published);
 assert.equal(retried.replayed,true);
 const recovered=JSON.parse(await fs.readFile(journalFile,"utf8"));
 assert.equal(recovered.status,"committed");
 assert.equal(recovered.result.recovered,true);
 const matching=execFileSync("git",["log","--format=%H","--fixed-strings","--grep=CodeVault-Operation-Id: "+operationId,"refs/heads/main"],{cwd:git.repositoryPath(id),encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
 assert.equal(matching.length,1);
 assert.equal((await git.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
});

test("recovers a prepared revert journal after publication and returns the existing operation commit",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const created=await git.commitFile(id,"main","src/interrupted-revert.js","export const interrupted = true;\\n","Add interrupted revert fixture",author);
 const head=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 const operationId="revert-interrupted-001";
 const published=await git.revertCommit(id,"main",created.sha,head,author,{operationId});
 const stateDirectory=path.join(process.env.REPO_STORAGE_PATH,".codevault-state",id);
 const journalFile=path.join(stateDirectory,"operations",operationId+".json");
 const journal=JSON.parse(await fs.readFile(journalFile,"utf8"));
 journal.status="prepared";
 delete journal.result;
 await fs.writeFile(journalFile,JSON.stringify(journal));
 await fs.writeFile(path.join(stateDirectory,"state.json"),JSON.stringify({generation:journal.generationBefore,fence:0}));
 const retried=await git.revertCommit(id,"main",created.sha,head,author,{operationId});
 assert.equal(retried.revertCommit,published.revertCommit);
 assert.equal(retried.replayed,true);
 const recovered=JSON.parse(await fs.readFile(journalFile,"utf8"));
 assert.equal(recovered.status,"committed");
 assert.equal(recovered.result.recovered,true);
 assert.equal((await git.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
});

test("rejects stale revert heads and preserves merge-commit mainline behavior",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/revert-mainline","main");
 const side=await git.commitFile(id,"feature/revert-mainline","side.js","export const side = true;\\n","Add side for merge revert",author);
 await git.commitFile(id,"main","main.js","export const main = true;\\n","Add main for merge revert",author);
 const headBeforeMerge=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 await git.mergeBranches(id,"feature/revert-mainline","main",headBeforeMerge);
 const mergeHead=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 await assert.rejects(()=>git.revertCommit(id,"main",mergeHead,mergeHead,author,{mainline:1,operationId:"revert-merge-mainline-01"}),error=>error.code==="MERGE_COMMIT_REVERT_UNSUPPORTED");
 await git.commitFile(id,"main","next.js","export const next = true;\\n","Advance after merge",author);
 const stale=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 await assert.rejects(()=>git.revertCommit(id,"main",side.sha,mergeHead,author,{operationId:"revert-stale-head-001"}),error=>error.code==="BRANCH_MOVED");
 assert.equal((await git.listBranches(id)).find(item=>item.name==="main").sha,stale);
 assert.equal((await git.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
});

test("validates changed-line review anchors in a branch diff",()=>{
 const diff=[
  "diff --git a/src/file.js b/src/file.js",
  "--- a/src/file.js",
  "+++ b/src/file.js",
  "@@ -2,1 +2,2 @@",
  "-old line",
  "+new line",
  "+second new line"
 ].join(String.fromCharCode(10));
 assert.equal(git.isAddedDiffLine(diff,"src/file.js",2),true);
 assert.equal(git.isAddedDiffLine(diff,"src/file.js",3),true);
 assert.equal(git.isAddedDiffLine(diff,"src/file.js",1),false);
 assert.equal(git.isAddedDiffLine(diff,"other.js",2),false);
});

test("tracks per-file history and line-level blame against a selected ref",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.commitFile(id,"main","src/history.js","export const first = true;\n","Add first line",author);
 await git.commitFile(id,"main","src/history.js","export const first = true;\nexport const second = true;\n","Add second line",author);
 const history=await git.fileHistory(id,"main","src/history.js",20);
 assert.equal(history.length,2);
 assert.match(history[0].message,/Add second line/);
 assert.match(history[1].message,/Add first line/);
 const blame=await git.fileBlame(id,"main","src/history.js");
 assert.equal(blame.path,"src/history.js");
 assert.equal(blame.lines.length,2);
 assert.equal(blame.lines[0].line,1);
 assert.equal(blame.lines[1].line,2);
 assert.equal(blame.lines[0].author,"Test User");
 assert.ok(blame.lines[0].sha!==blame.lines[1].sha);
 assert.match(blame.lines[1].content,/second = true/);
});

test("deletes only fully merged non-default branches and protects stale refs",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const mainHead=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 await assert.rejects(()=>git.deleteBranch(id,"main","main",mainHead),e=>e.code==="DEFAULT_BRANCH_PROTECTED");
 await git.createBranch(id,"feature/not-merged","main");
 const side=await git.commitFile(id,"feature/not-merged","side.js","export const side = true;","Add side branch change",author);
 const sideHead=(await git.listBranches(id)).find(item=>item.name==="feature/not-merged").sha;
 await assert.rejects(()=>git.deleteBranch(id,"feature/not-merged","main",mainHead),e=>e.code==="BRANCH_MOVED");
 await assert.rejects(()=>git.deleteBranch(id,"feature/not-merged","main",sideHead),e=>e.code==="BRANCH_NOT_MERGED");
 await git.mergeBranches(id,"feature/not-merged","main",mainHead);
 const mergedHead=(await git.listBranches(id)).find(item=>item.name==="feature/not-merged").sha;
 const deleted=await git.deleteBranch(id,"feature/not-merged","main",mergedHead);
 assert.equal(deleted.deletedHead,side.sha);
 assert.ok(!(await git.listBranches(id)).some(item=>item.name==="feature/not-merged"));
});

test("previews a three-way conflict and resolves it into a real two-parent merge commit",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/conflict-editor","main");
 await git.commitFile(id,"feature/conflict-editor","README.md","# source version\n","Change README on source",author);
 await git.commitFile(id,"main","README.md","# target version\n","Change README on target",author);
 const targetHead=(await git.listBranches(id)).find(item=>item.name==="main").sha;
 const sourceHead=(await git.listBranches(id)).find(item=>item.name==="feature/conflict-editor").sha;
 const preview=await git.previewMerge(id,"feature/conflict-editor","main");
 assert.equal(preview.canMerge,false);
 assert.equal(preview.targetHead,targetHead);
 assert.equal(preview.sourceSha,sourceHead);
 assert.equal(preview.conflictFiles.length,1);
 const conflict=preview.conflictFiles[0];
 assert.equal(conflict.path,"README.md");
 assert.equal(conflict.canEdit,true);
 assert.match(conflict.base,/test-project/);
 assert.match(conflict.ours,/target version/);
 assert.match(conflict.theirs,/source version/);
 assert.match(conflict.merged,/<<<<<<< HEAD/);
 await assert.rejects(
  ()=>git.resolveMergeConflicts(id,"feature/conflict-editor","main",targetHead,sourceHead,[],author),
  error=>error.code==="CONFLICT_SET_CHANGED"
 );
 const resolution="# reconciled version\n";
 const result=await git.resolveMergeConflicts(
  id,"feature/conflict-editor","main",targetHead,sourceHead,
  [{path:"README.md",content:resolution}],author
 );
 assert.equal(result.merged,true);
 assert.deepEqual(result.resolvedFiles,["README.md"]);
 assert.equal((await git.readFile(id,"main","README.md")).content,resolution);
 const graph=await git.listCommitGraph(id,"main",10);
 const merge=graph.commits.find(item=>item.sha===result.mergeCommit);
 assert.equal(merge.parents.length,2);
 assert.ok(merge.parents.includes(targetHead));
 assert.ok(merge.parents.includes(sourceHead));
});

test("rejects a merge resolution when either branch moved after the preview",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/stale-merge","main");
 await git.commitFile(id,"feature/stale-merge","README.md","# source\n","Change source README",author);
 await git.commitFile(id,"main","README.md","# target\n","Change target README",author);
 const preview=await git.previewMerge(id,"feature/stale-merge","main");
 const sourceHead=(await git.listBranches(id)).find(item=>item.name==="feature/stale-merge").sha;
 await git.commitFile(id,"feature/stale-merge","source-extra.js","export const changed = true;\n","Move source after preview",author);
 await assert.rejects(
  ()=>git.resolveMergeConflicts(id,"feature/stale-merge","main",preview.targetHead,sourceHead,preview.conflictFiles.map(item=>({path:item.path,content:"resolved\n"})),author),
  error=>error.code==="BRANCH_MOVED"
 );
});

test("computes real contribution heatmap, author rankings and file activity from Git history",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Analytics Author",email:"analytics@codevault.local"};
 await git.commitFile(id,"main","src/analytics.js","export const first = true;\\n","Add analytics file",author);
 await git.commitFile(id,"main","src/analytics.js","export const first = true;\\nexport const second = true;\\n","Extend analytics file",author);
 const stats=await git.getContributionStats(id,"all",30);
 assert.equal(stats.windowDays,30);
 assert.equal(stats.totalCommits,3);
 assert.equal(stats.contributorCount,2);
 assert.equal(stats.authors[0].name,"Analytics Author");
 assert.equal(stats.authors[0].commits,2);
 assert.equal(stats.daily.length,30);
 assert.equal(stats.daily.reduce((sum,item)=>sum+item.commits,0),3);
 assert.ok(stats.additions>=2);
 assert.ok(stats.hotFiles.some(file=>file.path==="src/analytics.js"));
});

test("reports exact npm inventory and requires a lockfile before vulnerability results",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const manifest={name:"inventory-fixture",dependencies:{"alpha-lib":"^1.2.0"},devDependencies:{"test-helper":"~3.0.0"}};
 await git.commitFile(id,"main","package.json",JSON.stringify(manifest,null,2),"Add npm manifest",author);
 const report=await dependencyScanner.scanDependencies(id,"main");
 assert.equal(report.status,"lockfile_required");
 assert.equal(report.manifestCount,1);
 assert.equal(report.packageCount,2);
 assert.ok(report.dependencies.some(item=>item.name==="alpha-lib"&&item.requested==="^1.2.0"));
 assert.deepEqual(report.findings,[]);
});

test("scans exact npm lockfile versions against OSV and returns patched-version hints",async()=>{
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 const lock={
  name:"lock-fixture",
  lockfileVersion:3,
  packages:{
   "":{name:"lock-fixture"},
   "node_modules/foo":{"version":"1.0.0"},
   "node_modules/@scope/bar":{"version":"2.0.0"}
  }
 };
 await git.commitFile(id,"main","package-lock.json",JSON.stringify(lock),"Add npm lockfile",author);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith("/v1/querybatch")){
   const body=JSON.parse(options.body);
   return {ok:true,json:async()=>({results:body.queries.map(query=>query.package.name==="foo"?{vulns:[{id:"GHSA-test"}]}:{})})};
  }
  return {ok:true,json:async()=>({
   id:"GHSA-test",
   summary:"Test vulnerability in foo",
   published:"2026-01-01T00:00:00Z",
   modified:"2026-02-01T00:00:00Z",
   database_specific:{severity:"HIGH"},
   affected:[{package:{name:"foo"},ranges:[{events:[{introduced:"0"},{fixed:"1.2.3"}]}]}]
  })};
 };
 try{
  const report=await dependencyScanner.scanDependencies(id,"main");
  assert.equal(report.status,"scanned");
  assert.equal(report.packageCount,2);
  assert.equal(report.scannedPackageCount,2);
  assert.equal(report.vulnerabilityCount,1);
  assert.equal(report.findings.length,1);
  assert.equal(report.findings[0].package,"foo");
  assert.equal(report.findings[0].severity,"high");
  assert.deepEqual(report.findings[0].fixedVersions,["1.2.3"]);
  assert.equal(report.summary.high,1);
 }finally{
  globalThis.fetch=originalFetch;
 }
});

test("extracts deduplicated resolved npm dependencies from lockfile layouts",()=>{
 const entries=dependencyScanner.extractNpmPackages({
  lockfileVersion:3,
  packages:{
   "":{name:"demo"},
   "node_modules/demo-a":{version:"1.0.0"},
   "node_modules/demo-b":{version:"2.0.0"},
   "node_modules/nested/node_modules/demo-a":{version:"1.0.0"}
  }
 });
 assert.equal(entries.length,2);
 assert.ok(entries.some(item=>item.name==="demo-a"&&item.version==="1.0.0"));
 assert.ok(entries.some(item=>item.name==="demo-b"&&item.version==="2.0.0"));
});

test("extracts only exact pinned Python requirements and normalizes package names",()=>{
 const entries=dependencyScanner.extractPythonRequirements([
  "# production dependencies",
  "Requests==2.31.0",
  "my_package==1.2.3 ; python_version >= '3.10'",
  "unpinned>=1.0",
  "editable-package @ git+https://example.com/repo.git",
  "Flask==3.0.0 # pinned"
 ].join("\n"));
 assert.equal(entries.length,2);
 assert.ok(entries.some(item=>item.name==="requests"&&item.version==="2.31.0"&&item.ecosystem==="PyPI"));
 assert.ok(entries.some(item=>item.name==="flask"&&item.version==="3.0.0"));
});

test("scans pinned Python requirements through OSV without treating ranges as exact versions",async()=>{
 const id=await makeRepo();
 await git.commitFile(id,"main","requirements.txt","requests==2.31.0\nflask>=3.0\n","Add Python requirements",{username:"testuser",displayName:"Test User",email:"test@codevault.local"});
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith("/v1/querybatch")){
   const body=JSON.parse(options.body);
   assert.equal(body.queries.length,1);
   assert.deepEqual(body.queries[0],{package:{name:"requests",ecosystem:"PyPI"},version:"2.31.0"});
   return {ok:true,json:async()=>({results:[{}]})};
  }
  throw new Error("Unexpected OSV detail request");
 };
 try{
  const report=await dependencyScanner.scanDependencies(id,"main");
  assert.equal(report.status,"scanned");
  assert.equal(report.packageCount,1);
  assert.deepEqual(report.ecosystems,["PyPI"]);
  assert.deepEqual(report.requirementsFiles,["requirements.txt"]);
 }finally{globalThis.fetch=originalFetch;}
});


test("rejects a pull-request merge when the reviewed source branch advances", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/reviewed","main");
 const reviewed = await git.commitFile(
  id,"feature/reviewed","reviewed.js","export const reviewed = true;\n",
  "Add reviewed implementation",author
 );
 const targetHead = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 await git.commitFile(
  id,"feature/reviewed","unreviewed.js","export const unreviewed = true;\n",
  "Add unreviewed follow-up",author
 );
 const sourceHead = (await git.listBranches(id)).find(branch => branch.name === "feature/reviewed").sha;
 assert.notEqual(sourceHead,reviewed.sha);
 await assert.rejects(
  () => git.mergeBranches(id,"feature/reviewed","main",targetHead,reviewed.sha),
  error => error.code === "BRANCH_MOVED"
 );
 const unchangedTarget = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 assert.equal(unchangedTarget,targetHead);
 assert.ok(!(await git.listFiles(id,"main")).some(file => file.path === "reviewed.js"));
});

test("merges the exact reviewed source SHA rather than resolving a changed ref again", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/pinned","main");
 const reviewed = await git.commitFile(
  id,"feature/pinned","pinned.js","export const pinned = true;\n",
  "Add reviewed snapshot",author
 );
 const targetHead = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 const result = await git.mergeBranches(id,"feature/pinned","main",targetHead,reviewed.sha);
 assert.equal(result.sourceSha,reviewed.sha);
 assert.equal(result.target,"main");
 const targetFiles = await git.listFiles(id,"main");
 assert.ok(targetFiles.some(file => file.path === "pinned.js"));
});



test("reconciles a merge completed before database finalization", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/recovery-completed","main");
 const source = await git.commitFile(
  id,"feature/recovery-completed","recovered.js","export const recovered = true;\n",
  "Add recoverable feature",author
 );
 const targetSha = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 await git.mergeBranches(id,"feature/recovery-completed","main",targetSha,source.sha);
 const inspection = await git.inspectPullRequestMerge(id,{
  sourceBranch:"feature/recovery-completed",
  targetBranch:"main",
  sourceSha:source.sha,
  targetSha
 });
 assert.equal(inspection.state,"completed");
 assert.equal(inspection.mergeCommit,(await git.listCommits(id,"main",1))[0].sha);
});

test("proves a merge did not occur when both pinned refs are unchanged", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/recovery-pending","main");
 const source = await git.commitFile(
  id,"feature/recovery-pending","pending.js","export const pending = true;\n",
  "Add pending feature",author
 );
 const targetSha = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 const inspection = await git.inspectPullRequestMerge(id,{
  sourceBranch:"feature/recovery-pending",
  targetBranch:"main",
  sourceSha:source.sha,
  targetSha
 });
 assert.equal(inspection.state,"not_completed");
});

test("recognizes a source already contained in the target as a completed no-op", async () => {
 const id = await makeRepo();
 const targetSha = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 await git.createBranch(id,"feature/recovery-noop",targetSha);
 const inspection = await git.inspectPullRequestMerge(id,{
  sourceBranch:"feature/recovery-noop",
  targetBranch:"main",
  sourceSha:targetSha,
  targetSha
 });
 assert.equal(inspection.state,"completed");
 assert.equal(inspection.noOp,true);
 assert.equal(inspection.mergeCommit,targetSha);
});

test("preserves an ambiguous claim when the target moves without containing the source", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/recovery-ambiguous","main");
 const source = await git.commitFile(
  id,"feature/recovery-ambiguous","ambiguous.js","export const ambiguous = true;\n",
  "Add ambiguous feature",author
 );
 const targetSha = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 await git.commitFile(
  id,"main","unrelated.js","export const unrelated = true;\n",
  "Advance target independently",author
 );
 const inspection = await git.inspectPullRequestMerge(id,{
  sourceBranch:"feature/recovery-ambiguous",
  targetBranch:"main",
  sourceSha:source.sha,
  targetSha
 });
 assert.equal(inspection.state,"ambiguous");
});

test("preserves an ambiguous claim when a recorded source ref is unavailable", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/recovery-missing","main");
 const source = await git.commitFile(
  id,"feature/recovery-missing","missing-ref.js","export const missingRef = true;\n",
  "Add source before ref cleanup",author
 );
 const targetSha = (await git.listBranches(id)).find(branch => branch.name === "main").sha;
 await git.mergeBranches(id,"feature/recovery-missing","main",targetSha,source.sha);
 await git.deleteBranch(id,"feature/recovery-missing","main",source.sha);
 const inspection = await git.inspectPullRequestMerge(id,{
  sourceBranch:"feature/recovery-missing",
  targetBranch:"main",
  sourceSha:source.sha,
  targetSha
 });
 assert.equal(inspection.state,"ambiguous");
});

test("returns all commit dates since a cutoff without the latest-100 history cap", async () => {
 const id=await makeRepo();
 const author={username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 for(let index=0;index<105;index++){
  await git.commitFile(
   id,"main","activity-"+index+".js",
   "export const activity"+index+" = true;\n",
   "Add activity "+index,author
  );
 }
 const cutoff=new Date(Date.now()-10*60*1000);
 const dates=await git.listCommitDatesSince(id,"main",cutoff);
 assert.equal(dates.length,106);
 assert.ok(dates.every(value=>!Number.isNaN(Date.parse(value))));
 await assert.rejects(
  ()=>git.listCommitDatesSince(id,"main","not-a-date"),
  error=>error.code==="INVALID_COMMIT_DATE"
 );
});


test("exports a verified Git bundle that restores branches, tags and full commit history", async () => {
 const id = await makeRepo();
 const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
 await git.createBranch(id,"feature/backup","main");
 const source = await git.commitFile(
  id,"feature/backup","src/backup.js","export const backupReady = true;\\n",
  "Add portable backup fixture",author
 );
 await git.createTag(id,"v1.0.0","feature/backup","CodeVault backup fixture",author);
 await fs.writeFile(path.join(git.repositoryPath(id),"untracked.js"),"not part of committed history\\n");

 const backup = await git.createRepositoryBundle(id);
 const restoredPath = path.join(temp,"restored-"+id+".git");
 const workingPath = path.join(temp,"restored-working-"+id);
 try {
  assert.ok(backup.sizeBytes > 0);
  assert.match(backup.sha256,/^[a-f0-9]{64}$/);
  assert.ok(backup.refs.some(ref=>ref.ref==="refs/heads/main"));
  assert.ok(backup.refs.some(ref=>ref.ref==="refs/heads/feature/backup"&&ref.sha===source.sha));
  assert.ok(backup.refs.some(ref=>ref.ref==="refs/tags/v1.0.0"));

  const bytes = await fs.readFile(backup.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),backup.sha256);

  const restoreResult = await restoreGitBundle({
   bundlePath: backup.path,
   targetPath: restoredPath,
   defaultBranch: "main"
  });
  assert.equal(restoreResult.branchCount,2);
  assert.equal(restoreResult.tagCount,1);
  assert.equal(restoreResult.defaultBranch,"main");

  const restoredRefs = execFileSync("git",[
   "for-each-ref","--format=%(refname)"
  ],{cwd:restoredPath,encoding:"utf8"}).trim().split(/\r?\n/);
  const restoredBranches = restoredRefs.filter(ref=>ref.startsWith("refs/heads/"));
  const restoredTags = restoredRefs.filter(ref=>ref.startsWith("refs/tags/"));
  const restoredFiles = execFileSync("git",[
   "ls-tree","-r","--name-only","refs/heads/feature/backup"
  ],{cwd:restoredPath,encoding:"utf8"}).trim().split(/\r?\n/);

  assert.ok(restoredBranches.includes("refs/heads/main"),"Restored refs: "+JSON.stringify(restoredRefs)+"; bundle refs: "+JSON.stringify(backup.refs));
  assert.ok(restoredBranches.includes("refs/heads/feature/backup"));
  assert.ok(restoredTags.includes("refs/tags/v1.0.0"));
  assert.ok(restoredFiles.includes("src/backup.js"));
  assert.ok(!restoredFiles.includes("untracked.js"));
  assert.equal(
   execFileSync("git",["rev-parse","refs/heads/feature/backup"],{cwd:restoredPath,encoding:"utf8"}).trim(),
   source.sha
  );

  execFileSync("git",["symbolic-ref","HEAD","refs/heads/main"],{cwd:restoredPath,stdio:"pipe"});
  execFileSync("git",["clone","--quiet",restoredPath,workingPath],{stdio:"pipe"});
  assert.ok((await fs.readdir(workingPath)).includes("README.md"));
 } finally {
  await fs.rm(backup.directory,{recursive:true,force:true});
  await fs.rm(restoredPath,{recursive:true,force:true});
  await fs.rm(workingPath,{recursive:true,force:true});
 }
});

test("removes temporary backup files when the bundle exceeds the configured limit", async () => {
 const id = await makeRepo();
 const previous = process.env.MAX_REPOSITORY_BACKUP_SIZE_MB;
 process.env.MAX_REPOSITORY_BACKUP_SIZE_MB = "1";
 try {
  const author = {username:"testuser",displayName:"Test User",email:"test@codevault.local"};
  const randomData = randomBytes(1_200_000);
  await fs.writeFile(path.join(git.repositoryPath(id),"large.bin"),randomData);
  execFileSync("git",["add","--all"],{cwd:git.repositoryPath(id),stdio:"pipe"});
  execFileSync("git",["-c","user.name=Test User","-c","user.email=test@codevault.local","commit","-m","Add backup size fixture"],{cwd:git.repositoryPath(id),stdio:"pipe"});
  await assert.rejects(
   () => git.createRepositoryBundle(id),
   error => error.code === "BACKUP_TOO_LARGE" && error.statusCode === 413
  );
 } finally {
  if(previous===undefined)delete process.env.MAX_REPOSITORY_BACKUP_SIZE_MB;
  else process.env.MAX_REPOSITORY_BACKUP_SIZE_MB=previous;
 }
});


test("refuses to overwrite an existing Git bundle restore target", async () => {
 const id = await makeRepo();
 const backup = await git.createRepositoryBundle(id);
 const targetPath = path.join(temp,"existing-restore-"+id);
 await fs.mkdir(targetPath,{recursive:false});
 await fs.writeFile(path.join(targetPath,"keep.txt"),"existing data");
 try {
  await assert.rejects(
   () => restoreGitBundle({bundlePath:backup.path,targetPath,defaultBranch:"main"}),
   error => error.code === "EEXIST"
  );
  assert.equal(await fs.readFile(path.join(targetPath,"keep.txt"),"utf8"),"existing data");
 } finally {
  await fs.rm(backup.directory,{recursive:true,force:true});
  await fs.rm(targetPath,{recursive:true,force:true});
 }
});
