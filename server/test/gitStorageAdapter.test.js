import test,{after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createLocalGitStorageAdapter} from "../src/services/gitStorageAdapter.js";

const temp=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-storage-adapter-"));
after(async()=>fs.rm(temp,{recursive:true,force:true}));

const serviceStorage=path.join(temp,"service-integration-storage");
process.env.REPO_STORAGE_PATH=serviceStorage;
const gitService=await import("../src/services/git.js");

function git(cwd,args,extraEnv={}){
 return execFileSync("git",args,{
  cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],
  env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1",...extraEnv}
 }).trim();
}

async function makeWorkingRepository(root){
 await fs.mkdir(root,{recursive:true});
 git(root,["init","--initial-branch=main"]);
 git(root,["config","user.name","Adapter Test"]);
 git(root,["config","user.email","adapter-test@codevault.local"]);
 await fs.writeFile(path.join(root,"README.md"),"# adapter fixture\n");
 git(root,["add","README.md"]);
 git(root,["commit","-m","Initial fixture"]);
 return git(root,["rev-parse","refs/heads/main"]);
}

function nextCommit(root,parent,message){
 const tree=git(root,["rev-parse",parent+"^{tree}"]);
 return git(root,["commit-tree",tree,"-p",parent,"-m",message],{
  GIT_AUTHOR_NAME:"Adapter Test",
  GIT_AUTHOR_EMAIL:"adapter-test@codevault.local",
  GIT_COMMITTER_NAME:"Adapter Test",
  GIT_COMMITTER_EMAIL:"adapter-test@codevault.local"
 });
}

function createSharedLock(){
 const queues=new Map();
 return async(repositoryId,callback)=>{
  const previous=queues.get(repositoryId)||Promise.resolve();
  let release;
  const turn=new Promise(resolve=>{release=resolve;});
  const queued=previous.then(()=>turn);
  queues.set(repositoryId,queued);
  await previous;
  try{return await callback({fence:1});}
  finally{
   release();
   if(queues.get(repositoryId)===queued)queues.delete(repositoryId);
  }
 };
}

function adapter(root,withLease){
 return createLocalGitStorageAdapter({storageRoot:root,withLease});
}

const id="a".repeat(24);

test("local adapter compare-and-swaps a ref and makes operation retries idempotent",async()=>{
 const storage=path.join(temp,"cas-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const next=nextCommit(root,initial,"Second fixture");
 const gitStorage=adapter(storage);
 const result=await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:next,
  expectedGeneration:0,operationId:"adapter-cas-0001",fencingToken:1
 });
 assert.equal(result.generation,1);
 assert.equal((await gitStorage.readRef({repositoryId:id,ref:"refs/heads/main"})),next);
 const retry=await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:next,
  expectedGeneration:0,operationId:"adapter-cas-0001",fencingToken:1
 });
 assert.deepEqual(retry,result);
 assert.equal(await gitStorage.getGeneration({repositoryId:id}),1);
});

test("rejects operation ID reuse with a different payload",async()=>{
 const storage=path.join(temp,"idempotency-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const first=nextCommit(root,initial,"First target");
 const second=nextCommit(root,initial,"Different target");
 const gitStorage=adapter(storage);
 await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:first,
  expectedGeneration:0,operationId:"adapter-idem-01",fencingToken:1
 });
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:second,
   expectedGeneration:0,operationId:"adapter-idem-01",fencingToken:1
  }),
  error=>error.code==="STORAGE_OPERATION_ID_REUSED"
 );
});

