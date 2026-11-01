import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-tests-"));
process.env.REPO_STORAGE_PATH=path.join(temp,"repos");
const git=await import("../src/services/git.js");
let seq=1;
async function makeRepo(){const id=(seq++).toString(16).padStart(24,"0");await git.initRepository({_id:id,name:"test-project",description:"Test repository"},{addReadme:true,authorName:"Test User",authorEmail:"test@codevault.local"});return id;}
after(async()=>fs.rm(temp,{recursive:true,force:true}));
test("creates a real Git repository with its first commit",async()=>{const id=await makeRepo();assert.ok((await git.listFiles(id)).some(f=>f.path==="README.md"));const commits=await git.listCommits(id);assert.equal(commits.length,1);assert.equal(commits[0].message,"Initial commit");assert.match(commits[0].sha,/^[a-f0-9]{40}$/);});
test("creates branches and previews an ordinary merge",async()=>{const id=await makeRepo();await git.createBranch(id,"feature/demo","main");assert.ok((await git.listBranches(id)).some(b=>b.name==="feature/demo"));const preview=await git.previewMerge(id,"feature/demo","main");assert.equal(preview.canMerge,true);});
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
 assert.ok(bySha.get(initial.sha).refs.some(ref=>ref.name==="main"&&ref.type==="branch"));
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
