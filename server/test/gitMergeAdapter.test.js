import test,{after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-merge-adapter-tests-"));
process.env.REPO_STORAGE_PATH=path.join(temp,"repos");
const service=await import("../src/services/git.js");
after(async()=>fs.rm(temp,{recursive:true,force:true}));
const author={username:"merge-test",displayName:"Merge Test",email:"merge-test@codevault.local"};
let seq=1;
async function makeRepo(){const id=(seq++).toString(16).padStart(24,"0");await service.initRepository({_id:id,name:"merge-adapter",description:"Merge adapter tests"},{addReadme:true,authorName:author.displayName,authorEmail:author.email});return id;}
function git(root,args,env={}){return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1",...env}}).trim();}
async function heads(id){return Object.fromEntries((await service.listBranches(id)).map(x=>[x.name,x.sha]));}
function parents(root,sha){return git(root,["rev-list","--parents","-n","1",sha]).split(" ").slice(1);}
function newCommit(root,parent,msg){const tree=git(root,["rev-parse",parent+"^{tree}"]);return git(root,["commit-tree",tree,"-p",parent,"-m",msg],{GIT_AUTHOR_NAME:author.displayName,GIT_AUTHOR_EMAIL:author.email,GIT_COMMITTER_NAME:author.displayName,GIT_COMMITTER_EMAIL:author.email});}
async function feature(id,name="feature/merge"){await service.createBranch(id,name,"main");return (await service.commitFile(id,name,"src/feature.js","export const feature = true;\n","Add merge feature",author)).sha;}
function operationCommits(root,id){return git(root,["log","--format=%H","--fixed-strings","--grep=CodeVault-Operation-Id: "+id,"refs/heads/main"]).split(/\r?\n/).filter(Boolean);}

test("ordinary merge publishes an adapter-backed two-parent commit",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id);
 const result=await service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:"merge-ordinary-001",author});
 assert.deepEqual(parents(root,result.mergeCommit),[before.main,source]);
 assert.equal((await heads(id)).main,result.mergeCommit);
 assert.equal((await heads(id))["feature/merge"],source);
 assert.equal((await service.gitStorageAdapter.verifyRepository({repositoryId:id})).ok,true);
});

test("no-op and fast-forward merge semantics are preserved",async()=>{
 const id=await makeRepo(),source=await feature(id,"feature/ff"),before=await heads(id),root=service.repositoryPath(id);
 const result=await service.mergeBranches(id,"feature/ff","main",before.main,source,{operationId:"merge-ff-001",author});
 assert.deepEqual(parents(root,result.mergeCommit),[before.main,source]);
 const noop=await service.mergeBranches(id,"feature/ff","main",result.mergeCommit,source,{operationId:"merge-noop-001",author});
 assert.equal(noop.noOp,true);
});

test("failure before merge object creation leaves refs untouched and retries the same operation ID",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),op="merge-before-object-001";
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author,failureAt:"beforeObjectCreation"}),/Injected merge failure/);
 assert.equal((await heads(id)).main,before.main);
 assert.equal(operationCommits(root,op).length,0);
 const retry=await service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author});
 assert.equal(retry.merged,true);
 assert.equal(operationCommits(root,op).length,1);
});

test("failure after object persistence deterministically retries the same commit",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),op="merge-after-object-001";
 let objectSha="";
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author,failureAt:"afterObjectPersistence",onStage:(stage,d)=>{if(stage==="afterObjectPersistence")objectSha=d.commitSha;}}),/Injected merge failure/);
 assert.match(objectSha,/^[a-f0-9]{40}$/);
 assert.equal((await heads(id)).main,before.main);
 const retry=await service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author});
 assert.equal(retry.mergeCommit,objectSha);
 assert.equal(operationCommits(root,op).length,1);
});

