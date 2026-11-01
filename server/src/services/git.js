import {execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import {AppError} from "../utils/errors.js";
const execFileAsync=promisify(execFile);
const storage=path.resolve(process.env.REPO_STORAGE_PATH||path.join(process.cwd(),"storage","repos"));
const locks=new Map();
export function repositoryPath(id){if(!/^[a-f0-9]{24}$/i.test(String(id||"")))throw new AppError(400,"INVALID_REPOSITORY_ID","Invalid repository identifier.");const target=path.resolve(storage,String(id));if(!target.startsWith(storage+path.sep))throw new AppError(400,"INVALID_REPOSITORY_PATH","Invalid repository path.");return target;}
export async function withRepositoryLock(id,fn){const key=String(id),prior=locks.get(key)||Promise.resolve();let release;const current=new Promise(resolve=>{release=resolve;});locks.set(key,current);await prior.catch(()=>{});try{return await fn();}finally{release();if(locks.get(key)===current)locks.delete(key);}}
async function git(root,args){try{const r=await execFileAsync("git",args,{cwd:root,timeout:20000,maxBuffer:4*1024*1024,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1"}});return {stdout:String(r.stdout||""),stderr:String(r.stderr||"")};}catch(e){const detail=[e.stderr,e.stdout].filter(Boolean).map(String).join("\n").trim();if(/not a git repository/i.test(detail))throw new AppError(404,"GIT_REPOSITORY_MISSING","Repository Git data is unavailable.");if(/already exists/i.test(detail))throw new AppError(409,"GIT_REF_EXISTS","A ref with that name already exists.");if(/CONFLICT|Automatic merge failed/i.test(detail))throw new AppError(409,"GIT_CONFLICT","Git could not merge these changes.",{message:detail.slice(0,12000)});throw new AppError(400,"GIT_OPERATION_FAILED",(detail||"Git could not complete the operation.").slice(0,700));}}
function safeRef(value){if(typeof value!=="string"||!value||value.length>160||value.startsWith("-")||!/^[A-Za-z0-9_./-]+$/.test(value)||value.includes("..")||value.includes("//")||value.endsWith("/")||value.endsWith("."))throw new AppError(400,"INVALID_GIT_REF","Invalid Git reference.");return value;}
function safePath(value){if(typeof value!=="string"||!value||value.length>500||value.includes("\0")||value.includes("\\")||value.startsWith("/")||/^[A-Za-z]:/.test(value))throw new AppError(400,"INVALID_FILE_PATH","A safe repository-relative file path is required.");const parts=value.split("/");if(parts.some(p=>!p||p==="."||p===".."||p===".git"))throw new AppError(400,"INVALID_FILE_PATH","Absolute paths, parent traversal and Git internals are not accessible.");return parts.join("/");}
export async function initRepository(repo,options={}){const root=repositoryPath(repo._id);await fs.mkdir(storage,{recursive:true,mode:0o750});await fs.mkdir(root,{recursive:false,mode:0o750});try{await git(root,["init","--initial-branch="+(options.branch||"main")]);await git(root,["config","user.name",String(options.authorName||"CodeVault Member").slice(0,80)]);await git(root,["config","user.email",String(options.authorEmail||"member@codevault.local").slice(0,254)]);if(options.addReadme!==false){await fs.writeFile(path.join(root,"README.md"),"# "+repo.name+"\n\n"+(repo.description||"A repository managed with CodeVault.")+"\n",{encoding:"utf8",mode:0o640});const templates={Node:"node_modules/\n.env\n.env.*\ndist/\ncoverage/\n",Python:"__pycache__/\n*.py[cod]\n.venv/\n.env\n",Java:"*.class\ntarget/\n.idea/\n",VisualStudioCode:".vscode/\n"};if(options.gitignore&&options.gitignore!=="None"&&templates[options.gitignore])await fs.writeFile(path.join(root,".gitignore"),templates[options.gitignore],{encoding:"utf8",mode:0o640});if(options.license==="MIT")await fs.writeFile(path.join(root,"LICENSE"),"MIT License\n\nCopyright (c) "+new Date().getFullYear()+" "+String(options.authorName||"CodeVault contributor")+"\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.\n",{encoding:"utf8",mode:0o640});await git(root,["add","--all"]);await git(root,["commit","-m","Initial commit"]);}return root;}catch(e){await fs.rm(root,{recursive:true,force:true}).catch(()=>{});throw e;}}
export async function listFiles(id,branch="main"){const r=await git(repositoryPath(id),["ls-tree","-r","--name-only",safeRef(branch)]);return r.stdout.split(/\r?\n/).filter(Boolean).map(file=>({path:file,name:file.split("/").pop(),extension:path.extname(file).slice(1).toLowerCase()}));}
export async function readFile(id,branch,file){const p=safePath(file),r=await git(repositoryPath(id),["show",safeRef(branch)+":"+p]);if(Buffer.byteLength(r.stdout,"utf8")>1048576)throw new AppError(413,"FILE_TOO_LARGE","Files larger than 1 MiB cannot be displayed.");return {path:p,ref:branch,content:r.stdout};}
export async function listCommits(id,branch="main",limit=50){const n=Math.min(100,Math.max(1,Number(limit)||50)),format="%H%x1f%an%x1f%ae%x1f%aI%x1f%s";const r=await git(repositoryPath(id),["log","--max-count="+n,"--date=iso-strict","--format="+format,safeRef(branch)]);return r.stdout.split(/\r?\n/).filter(Boolean).map(line=>{const v=line.split(String.fromCharCode(31));return {sha:v[0],author:v[1],email:v[2],date:v[3],message:v.slice(4).join(String.fromCharCode(31))};});}
export async function listBranches(id){
 const root=repositoryPath(id);
 const refs=await git(root,["for-each-ref","--format=%(refname:short)","refs/heads"]);
 const names=refs.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 return Promise.all(names.map(async name=>({name,sha:(await git(root,["rev-parse","refs/heads/"+safeRef(name)])).stdout.trim()})));
}
export async function createBranch(id,name,base="main"){const branch=safeRef(name),start=safeRef(base);if(!/^[A-Za-z0-9_./-]{1,120}$/.test(branch))throw new AppError(400,"INVALID_BRANCH_NAME","Branch name is invalid.");await git(repositoryPath(id),["check-ref-format","--branch",branch]);await git(repositoryPath(id),["branch","--",branch,start]);return {name:branch};}
export async function previewMerge(id,source,target){const root=repositoryPath(id),from=safeRef(source),into=safeRef(target);if(from===into)throw new AppError(400,"SAME_BRANCH","Choose different branches.");const d=await git(root,["diff","--name-status",into+"..."+from]);const files=d.stdout.split(/\r?\n/).filter(Boolean).map(line=>{const v=line.split("\t");return {status:v[0],path:v[v.length-1]};});let canMerge=true,conflicts=[];try{await git(root,["merge-tree","--write-tree",into,from]);}catch(e){canMerge=false;const detail=String(e.details?.message||e.message||"");conflicts=detail.split(/\r?\n/).filter(Boolean).slice(0,25);}const branches=await listBranches(id);return {source:from,target:into,canMerge,files,conflicts,targetHead:branches.find(b=>b.name===into)?.sha||null};}
export async function mergeBranches(id,source,target,expectedHead){const root=repositoryPath(id),from=safeRef(source),into=safeRef(target);if(from===into)throw new AppError(400,"SAME_BRANCH","Choose different branches.");const current=(await git(root,["rev-parse",into])).stdout.trim();if(expectedHead&&current!==expectedHead)throw new AppError(409,"BRANCH_MOVED","Target branch moved since preview; refresh before merging.");await git(root,["checkout","--quiet",into]);try{await git(root,["merge","--no-edit","--no-ff",from]);return {merged:true};}catch(e){const conflicts=(await git(root,["diff","--name-only","--diff-filter=U"]).catch(()=>({stdout:""}))).stdout.split(/\r?\n/).filter(Boolean);await git(root,["merge","--abort"]).catch(()=>{});throw new AppError(409,"MERGE_CONFLICT","Git could not merge these branches without conflicts.",{conflictingFiles:conflicts,message:e.message});}}
export async function commitFile(id,branch,file,content,message,author){if(typeof content!=="string"||Buffer.byteLength(content,"utf8")>1048576)throw new AppError(413,"FILE_TOO_LARGE","A commit is limited to 1 MiB of text.");if(typeof message!=="string"||message.trim().length<3||message.trim().length>180)throw new AppError(400,"INVALID_COMMIT_MESSAGE","Commit message must be 3–180 characters.");const root=repositoryPath(id),b=safeRef(branch),p=safePath(file);await git(root,["checkout","--quiet",b]);const target=path.resolve(root,p);if(!target.startsWith(root+path.sep))throw new AppError(400,"INVALID_FILE_PATH","The path is outside the repository.");let current=root;for(const part of p.split("/").slice(0,-1)){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw new AppError(400,"SYMLINK_PATH_NOT_ALLOWED","Editing through symbolic links is prohibited.");}catch(e){if(e.code==="ENOENT")break;throw e;}}try{if((await fs.lstat(target)).isSymbolicLink())throw new AppError(400,"SYMLINK_PATH_NOT_ALLOWED","Editing symbolic links is prohibited.");}catch(e){if(e.code!=="ENOENT")throw e;}await fs.mkdir(path.dirname(target),{recursive:true,mode:0o750});await fs.writeFile(target,content,{encoding:"utf8",mode:0o640});await git(root,["add","--",p]);await git(root,["-c","user.name="+String(author.displayName||author.username).slice(0,80),"-c","user.email="+String(author.email||"member@codevault.local").slice(0,254),"commit","-m",message.trim()]);return {sha:(await git(root,["rev-parse","HEAD"])).stdout.trim(),branch:b,path:p};}
export async function diffCommit(id,commitSha){if(!/^[a-f0-9]{7,40}$/i.test(commitSha))throw new AppError(400,"INVALID_COMMIT","Invalid commit identifier.");return (await git(repositoryPath(id),["show","--no-ext-diff","--format=","--stat","--patch","--unified=3",commitSha])).stdout.slice(0,300000);}


export async function searchCode(id, query, ref = "main", limit = 100) {
  const term = String(query || "").trim();
  if (!term || term.length > 100) throw new AppError(400, "INVALID_SEARCH_QUERY", "Search text must contain 1–100 characters.");
  const revision = safeRef(ref);
  const root = repositoryPath(id);
  await git(root, ["rev-parse", "--verify", revision + "^{commit}"]);

  const maxResults = Math.min(200, Math.max(1, Number(limit) || 100));
  let output = "";
  let truncated = false;
  try {
    const result = await execFileAsync("git", [
      "grep", "--no-color", "-n", "-I", "-F", "-e", term, revision, "--"
    ], {
      cwd: root,
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1"}
    });
    output = String(result.stdout || "");
  } catch (error) {
    output = String(error.stdout || "");
    if (error.code === 1) return {query: term, ref: revision, results: [], truncated: false};
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") truncated = true;
    else {
      const detail = [error.stderr, error.stdout].filter(Boolean).map(String).join(String.fromCharCode(10)).trim();
      throw new AppError(400, "GIT_SEARCH_FAILED", (detail || "Git could not search this revision.").slice(0, 700));
    }
  }

  const results = [];
  for (const row of output.split(String.fromCharCode(10))) {
    if (!row) continue;
    // git grep prefixes results with the revision when a tree-ish is searched.
    const match = row.match(/^[^:]+:(.+):([0-9]+):(.*)$/);
    if (!match) continue;
    const line = Number(match[2]);
    if (!Number.isInteger(line) || line < 1) continue;
    results.push({
      path: match[1],
      line,
      snippet: match[3].slice(0, 500)
    });
  }
  truncated = truncated || results.length > maxResults;
  const limitedResults = results.slice(0, maxResults);
  return {query: term, ref: revision, results: limitedResults, truncated};
}

export async function listTags(id) {
  const root = repositoryPath(id);
  const format = "%(refname:short)|%(objectname)|%(*objectname)|%(creatordate:iso-strict)|%(subject)";
  const result = await git(root, ["for-each-ref", "--sort=-creatordate", "--format=" + format, "refs/tags"]);
  return result.stdout.split(String.fromCharCode(10)).filter(Boolean).map(row => {
    const [name, objectSha, targetSha, createdAt, ...subjectParts] = row.split("|");
    const subject = subjectParts.join("|");
    return {name, objectSha, commitSha: targetSha || objectSha, createdAt, subject: subject || ""};
  });
}

export async function createTag(id, tagName, targetRef, message, author = {}) {
  const name = safeRef(tagName);
  const target = safeRef(targetRef);
  if (name.length > 128) throw new AppError(400, "INVALID_TAG_NAME", "Tag names may contain at most 128 characters.");
  const root = repositoryPath(id);
  await git(root, ["check-ref-format", "refs/tags/" + name]);
  const commitSha = (await git(root, ["rev-parse", "--verify", target + "^{commit}"])).stdout.trim();
  const note = String(message || "").trim();
  if (!note || note.length > 5000) throw new AppError(400, "INVALID_TAG_MESSAGE", "Release notes must contain 1–5000 characters.");
  const authorName = String(author.displayName || author.username || "CodeVault Member").slice(0, 80);
  const authorEmail = String(author.email || "member@codevault.local").slice(0, 254);
  await git(root, ["-c", "user.name=" + authorName, "-c", "user.email=" + authorEmail, "tag", "-a", name, "-m", note, target]);
  return {name, commitSha, target};
}

export async function deleteTag(id, tagName) {
  const name = safeRef(tagName);
  await git(repositoryPath(id), ["tag", "-d", name]);
}


export async function listCommitGraph(id, ref = "all", limit = 100) {
  const root = repositoryPath(id);
  const revision = ref === "all" ? null : safeRef(ref);
  const maxCount = Math.min(200, Math.max(1, Number(limit) || 100));
  const format = "%H%x1f%P%x1f%an%x1f%aI%x1f%s";
  const args = ["log", revision ? revision : "--all", "--topo-order", "--date-order", "--max-count=" + maxCount, "--date=iso-strict", "--format=" + format];
  const history = await git(root, args);
  const commits = history.stdout.split(String.fromCharCode(10)).filter(Boolean).map(row => {
    const [sha, parents, author, date, ...messageParts] = row.split(String.fromCharCode(31));
    return {sha, parents: parents ? parents.split(" ").filter(Boolean) : [], author, date, message: messageParts.join(String.fromCharCode(31))};
  });
  const [branches, tags] = await Promise.all([listBranches(id), listTags(id)]);
  const refsBySha = {};
  for (const item of branches) (refsBySha[item.sha] ||= []).push({name: item.name, type: "branch"});
  for (const item of tags) (refsBySha[item.commitSha] ||= []).push({name: item.name, type: "tag"});
  for (const commit of commits) commit.refs = refsBySha[commit.sha] || [];
  return {ref: revision || "all", commits, branches, tags, truncated: commits.length === maxCount};
}

export async function compareCommits(id, baseRef, targetRef) {
  const root = repositoryPath(id);
  const base = safeRef(baseRef);
  const target = safeRef(targetRef);
  if (base === target) throw new AppError(400, "SAME_COMMIT", "Choose two different commits to compare.");
  const [baseSha, targetSha] = await Promise.all([
    git(root, ["rev-parse", "--verify", base + "^{commit}"]),
    git(root, ["rev-parse", "--verify", target + "^{commit}"])
  ]);
  const baseCommit = baseSha.stdout.trim();
  const targetCommit = targetSha.stdout.trim();
  const result = await git(root, ["diff", "--no-ext-diff", "--stat", "--patch", "--unified=3", baseCommit, targetCommit]);
  const output = result.stdout.slice(0, 300000);
  const stats = output.split(String.fromCharCode(10)).filter(line => /\|\s+\d+/.test(line));
  return {base: baseCommit, target: targetCommit, diff: output, filesChanged: stats.length};
}


export async function revertCommit(id, branchName, commitSha, expectedHead, author = {}) {
  const root = repositoryPath(id);
  const branch = safeRef(branchName);
  if (typeof commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new AppError(400, "INVALID_COMMIT", "A full 40-character commit SHA is required.");
  }
  if (typeof expectedHead !== "string" || !/^[a-f0-9]{40}$/i.test(expectedHead)) {
    throw new AppError(400, "EXPECTED_HEAD_REQUIRED", "Refresh the branch and provide its current head SHA before reverting.");
  }
  const current = (await git(root, ["rev-parse", "--verify", branch + "^{commit}"])).stdout.trim();
  if (current !== expectedHead) throw new AppError(409, "BRANCH_MOVED", "The branch changed since it was loaded. Refresh its history before reverting.");
  const target = (await git(root, ["rev-parse", "--verify", commitSha + "^{commit}"])).stdout.trim();
  try {
    const ancestry = await git(root, ["merge-base", "--is-ancestor", target, branch]);
    if (ancestry.stdout) throw new Error("unexpected output");
  } catch {
    throw new AppError(400, "COMMIT_NOT_ON_BRANCH", "The selected commit is not part of the chosen branch history.");
  }
  const parents = (await git(root, ["rev-list", "--parents", "-n", "1", target])).stdout.trim().split(" ").filter(Boolean);
  if (parents.length > 2) throw new AppError(409, "MERGE_COMMIT_REVERT_UNSUPPORTED", "Reverting a merge commit requires an explicit mainline parent and is not supported by this action.");
  if (parents.length !== 2) throw new AppError(409, "ROOT_COMMIT_REVERT_UNSUPPORTED", "The initial root commit cannot be reverted with this action.");
  const status = (await git(root, ["status", "--porcelain"])).stdout.trim();
  if (status) throw new AppError(409, "WORKTREE_NOT_CLEAN", "The repository has uncommitted changes. Save or discard them before reverting.");
  await git(root, ["checkout", "--quiet", branch]);
  const name = String(author.displayName || author.username || "CodeVault Member").slice(0, 80);
  const email = String(author.email || "member@codevault.local").slice(0, 254);
  try {
    await git(root, ["-c", "user.name=" + name, "-c", "user.email=" + email, "revert", "--no-edit", target]);
  } catch (error) {
    await git(root, ["revert", "--abort"]).catch(() => {});
    throw new AppError(409, "REVERT_CONFLICT", "The selected change cannot be reverted cleanly on this branch. Resolve conflicts manually in a dedicated revert workflow.", {cause: error.message});
  }
  const revertedBy = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  return {branch, revertedCommit: target, revertCommit: revertedBy, parentCommit: parents[1]};
}

export async function diffBranches(id, sourceRef, targetRef) {
  const root = repositoryPath(id);
  const source = safeRef(sourceRef);
  const target = safeRef(targetRef);
  const [sourceSha, targetSha] = await Promise.all([
    git(root, ["rev-parse", "--verify", source + "^{commit}"]),
    git(root, ["rev-parse", "--verify", target + "^{commit}"])
  ]);
  const diff = await git(root, ["diff", "--no-ext-diff", "--no-color", "--no-renames", "--unified=0", target + "..." + source]);
  return {source: sourceSha.stdout.trim(), target: targetSha.stdout.trim(), diff: diff.stdout.slice(0, 500000)};
}

export function isAddedDiffLine(diff, filePath, lineNumber) {
  if (typeof filePath !== "string" || !filePath || filePath.length > 500 || !Number.isInteger(lineNumber) || lineNumber < 1) return false;
  let currentPath = "";
  let newLine = 0;
  let insideHunk = false;
  for (const row of String(diff || "").split(String.fromCharCode(10))) {
    if (row.startsWith("+++ b/")) {
      currentPath = row.slice(6);
      insideHunk = false;
      continue;
    }
    if (row.startsWith("@@ ")) {
      const hunk = row.match(/\+([0-9]+)(?:,([0-9]+))? @@/);
      if (!hunk) { insideHunk = false; continue; }
      newLine = Number(hunk[1]);
      insideHunk = true;
      continue;
    }
    if (!insideHunk) continue;
    if (row.startsWith("+") && !row.startsWith("+++")) {
      if (currentPath === filePath && newLine === lineNumber) return true;
      newLine++;
    } else if (row.startsWith(" ")) {
      newLine++;
    }
  }
  return false;
}
