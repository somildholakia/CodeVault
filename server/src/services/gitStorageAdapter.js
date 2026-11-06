import {createHash,randomUUID} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import {execFile,spawn} from "node:child_process";
import {createReadStream} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {AppError} from "../utils/errors.js";

const execFileAsync=promisify(execFile);
const adapterLeaseContext=new AsyncLocalStorage();
const SHA_PATTERN=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const REPOSITORY_ID_PATTERN=/^[a-f0-9]{24}$/i;
const OPERATION_ID_PATTERN=/^[A-Za-z0-9_-]{8,128}$/;
const MAX_GIT_OUTPUT=8*1024*1024;

function repositoryId(value){
 const id=String(value||"");
 if(!REPOSITORY_ID_PATTERN.test(id))throw new AppError(400,"INVALID_REPOSITORY_ID","Invalid repository identifier.");
 return id;
}

function safeRef(value){
 if(typeof value!=="string"||!value||value.length>255||value.startsWith("-")||value.includes(" ")||value.includes("\0"))throw new AppError(400,"INVALID_GIT_REF","A valid fully-qualified Git ref is required.");
 if(!value.startsWith("refs/")||value.includes("..")||value.includes("//")||value.endsWith("/")||value.endsWith(".")||value.includes("@{"))throw new AppError(400,"INVALID_GIT_REF","A valid fully-qualified Git ref is required.");
 return value;
}

function safeSha(value,allowNull=false){
 if(allowNull&&value===null)return null;
 if(typeof value!=="string"||!SHA_PATTERN.test(value))throw new AppError(400,"INVALID_OBJECT_ID","A full Git object ID is required.");
 return value.toLowerCase();
}

function operationId(value){
 if(typeof value!=="string"||!OPERATION_ID_PATTERN.test(value))throw new AppError(400,"INVALID_OPERATION_ID","Provide an operation ID containing 8–128 letters, numbers, underscores or hyphens.");
 return value;
}

function safeError(error){
 return String(error?.stderr||error?.message||error||"Git operation failed.").trim().slice(0,1200);
}

async function runGit(cwd,args,{allowMissing=false}={}){
 const assertOwned=adapterLeaseContext.getStore();
 if(assertOwned)await assertOwned();
 let result;
 try{
  result=await execFileAsync("git",args,{
   cwd,timeout:120000,maxBuffer:MAX_GIT_OUTPUT,windowsHide:true,
   env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1"}
  });
 }catch(error){
  if(assertOwned)await assertOwned();
  if(allowMissing&&error.code===1)return {stdout:"",stderr:String(error.stderr||"")};
  throw new AppError(409,"GIT_STORAGE_OPERATION_FAILED",safeError(error));
 }
 if(assertOwned)await assertOwned();
 return {stdout:String(result.stdout||""),stderr:String(result.stderr||"")};
}

function runGitInput(cwd,args,input){
 const assertOwned=adapterLeaseContext.getStore();
 return (async()=>{if(assertOwned)await assertOwned();return new Promise((resolve,reject)=>{
  const child=spawn("git",args,{
   cwd,windowsHide:true,
   env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1"}
  });
  let stdout="",stderr="",settled=false;
  const timer=setTimeout(()=>child.kill("SIGKILL"),120000);
  const append=(current,chunk)=>{
   const next=current+chunk.toString("utf8");
   if(Buffer.byteLength(next,"utf8")>MAX_GIT_OUTPUT){
    child.kill("SIGKILL");
    throw new Error("Git output exceeded the configured limit.");
   }
   return next;
  };
  child.stdout.on("data",chunk=>{try{stdout=append(stdout,chunk);}catch(error){if(!settled){settled=true;clearTimeout(timer);reject(error);}}});
  child.stderr.on("data",chunk=>{try{stderr=append(stderr,chunk);}catch(error){if(!settled){settled=true;clearTimeout(timer);reject(error);}}});
  child.on("error",error=>{
   if(settled)return;settled=true;clearTimeout(timer);reject(error);
  });
  child.on("close",(code,signal)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(code===0)resolve({stdout,stderr});
   else reject(new AppError(409,"GIT_REF_TRANSACTION_FAILED",(stderr||"Git ref transaction failed ("+String(signal||code)+").").trim().slice(0,1200)));
  });
  child.stdin.on("error",()=>{});
  child.stdin.end(input);
 });})().then(async result=>{if(assertOwned)await assertOwned();return result;},async error=>{if(assertOwned)await assertOwned();throw error;});
}