test("rejects stale generations and stale fencing tokens before publishing refs",async()=>{
 const storage=path.join(temp,"stale-writer-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const first=nextCommit(root,initial,"Accepted writer");
 const second=nextCommit(root,initial,"Stale writer");
 const gitStorage=adapter(storage);
 await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:first,
  expectedGeneration:0,operationId:"adapter-fence-01",fencingToken:7
 });
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:first,newObjectId:second,
   expectedGeneration:1,operationId:"adapter-fence-02",fencingToken:6
  }),
  error=>error.code==="STORAGE_FENCE_STALE"
 );
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:first,newObjectId:second,
   expectedGeneration:0,operationId:"adapter-fence-03",fencingToken:8
  }),
  error=>error.code==="STORAGE_GENERATION_CONFLICT"
 );
 assert.equal((await gitStorage.readRef({repositoryId:id,ref:"refs/heads/main"})),first);
});

test("serializes independent adapter instances so only one stale-head writer succeeds",async()=>{
 const storage=path.join(temp,"concurrent-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const first=nextCommit(root,initial,"Concurrent A");
 const second=nextCommit(root,initial,"Concurrent B");
 const lock=createSharedLock();
 const left=adapter(storage,lock);
 const right=adapter(storage,lock);
 const attempts=await Promise.allSettled([
  left.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:first,
   expectedGeneration:0,operationId:"adapter-race-0001",fencingToken:1
  }),
  right.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:second,
   expectedGeneration:0,operationId:"adapter-race-0002",fencingToken:1
  })
 ]);
 assert.equal(attempts.filter(item=>item.status==="fulfilled").length,1);
 assert.equal(attempts.filter(item=>item.status==="rejected").length,1);
 const rejection=attempts.find(item=>item.status==="rejected").reason;
 assert.equal(rejection.code,"STORAGE_GENERATION_CONFLICT");
 assert.equal(await left.getGeneration({repositoryId:id}),1);
});

test("recovers a crash after ref publication but before the operation journal is finalized",async()=>{
 const storage=path.join(temp,"recover-published-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const next=nextCommit(root,initial,"Published before crash");
 const gitStorage=adapter(storage);
 await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:next,
  expectedGeneration:0,operationId:"adapter-recover-01",fencingToken:1
 });
 const stateDir=path.join(storage,".codevault-state",id);
 const operationFile=path.join(stateDir,"operations","adapter-recover-01.json");
 const operation=JSON.parse(await fs.readFile(operationFile,"utf8"));
 operation.status="prepared";
 delete operation.result;
 await fs.writeFile(operationFile,JSON.stringify(operation));
 await fs.writeFile(path.join(stateDir,"state.json"),JSON.stringify({generation:0,fence:0}));
 assert.equal(await gitStorage.getGeneration({repositoryId:id}),1);
 const recovered=JSON.parse(await fs.readFile(operationFile,"utf8"));
 assert.equal(recovered.status,"committed");
 assert.equal(recovered.result.recovered,true);
});

test("exports and imports a verified bundle with branches and annotated tags",async()=>{
 const sourceStorage=path.join(temp,"bundle-source-storage");
 const sourceRoot=path.join(sourceStorage,id);
 const initial=await makeWorkingRepository(sourceRoot);
 git(sourceRoot,["branch","feature/portable",initial]);
 git(sourceRoot,["tag","-a","v1.0.0","-m","Portable release",initial]);
 const sourceAdapter=adapter(sourceStorage);
 const bundle=await sourceAdapter.exportBundle({repositoryId:id});
 assert.ok(bundle.sizeBytes>0);
 assert.match(bundle.sha256,/^[a-f0-9]{64}$/);
 assert.ok(bundle.refs.some(item=>item.ref==="refs/heads/feature/portable"));
 assert.ok(bundle.refs.some(item=>item.ref==="refs/tags/v1.0.0"));
 const bytes=await fs.readFile(bundle.path);
 assert.equal(createHash("sha256").update(bytes).digest("hex"),bundle.sha256);

 const targetStorage=path.join(temp,"bundle-target-storage");
 const targetRoot=path.join(targetStorage,id);
 await fs.mkdir(targetRoot,{recursive:true});
 git(targetRoot,["init","--bare"]);
 const targetAdapter=adapter(targetStorage);
 try{
  const imported=await targetAdapter.importBundle({
   repositoryId:id,bundlePath:bundle.path,expectedGeneration:0,
   operationId:"adapter-import-01",fencingToken:1,defaultBranch:"main"
  });
  assert.equal(imported.generation,1);
  assert.equal(imported.refCount,3);
  const targetRefs=git(targetRoot,["for-each-ref","--format=%(refname)"]).split("\n").filter(Boolean).sort();
  assert.deepEqual(targetRefs,bundle.refs.map(item=>item.ref).sort());
  assert.equal(git(targetRoot,["symbolic-ref","HEAD"]),"refs/heads/main");
  const verified=await targetAdapter.verifyRepository({repositoryId:id});
  assert.equal(verified.ok,true);
  assert.equal(verified.checkedRefs,3);
  const repeated=await targetAdapter.importBundle({
   repositoryId:id,bundlePath:bundle.path,expectedGeneration:0,
   operationId:"adapter-import-01",fencingToken:1,defaultBranch:"main"
  });
  assert.deepEqual(repeated,{...imported,recovered:false});
 }finally{
  await fs.rm(bundle.directory,{recursive:true,force:true});
 }
});

