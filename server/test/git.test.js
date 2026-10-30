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