async function atomicWriteJson(file,value){
 const directory=path.dirname(file);
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const temporary=file+"."+randomUUID()+".tmp";
 let handle;
 try{
  handle=await fs.open(temporary,"wx",0o600);
  await handle.writeFile(JSON.stringify(value)+"\n","utf8");
  await handle.sync();
  await handle.close();
  handle=null;
  await fs.rename(temporary,file);
  try{const dir=await fs.open(directory,"r");try{await dir.sync();}finally{await dir.close();}}catch(error){if(!["EINVAL","ENOTSUP","EBADF","EISDIR"].includes(error.code))throw error;}
 }catch(error){
  if(handle)await handle.close().catch(()=>{});
  await fs.rm(temporary,{force:true}).catch(()=>{});
  throw error;
 }
}

async function readJson(file,fallback){
 try{return JSON.parse(await fs.readFile(file,"utf8"));}
 catch(error){if(error.code==="ENOENT")return fallback;throw new AppError(503,"GIT_STORAGE_METADATA_CORRUPT","Git storage operation metadata could not be read safely.");}
}

async function sha256File(file){
 const hash=createHash("sha256");
 for await(const chunk of createReadStream(file))hash.update(chunk);
 return hash.digest("hex");
}

function parseBundleRefs(output){
 const refs=[];
 for(const line of output.split(/\r?\n/).filter(Boolean)){
  const match=line.match(/^([a-f0-9]{40}|[a-f0-9]{64})\s+(.+)$/i);
  if(!match)throw new AppError(422,"INVALID_GIT_BUNDLE","The bundle contains an invalid ref manifest.");
  const [,sha,ref]=match;
  if(ref==="HEAD")continue;
  if(!ref.startsWith("refs/heads/")&&!ref.startsWith("refs/tags/"))throw new AppError(422,"UNSUPPORTED_BUNDLE_REF","The bundle contains an unsupported ref namespace.");
  refs.push({sha:sha.toLowerCase(),ref:safeRef(ref)});
 }
 if(!refs.length)throw new AppError(422,"EMPTY_GIT_BUNDLE","The bundle does not contain any branch or tag refs.");
 if(new Set(refs.map(item=>item.ref)).size!==refs.length)throw new AppError(422,"INVALID_GIT_BUNDLE","The bundle contains duplicate refs.");
 return refs;
}