test("rejects missing objects, invalid refs and a malformed repository identifier",async()=>{
 const storage=path.join(temp,"validation-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const gitStorage=adapter(storage);
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/not-valid",expectedObjectId:null,newObjectId:"f".repeat(40),
   expectedGeneration:0,operationId:"adapter-invalid-01",fencingToken:1
  }),
  error=>["GIT_STORAGE_OPERATION_FAILED","GIT_OBJECT_MISSING"].includes(error.code)
 );
 await assert.rejects(
  ()=>gitStorage.readRef({repositoryId:"../outside",ref:"refs/heads/main"}),
  error=>error.code==="INVALID_REPOSITORY_ID"
 );
 assert.equal((await gitStorage.readRef({repositoryId:id,ref:"refs/heads/main"})),initial);
});


test("existing Git service delegates repository paths, branch publishing, backups and verification to the local adapter",async()=>{
 const repositoryId="b".repeat(24);
 await gitService.initRepository(
  {_id:repositoryId,name:"adapter-integration",description:"Storage adapter integration fixture"},
  {addReadme:true,authorName:"Adapter Integration",authorEmail:"adapter-integration@codevault.local"}
 );
 assert.equal(gitService.repositoryPath(repositoryId),path.join(serviceStorage,repositoryId));
 await gitService.createBranch(repositoryId,"feature/adapter-integration","main");
 assert.equal(await gitService.gitStorageAdapter.getGeneration({repositoryId}),1);
 const branches=await gitService.listBranches(repositoryId);
 assert.ok(branches.some(item=>item.name==="feature/adapter-integration"));
 const backup=await gitService.createRepositoryBundle(repositoryId);
 try{
  assert.ok(backup.refs.some(item=>item.ref==="refs/heads/main"));
  assert.ok(backup.refs.some(item=>item.ref==="refs/heads/feature/adapter-integration"));
  const verification=await gitService.verifyGitRepository(repositoryId);
  assert.equal(verification.ok,true);
  assert.equal(verification.checkedRefs,2);
 }finally{
  await fs.rm(backup.directory,{recursive:true,force:true});
 }
});


test("detects refs changed by legacy Git writers and advances the observed generation",async()=>{
 const storage=path.join(temp,"legacy-writer-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const gitStorage=adapter(storage);
 assert.equal(await gitStorage.getGeneration({repositoryId:id}),0);
 git(root,["branch","feature/legacy-writer",initial]);
 assert.equal(await gitStorage.getGeneration({repositoryId:id}),1);
 const next=nextCommit(root,initial,"Adapter after legacy writer");
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/main",expectedObjectId:initial,newObjectId:next,
   expectedGeneration:0,operationId:"adapter-stale-observed",fencingToken:1
  }),
  error=>error.code==="STORAGE_GENERATION_CONFLICT"
 );
 assert.equal((await gitStorage.readRef({repositoryId:id,ref:"refs/heads/main"})),initial);
});