test("journal-prepared and pre-publication failures abort an all-before state",async()=>{
 for(const [stage,suffix] of [["afterJournalPreparation","journal"],["beforeRefPublication","prepublish"]]){
  const id=await makeRepo(),source=await feature(id,"feature/"+suffix),before=await heads(id),root=service.repositoryPath(id),op="merge-"+suffix+"-001";
  await assert.rejects(()=>service.mergeBranches(id,"feature/"+suffix,"main",before.main,source,{operationId:op,author,failureAt:stage}),/Injected merge failure/);
  assert.equal((await heads(id)).main,before.main);
  const journal=JSON.parse(await fs.readFile(path.join(process.env.REPO_STORAGE_PATH,".codevault-state",id,"operations",op+".json"),"utf8"));
  assert.equal(journal.status,"aborted");
  await assert.rejects(()=>service.mergeBranches(id,"feature/"+suffix,"main",before.main,source,{operationId:op,author}),e=>["STORAGE_OPERATION_FAILED","STORAGE_OPERATION_INTERRUPTED"].includes(e.code));
 }

});

test("post-publication recovery finalizes the prepared journal and does not duplicate commits",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),op="merge-after-ref-001";
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author,failureAt:"afterRefPublication"}),/Injected merge failure/);
 const published=(await heads(id)).main;
 assert.deepEqual(parents(root,published),[before.main,source]);
 const journalPath=path.join(process.env.REPO_STORAGE_PATH,".codevault-state",id,"operations",op+".json");
 assert.equal(JSON.parse(await fs.readFile(journalPath,"utf8")).status,"prepared");
 await service.gitStorageAdapter.getGeneration({repositoryId:id});
 const recovered=JSON.parse(await fs.readFile(journalPath,"utf8"));
 assert.equal(recovered.status,"committed");
 const retry=await service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author});
 assert.equal(retry.mergeCommit,published);
 assert.equal(retry.replayed,true);
 assert.equal(operationCommits(root,op).length,1);
});

test("source movement during preparation prevents publication",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),moved=newCommit(root,source,"Advance source");
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:"merge-source-moved-001",author,onStage:stage=>{if(stage==="afterObjectPersistence")git(root,["update-ref","refs/heads/feature/merge",moved]);}}),e=>e.code==="BRANCH_MOVED");
 assert.equal((await heads(id)).main,before.main);
 assert.equal((await heads(id))["feature/merge"],moved);
});

test("target movement during preparation prevents a stale target update",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),moved=newCommit(root,before.main,"Advance target");
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:"merge-target-moved-001",author,onStage:stage=>{if(stage==="afterObjectPersistence")git(root,["update-ref","refs/heads/main",moved]);}}),e=>e.code==="BRANCH_MOVED");
 assert.equal((await heads(id)).main,moved);
 assert.equal(operationCommits(root,"merge-target-moved-001").length,0);
});

test("conflict resolution is adapter-backed and retains two merge parents",async()=>{
 const id=await makeRepo();
 await service.createBranch(id,"feature/conflict","main");
 await service.commitFile(id,"feature/conflict","README.md","# source version\n","Edit feature README",author);
 await service.commitFile(id,"main","README.md","# target version\n","Edit target README",author);
 const before=await heads(id),root=service.repositoryPath(id),preview=await service.previewMerge(id,"feature/conflict","main");
 assert.equal(preview.canMerge,false);
 const result=await service.resolveMergeConflicts(id,"feature/conflict","main",before.main,before["feature/conflict"],[{path:"README.md",content:"# resolved\n"}],author,{operationId:"merge-resolved-001"});
 assert.deepEqual(parents(root,result.mergeCommit),[before.main,before["feature/conflict"]]);
 assert.equal((await service.readFile(id,"main","README.md")).content,"# resolved\n");
});

test("PR recovery inspection reconciles an after-publication adapter journal before ancestry checks",async()=>{
 const id=await makeRepo(),source=await feature(id),before=await heads(id),root=service.repositoryPath(id),op="merge-pr-recovery-001";
 await assert.rejects(()=>service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author,operationType:"pull-request-merge",pullRequestId:"pr-1",failureAt:"afterRefPublication"}),/Injected merge failure/);
 const published=(await heads(id)).main;
 const result=await service.inspectPullRequestMerge(id,{sourceBranch:"feature/merge",targetBranch:"main",sourceSha:source,targetSha:before.main});
 assert.equal(result.state,"completed");
 assert.equal(result.mergeCommit,published);
 const retried=await service.mergeBranches(id,"feature/merge","main",before.main,source,{operationId:op,author,operationType:"pull-request-merge",pullRequestId:"pr-1"});
 assert.equal(retried.mergeCommit,published);
 assert.equal(retried.replayed,true);
});