export function createLocalGitStorageAdapter(options={}){
 const rootDirectory=path.resolve(options.storageRoot||path.join(process.cwd(),"storage","repos"));
 const stateRoot=path.resolve(options.stateRoot||path.join(rootDirectory,".codevault-state"));
 const withLease=options.withLease||((_id,callback)=>callback(null));

 function repositoryPath(id){
  const safeId=repositoryId(id);
  return path.join(rootDirectory,safeId);
 }

 function stateDirectory(id){return path.join(stateRoot,repositoryId(id));}
 function statePath(id){return path.join(stateDirectory(id),"state.json");}
 function operationsDirectory(id){return path.join(stateDirectory(id),"operations");}
 function operationPath(id,op){return path.join(operationsDirectory(id),operationId(op)+".json");}

 async function stateFor(id){
  const state=await readJson(statePath(id),{generation:0,fence:0});
  if(!Number.isSafeInteger(state.generation)||state.generation<0||!Number.isSafeInteger(state.fence)||state.fence<0||(state.refsDigest!==undefined&&state.refsDigest!==null&&!/^[a-f0-9]{64}$/.test(state.refsDigest)))throw new AppError(503,"GIT_STORAGE_STATE_INVALID","The Git storage generation state is invalid.");
  return state;
 }

 async function readRefUnlocked(root,ref){
  const result=await runGit(root,["rev-parse","--verify","--quiet",safeRef(ref)],{allowMissing:true});
  const value=result.stdout.trim();
  return value||null;
 }

 async function listRefValues(root){
  const result=await runGit(root,["for-each-ref","--format=%(refname) %(objectname)"]);
  return result.stdout.split(/\r?\n/).filter(Boolean).map(row=>{
   const separator=row.lastIndexOf(" ");
   if(separator<1)return null;
   return {ref:row.slice(0,separator),objectId:row.slice(separator+1)};
  }).filter(Boolean);
 }

 async function refsDigestUnlocked(root){
  const refs=await listRefValues(root);
  refs.sort((left,right)=>left.ref.localeCompare(right.ref));
  return createHash("sha256").update(JSON.stringify(refs)).digest("hex");
 }

 async function syncGenerationUnlocked(id,root){
  const state=await stateFor(id);
  const refsDigest=await refsDigestUnlocked(root);
  if(!state.refsDigest){
   const initialized={generation:state.generation,fence:state.fence,refsDigest};
   await atomicWriteJson(statePath(id),initialized);
   return initialized;
  }
  if(state.refsDigest!==refsDigest){
   const changed={generation:state.generation+1,fence:state.fence,refsDigest};
   await atomicWriteJson(statePath(id),changed);
   return changed;
  }
  return state;
 }

 function journalResult(record){
  if(record.status==="committed")return record.result;
  if(record.status==="aborted"){
   throw new AppError(409,record.errorCode||"STORAGE_OPERATION_INTERRUPTED",record.errorMessage||"The earlier storage operation did not publish its refs. Submit a new operation ID after refreshing repository state.");
  }
  throw new AppError(503,"STORAGE_RECOVERY_REQUIRED","A previous repository operation has an unknown outcome. Writes are blocked pending recovery.");
 }

 async function recoverPendingUnlocked(id,root){
  const directory=operationsDirectory(id);
  let names=[];
  try{names=await fs.readdir(directory);}catch(error){if(error.code==="ENOENT")return;throw error;}
  for(const name of names.filter(item=>item.endsWith(".json")).sort()){
   const file=path.join(directory,name);
   const record=await readJson(file,null);
   if(!record||record.status!=="prepared")continue;
   const current=[];
   for(const change of record.changes||[])current.push(await readRefUnlocked(root,change.ref));
   const allApplied=(record.changes||[]).every((change,index)=>current[index]===change.newObjectId);
   const allUnapplied=(record.changes||[]).every((change,index)=>current[index]===change.expectedObjectId);
   if(allApplied){
    const state=await stateFor(id);
    await atomicWriteJson(statePath(id),{
     generation:Math.max(state.generation,record.generationAfter),
     fence:Math.max(state.fence,record.fencingToken||0),
     refsDigest:await refsDigestUnlocked(root)
    });
    record.status="committed";
    record.result={operationId:record.operationId,generation:record.generationAfter,changes:record.changes,recovered:true};
    record.completedAt=new Date().toISOString();
    await atomicWriteJson(file,record);
   }else if(allUnapplied){
    record.status="aborted";
    record.errorCode="STORAGE_OPERATION_INTERRUPTED";
    record.errorMessage="The operation stopped before its atomic ref transaction was published. Refresh repository state and submit a new operation ID.";
    record.completedAt=new Date().toISOString();
    await atomicWriteJson(file,record);
   }else{
    throw new AppError(503,"STORAGE_RECOVERY_REQUIRED","Git refs do not match either side of an interrupted operation. The repository requires operator reconciliation before writes can continue.");
   }
  }
 }

 async function applyChangesUnlocked(id,root,input,changes,beforePublish,beforeRefPublication,afterRefPublication){
  const op=operationId(input.operationId);
  const expectedGeneration=input.expectedGeneration;
  if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw new AppError(400,"EXPECTED_GENERATION_REQUIRED","Provide the current repository generation.");
  const leaseFence=Number.isSafeInteger(input.fencingToken)?input.fencingToken:0;
  if(leaseFence<0)throw new AppError(400,"INVALID_FENCING_TOKEN","The fencing token must be a non-negative integer.");
  const expectedRefs=input.expectedRefs||[];
  if(!Array.isArray(expectedRefs)||expectedRefs.length>20)throw new AppError(400,"INVALID_EXPECTED_REFS","Expected ref preconditions must be an array of at most 20 entries.");
  const normalizedExpectedRefs=expectedRefs.map(item=>({ref:safeRef(item?.ref),expectedObjectId:safeSha(item?.expectedObjectId)}));
  if(new Set(normalizedExpectedRefs.map(item=>item.ref)).size!==normalizedExpectedRefs.length||normalizedExpectedRefs.some(item=>changes.some(change=>change.ref===item.ref)))throw new AppError(400,"INVALID_EXPECTED_REFS","Expected ref preconditions must be unique and must not duplicate the ref being changed.");
  const payload={repositoryId:id,expectedGeneration,changes,...(input.operationPayload||{}),expectedRefs:normalizedExpectedRefs};
  const payloadHash=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const recordFile=operationPath(id,op);
  await recoverPendingUnlocked(id,root);
  const previous=await readJson(recordFile,null);
  if(previous){
   if(previous.payloadHash!==payloadHash)throw new AppError(409,"STORAGE_OPERATION_ID_REUSED","This operation ID was already used with a different request.");
   if(previous.status==="committed")return previous.result;
   return journalResult(previous);
  }
  const state=await syncGenerationUnlocked(id,root);
  if(state.generation!==expectedGeneration)throw new AppError(409,"STORAGE_GENERATION_CONFLICT","The repository changed since this operation was prepared.",{expectedGeneration,actualGeneration:state.generation});
  if(leaseFence<state.fence)throw new AppError(409,"STORAGE_FENCE_STALE","This worker's fencing token is older than the latest accepted Git storage writer.",{providedFence:leaseFence,latestFence:state.fence});

  for(const change of changes){
   await runGit(root,["check-ref-format",safeRef(change.ref)]);
   const current=await readRefUnlocked(root,change.ref);
   if(current!==change.expectedObjectId)throw new AppError(409,"STORAGE_REF_CONFLICT","A Git ref changed before the compare-and-swap could be applied.",{ref:change.ref,currentObjectId:current});
  }
  for(const guard of normalizedExpectedRefs){
   const current=await readRefUnlocked(root,guard.ref);
   if(current!==guard.expectedObjectId)throw new AppError(409,"STORAGE_REF_CONFLICT","A guarded Git ref changed before the compare-and-swap could be applied.",{ref:guard.ref,currentObjectId:current});
  }

  const prepared={
   operationId:op,payloadHash,status:"prepared",changes,expectedRefs:normalizedExpectedRefs,
   generationBefore:state.generation,generationAfter:state.generation+1,
   fencingToken:leaseFence,createdAt:new Date().toISOString()
  };
  await atomicWriteJson(recordFile,prepared);

  try{
   if(beforePublish)await beforePublish();
   // Imports populate the object database here; validate every target before any ref is published.
   for(const change of changes){
    if(change.newObjectId!==null){
     let type;
     try{type=(await runGit(root,["cat-file","-t",change.newObjectId])).stdout.trim();}
     catch{throw new AppError(422,"GIT_OBJECT_MISSING","The proposed ref target is not present in the repository.");}
     if(!type)throw new AppError(422,"GIT_OBJECT_MISSING","The proposed ref target is not present in the repository.");
     if(change.ref.startsWith("refs/heads/")&&type!=="commit")throw new AppError(422,"BRANCH_TARGET_NOT_COMMIT","A branch must point to a commit object.");
     if(change.ref.startsWith("refs/heads/")){
      try{await runGit(root,["fsck","--connectivity-only","--no-reflogs",change.newObjectId]);}
      catch{throw new AppError(422,"GIT_OBJECT_MISSING","The proposed branch commit is missing one or more required Git objects.");}
     }
    }
   }
   const commands=["start"];
   for(const guard of normalizedExpectedRefs)commands.push("verify "+guard.ref+" "+guard.expectedObjectId);
   for(const change of changes){
    if(change.expectedObjectId===null)commands.push("create "+change.ref+" "+change.newObjectId);
    else if(change.newObjectId===null)commands.push("delete "+change.ref+" "+change.expectedObjectId);
    else commands.push("update "+change.ref+" "+change.newObjectId+" "+change.expectedObjectId);
   }
   commands.push("prepare","commit","");
   if(beforeRefPublication)await beforeRefPublication();
   await runGitInput(root,["update-ref","--stdin"],commands.join("\n"));
  }catch(error){
   const actual=[];
   for(const change of changes)actual.push(await readRefUnlocked(root,change.ref));
   const allApplied=changes.every((change,index)=>actual[index]===change.newObjectId);
   if(allApplied){
    // The ref transaction committed but the process did not receive its acknowledgement.
    // Leave the prepared journal for the next request to reconcile.
    await recoverPendingUnlocked(id,root);
    const resolved=await readJson(recordFile,null);
    if(resolved?.status==="committed")return resolved.result;
   }
   const allUnapplied=changes.every((change,index)=>actual[index]===change.expectedObjectId);
   if(allUnapplied){
    prepared.status="aborted";
    prepared.errorCode=error?.code==="GIT_REF_TRANSACTION_FAILED"?"STORAGE_REF_CONFLICT":(error?.code||"STORAGE_OPERATION_FAILED");
    prepared.errorMessage=error?.message||"The storage operation failed before publishing refs.";
    prepared.completedAt=new Date().toISOString();
    await atomicWriteJson(recordFile,prepared);
    throw new AppError(error?.statusCode||409,prepared.errorCode,prepared.errorMessage);
   }
   throw new AppError(503,"STORAGE_RECOVERY_REQUIRED","Git refs changed during an interrupted operation. Writes are blocked pending operator reconciliation.");
  }

  // A simulated/real process interruption here leaves a prepared journal and
  // an already-published ref. The next request must reconcile it by operation ID.
  if(afterRefPublication)await afterRefPublication();
  const result={operationId:op,generation:state.generation+1,changes,recovered:false};
  await atomicWriteJson(statePath(id),{generation:result.generation,fence:Math.max(state.fence,leaseFence),refsDigest:await refsDigestUnlocked(root)});
  prepared.status="committed";
  prepared.result=result;
  prepared.completedAt=new Date().toISOString();
  await atomicWriteJson(recordFile,prepared);
  return result;
 }

 async function scoped(id,callback){
  const safeId=repositoryId(id);
  return withLease(safeId,async lease=>{
   const assertOwned=typeof lease?.assertOwned==="function"?()=>lease.assertOwned():null;
   return adapterLeaseContext.run(assertOwned,async()=>{
    if(assertOwned)await assertOwned();
    const result=await callback(lease||null);
    if(assertOwned)await assertOwned();
    return result;
   });
  });
 }

 return Object.freeze({
  kind:"local-filesystem",
  repositoryPath,
  async getGeneration({repositoryId:id}){
   return scoped(id,async()=>{
    const root=repositoryPath(id);
    await recoverPendingUnlocked(id,root);
    return (await syncGenerationUnlocked(id,root)).generation;
   });
  },
  async readRef({repositoryId:id,ref}){
   return scoped(id,async()=>readRefUnlocked(repositoryPath(id),ref));
  },
  async compareAndSwapRef(input){
   const id=repositoryId(input.repositoryId);
   const ref=safeRef(input.ref);
   const expected=safeSha(input.expectedObjectId,true);
   const target=safeSha(input.newObjectId,true);
   if(expected===target)throw new AppError(400,"NOOP_REF_UPDATE","The expected and new ref targets must differ.");
   if(expected===null&&target===null)throw new AppError(400,"INVALID_REF_UPDATE","A ref update must create, update or delete a ref.");
   const expectedRefs=(input.expectedRefs||[]).map(item=>({ref:safeRef(item?.ref),expectedObjectId:safeSha(item?.expectedObjectId)}));
   if(expectedRefs.length>20||new Set(expectedRefs.map(item=>item.ref)).size!==expectedRefs.length||expectedRefs.some(item=>item.ref===ref))throw new AppError(400,"INVALID_EXPECTED_REFS","Expected ref preconditions must be unique and must not duplicate the ref being changed.");
   return scoped(id,async lease=>{
    const changes=[{ref,expectedObjectId:expected,newObjectId:target}];
    return applyChangesUnlocked(id,repositoryPath(id),{
     ...input,expectedRefs,fencingToken:input.fencingToken??lease?.fence??0
    },changes,input.beforePublish,input.beforeRefPublication,input.afterRefPublication);
   });
  },
  async importObjects({repositoryId:id,sourceRepositoryPath,sourceRef,expectedCommitSha}){
   const sourceRoot=path.resolve(String(sourceRepositoryPath||""));
   const ref=safeRef(sourceRef),expected=safeSha(expectedCommitSha);
   if(!sourceRepositoryPath||sourceRoot===repositoryPath(id))throw new AppError(400,"INVALID_OBJECT_IMPORT_SOURCE","An isolated Git object source is required.");
   return scoped(id,async()=>{
    const root=repositoryPath(id);
    let sourceStat;
    try{sourceStat=await fs.stat(sourceRoot);}catch{throw new AppError(400,"INVALID_OBJECT_IMPORT_SOURCE","The isolated Git source repository is unavailable.");}
    if(!sourceStat.isDirectory())throw new AppError(400,"INVALID_OBJECT_IMPORT_SOURCE","The Git object source must be a repository directory.");
    const advertised=(await runGit(sourceRoot,["rev-parse","--verify",ref+"^{commit}"])).stdout.trim();
    if(advertised!==expected)throw new AppError(409,"GIT_OBJECT_IMPORT_MISMATCH","The isolated source ref does not point to the expected merge commit.");
    await runGit(root,["fetch","--quiet","--no-tags","--no-write-fetch-head",sourceRoot,ref]);
    const imported=(await runGit(root,["rev-parse","--verify",expected+"^{commit}"])).stdout.trim();
    const objectType=(await runGit(root,["cat-file","-t",imported])).stdout.trim();
    if(imported!==expected||objectType!=="commit")throw new AppError(422,"GIT_OBJECT_MISSING","The merge commit was not imported into the primary object database.");
    try{await runGit(root,["fsck","--connectivity-only","--no-reflogs",expected]);}
    catch{throw new AppError(422,"GIT_OBJECT_MISSING","The imported merge commit is missing one or more required Git objects.");}
    return {commitSha:imported,verified:true};
   });
  },
  async exportBundle({repositoryId:id,maxSizeMb}){
   return scoped(id,async()=>{
    const root=repositoryPath(id);
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-storage-export-"));
    const bundlePath=path.join(directory,"repository.bundle");
    try{
     await runGit(root,["bundle","create",bundlePath,"--all"]);
     await runGit(root,["bundle","verify",bundlePath]);
     const stat=await fs.stat(bundlePath);
     const configured=Number(maxSizeMb??process.env.MAX_REPOSITORY_BACKUP_SIZE_MB??500);
     const limit=Number.isFinite(configured)&&configured>=1&&configured<=2048?configured:500;
     const maxBytes=limit*1024*1024;
     if(!stat.isFile()||stat.size<1)throw new AppError(500,"BACKUP_EMPTY","Git produced an empty repository backup.");
     if(stat.size>maxBytes)throw new AppError(413,"BACKUP_TOO_LARGE","The repository backup exceeds the configured download limit.",{sizeBytes:stat.size,maxBytes});
     const heads=await runGit(root,["bundle","list-heads",bundlePath]);
     const refs=parseBundleRefs(heads.stdout);
     return {directory,path:bundlePath,sizeBytes:stat.size,sha256:await sha256File(bundlePath),refs};
    }catch(error){
     await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});
     throw error;
    }
   });
  },
  async importBundle(input){
   const id=repositoryId(input.repositoryId);
   const bundlePath=path.resolve(String(input.bundlePath||""));
   const stat=await fs.lstat(bundlePath);
   if(!stat.isFile())throw new AppError(400,"INVALID_GIT_BUNDLE","A regular Git bundle file is required.");
   const bundleSha256=await sha256File(bundlePath);
   return scoped(id,async lease=>{
    const root=repositoryPath(id);
    await runGit(root,["bundle","verify",bundlePath]);
    const listing=await runGit(root,["bundle","list-heads",bundlePath]);
    const refs=parseBundleRefs(listing.stdout);
    const expectedRefs=input.expectedRefs||{};
    const allowed=new Set(refs.map(item=>item.ref));
    if(Object.keys(expectedRefs).some(ref=>!allowed.has(ref)))throw new AppError(400,"INVALID_EXPECTED_REFS","Expected refs must match refs advertised by the bundle.");
    const defaultBranch=input.defaultBranch?String(input.defaultBranch):null;
    if(defaultBranch){
     await runGit(root,["check-ref-format","--branch",defaultBranch]);
     if(!refs.some(item=>item.ref==="refs/heads/"+defaultBranch))throw new AppError(400,"DEFAULT_BRANCH_NOT_IMPORTED","The requested default branch is not included in the bundle.");
    }
    const changes=refs.map(item=>({
     ref:item.ref,
     expectedObjectId:safeSha(Object.prototype.hasOwnProperty.call(expectedRefs,item.ref)?expectedRefs[item.ref]:null,true),
     newObjectId:item.sha
    }));
    if(changes.some(change=>change.expectedObjectId===change.newObjectId))throw new AppError(400,"NOOP_REF_UPDATE","The bundle already matches one or more existing ref targets.");
    return applyChangesUnlocked(id,root,{
     ...input,
     fencingToken:input.fencingToken??lease?.fence??0,
     bundleSha256,
     operationPayload:{bundleSha256,defaultBranch:input.defaultBranch||null}
    },changes,async()=>{
     await runGit(root,["bundle","unbundle",bundlePath]);
    }).then(async result=>{
     if(defaultBranch){
      await runGit(root,["symbolic-ref","HEAD","refs/heads/"+defaultBranch]);
     }
     return {...result,bundleSha256,refCount:refs.length};
    });
   });
  },
  async verifyRepository({repositoryId:id}){
   return scoped(id,async()=>{
    const root=repositoryPath(id);
    await recoverPendingUnlocked(id,root);
    const refs=await listRefValues(root);
    const report=await runGit(root,["fsck","--full","--connectivity-only","--no-reflogs"]);
    const generation=(await syncGenerationUnlocked(id,root)).generation;
    return {ok:true,generation,refs,checkedRefs:refs.length,fsckOutput:report.stdout.trim()};
   });
  }
 });
}