test("rechecks the active MongoDB lease before each adapter Git command",async()=>{
 const storage=path.join(temp,"lost-lease-storage");
 const root=path.join(storage,id);
 await makeWorkingRepository(root);
 let assertions=0;
 const lostLease=async(_repositoryId,callback)=>callback({
  fence:12,
  assertOwned:async()=>{
   assertions++;
   if(assertions>=2){
    const error=new Error("Repository lease was lost.");
    error.code="REPOSITORY_LOCK_LOST";
    throw error;
   }
  }
 });
 const gitStorage=adapter(storage,lostLease);
 await assert.rejects(
  ()=>gitStorage.readRef({repositoryId:id,ref:"refs/heads/main"}),
  error=>error.code==="REPOSITORY_LOCK_LOST"
 );
 assert.equal(assertions,2);
});

test("deletes a ref only when its expected object ID matches",async()=>{
 const storage=path.join(temp,"delete-ref-storage");
 const root=path.join(storage,id);
 const initial=await makeWorkingRepository(root);
 const next=nextCommit(root,initial,"Move branch before safe deletion");
 git(root,["update-ref","refs/heads/feature/delete-me",next]);
 const gitStorage=adapter(storage);
 await assert.rejects(
  ()=>gitStorage.compareAndSwapRef({
   repositoryId:id,ref:"refs/heads/feature/delete-me",expectedObjectId:initial,newObjectId:null,
   expectedGeneration:0,operationId:"adapter-delete-stale",fencingToken:1
  }),
  error=>error.code==="STORAGE_REF_CONFLICT"||error.code==="STORAGE_GENERATION_CONFLICT"
 );
 const generation=await gitStorage.getGeneration({repositoryId:id});
 const deleted=await gitStorage.compareAndSwapRef({
  repositoryId:id,ref:"refs/heads/feature/delete-me",expectedObjectId:next,newObjectId:null,
  expectedGeneration:generation,operationId:"adapter-delete-correct",fencingToken:1
 });
 assert.equal(deleted.generation,generation+1);
 assert.equal(await gitStorage.readRef({repositoryId:id,ref:"refs/heads/feature/delete-me"}),null);
});


test("file commits use a temporary Git index and publish through the adapter without switching the worktree",async()=>{
 const repositoryId="c".repeat(24);
 await gitService.initRepository(
  {_id:repositoryId,name:"object-pipeline",description:"File commit pipeline fixture"},
  {addReadme:true,authorName:"Pipeline Test",authorEmail:"pipeline-test@codevault.local"}
 );
 const root=gitService.repositoryPath(repositoryId);
 const worktreeHead=git(root,["rev-parse","HEAD"]);
 await gitService.createBranch(repositoryId,"feature/object-commit","main");
 const branchHead=git(root,["rev-parse","refs/heads/feature/object-commit"]);
 const result=await gitService.commitFile(
  repositoryId,"feature/object-commit","nested/created.txt","Hello from the object pipeline\n",
  "Add file through object pipeline",
  {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"},
  {expectedHead:branchHead}
 );
 assert.equal(result.parentSha,branchHead);
 assert.equal(result.generation,2);
 assert.equal(git(root,["rev-parse","HEAD"]),worktreeHead);
 assert.equal(git(root,["branch","--show-current"]),"main");
 assert.equal(git(root,["rev-parse","refs/heads/main"]),worktreeHead);
 assert.equal(git(root,["show","refs/heads/feature/object-commit:nested/created.txt"]),"Hello from the object pipeline");
 await assert.rejects(()=>fs.access(path.join(root,"nested","created.txt")),error=>error.code==="ENOENT");
 assert.equal(git(root,["status","--porcelain"]),"");
});

test("file commits reject stale editor heads without moving the branch",async()=>{
 const repositoryId="d".repeat(24);
 await gitService.initRepository(
  {_id:repositoryId,name:"stale-file-commit",description:"Stale commit fixture"},
  {addReadme:true,authorName:"Pipeline Test",authorEmail:"pipeline-test@codevault.local"}
 );
 const root=gitService.repositoryPath(repositoryId);
 const staleHead=git(root,["rev-parse","refs/heads/main"]);
 const first=await gitService.commitFile(
  repositoryId,"main","README.md","# First update\n","First file update",
  {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"},
  {expectedHead:staleHead}
 );
 await assert.rejects(
  ()=>gitService.commitFile(
   repositoryId,"main","README.md","# Stale update\n","Stale file update",
   {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"},
   {expectedHead:staleHead}
  ),
  error=>error.code==="BRANCH_MOVED"
 );
 assert.equal(git(root,["rev-parse","refs/heads/main"]),first.sha);
 assert.equal(git(root,["show","refs/heads/main:README.md"]),"# First update");
});

test("file commits preserve executable mode and reject symlink targets and parents",async()=>{
 const repositoryId="e".repeat(24);
 await gitService.initRepository(
  {_id:repositoryId,name:"file-mode-safety",description:"File mode fixture"},
  {addReadme:true,authorName:"Pipeline Test",authorEmail:"pipeline-test@codevault.local"}
 );
 const root=gitService.repositoryPath(repositoryId);
 const executable=path.join(root,"tool.sh");
 await fs.writeFile(executable,"#!/bin/sh\necho old\n",{encoding:"utf8",mode:0o755});
 await fs.chmod(executable,0o755);
 git(root,["add","tool.sh"]);
 git(root,["commit","-m","Add executable fixture"]);
 await fs.symlink("tool.sh",path.join(root,"link.sh"));
 git(root,["add","link.sh"]);
 git(root,["commit","-m","Add symlink fixture"]);
 const head=git(root,["rev-parse","refs/heads/main"]);
 const updated=await gitService.commitFile(
  repositoryId,"main","tool.sh","#!/bin/sh\necho new\n","Update executable fixture",
  {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"},
  {expectedHead:head}
 );
 const mode=git(root,["ls-tree",updated.sha,"--","tool.sh"]).split(" ")[0];
 assert.equal(mode,"100755");
 await assert.rejects(
  ()=>gitService.commitFile(
   repositoryId,"main","link.sh","replacement","Replace symlink",
   {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"}
  ),
  error=>error.code==="SYMLINK_PATH_NOT_ALLOWED"
 );
 await assert.rejects(
  ()=>gitService.commitFile(
   repositoryId,"main","link.sh/child.txt","replacement","Write through symlink",
   {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"}
  ),
  error=>error.code==="SYMLINK_PATH_NOT_ALLOWED"
 );
});


test("file commits refresh a clean checked-out branch for existing worktree-based Git operations",async()=>{
 const repositoryId="f".repeat(24);
 await gitService.initRepository(
  {_id:repositoryId,name:"active-worktree-refresh",description:"Active worktree refresh fixture"},
  {addReadme:true,authorName:"Pipeline Test",authorEmail:"pipeline-test@codevault.local"}
 );
 const root=gitService.repositoryPath(repositoryId);
 const initial=git(root,["rev-parse","HEAD"]);
 const result=await gitService.commitFile(
  repositoryId,"main","src/active-branch.js","export const active = true;\n",
  "Commit on checked-out branch",
  {displayName:"Pipeline Test",email:"pipeline-test@codevault.local"},
  {expectedHead:initial}
 );
 assert.equal(result.worktreeSynced,true);
 assert.equal(git(root,["rev-parse","HEAD"]),result.sha);
 assert.equal(git(root,["show","src/active-branch.js"]),"export const active = true;");
 assert.equal(git(root,["status","--porcelain","--untracked-files=all"]),"");
});
