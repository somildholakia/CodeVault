import {Router} from "express";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import {z} from "zod";
import User from "../models/User.js";
import Repository from "../models/Repository.js";
import Collaborator from "../models/Collaborator.js";
import Issue from "../models/Issue.js";
import Activity from "../models/Activity.js";
import Release from "../models/Release.js";
import BranchProtection from "../models/BranchProtection.js";
import {requireAuth} from "../middleware/auth.js";
import {AppError,asyncHandler,notFound} from "../utils/errors.js";
import {requireDurableRepositoryStorage} from "../utils/repositoryStorage.js";
import {selectBranchProtection} from "../services/pullRequestPolicy.js";
import {scanDependencies} from "../services/dependencyScanner.js";
import {nextSequence} from "../services/sequences.js";
import {purgeRepositoryRecords} from "../services/repositoryCleanup.js";
import {repositoryPath,initRepository,listFiles,readFile,listCommits,listBranches,createBranch,previewMerge,mergeBranches,commitFile,diffCommit,searchCode,listCommitGraph,compareCommits,revertCommit,listTags,createTag,deleteTag,deleteBranch,fileHistory,fileBlame,resolveMergeConflicts,getContributionStats,createRepositoryBundle,withRepositoryLock} from "../services/git.js";
import {assertRepositoryLease} from "../services/repositoryLock.js";
const router=Router();router.use(requireAuth);
const dependencyScanLimiter=rateLimit({windowMs:60000,limit:4,standardHeaders:"draft-7",legacyHeaders:false});
async function getRepo(id){if(!mongoose.isValidObjectId(id))throw notFound("Repository not found.");const repo=await Repository.findById(id).populate("owner","username displayName avatarUrl");if(!repo)throw notFound("Repository not found.");return repo;}
async function roleFor(repo,uid){if(repo.owner._id.toString()===uid.toString())return "owner";const c=await Collaborator.findOne({repository:repo._id,user:uid,acceptedAt:{$ne:null}});return c?.role||null;}
const canRead=(role,repo)=>Boolean(role)||repo.visibility==="public";
const canWrite=role=>["owner","maintainer","developer"].includes(role);
const canManage=role=>["owner","maintainer"].includes(role);
function assertRead(role,repo){if(!canRead(role,repo))throw notFound("Repository not found.");}
function assertWrite(role){if(!canWrite(role))throw new AppError(403,"PERMISSION_DENIED","You do not have write access to this repository.");}
function assertManage(role){if(!canManage(role))throw new AppError(403,"PERMISSION_DENIED","Only the owner or a maintainer can manage this operation.");}
async function protectionForBranch(repo,branch){const rules=await BranchProtection.find({repository:repo._id}).lean();return selectBranchProtection(rules,branch);}
async function event(uid,repo,action,type,name,summary,id=""){await Activity.create({actor:uid,repository:repo?._id||null,action,entityType:type,entityName:name,entityId:String(id),summary});if(repo){repo.lastActivityAt=new Date();await repo.save();}}
router.get("/",asyncHandler(async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||100));const ms=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository");const repositories=await Repository.find({$or:[{owner:req.user._id},{visibility:"public"},{_id:{$in:ms.map(m=>m.repository)}}]}).sort({updatedAt:-1}).limit(limit).populate("owner","username displayName avatarUrl");res.json({repositories});}));
router.post("/",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const p=z.object({name:z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),description:z.string().trim().max(350).optional().default(""),visibility:z.enum(["public","private"]).default("private"),addReadme:z.boolean().default(true),gitignore:z.enum(["Node","Python","Java","VisualStudioCode","None"]).default("Node"),license:z.enum(["MIT","None"]).default("MIT")}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Repository details are invalid.",p.error.flatten());
 const slug=p.data.name.toLowerCase();if(await Repository.exists({owner:req.user._id,slug}))throw new AppError(409,"REPOSITORY_EXISTS","You already have a repository with that name.");
 const repo=new Repository({name:p.data.name,slug,description:p.data.description,visibility:p.data.visibility,owner:req.user._id,defaultBranch:"main"});let root;
 try{root=await withRepositoryLock(repo._id,()=>initRepository(repo,{branch:"main",addReadme:p.data.addReadme,gitignore:p.data.gitignore,license:p.data.license,authorName:req.user.displayName,authorEmail:req.user.email||"member@codevault.local"}));repo.gitInitialized=true;await repo.save();}
 catch(e){if(root)await withRepositoryLock(repo._id,async()=>{await assertRepositoryLease(repo._id);await fs.rm(root,{recursive:true,force:true});}).catch(()=>{});if(e.code===11000)throw new AppError(409,"REPOSITORY_EXISTS","You already have a repository with that name.");throw e;}
 await event(req.user._id,repo,"repository.created","repository",repo.name,"Created repository "+repo.name+".",repo._id);
 res.status(201).json({repository:await Repository.findById(repo._id).populate("owner","username displayName avatarUrl"),cloneUrl:null});
}));
router.get("/:id",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id),role=await roleFor(repo,req.user._id);assertRead(role,repo);res.json({repository:repo,permission:role||"public-viewer"});}));
router.get("/:id/backup",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const backup=await withRepositoryLock(repo._id,()=>createRepositoryBundle(repo._id));
 const timestamp=new Date().toISOString().replace(/[:.]/g,"-");
 const filename="codevault-"+repo.slug+"-"+timestamp+".bundle";
 res.status(200);
 res.set({
  "Content-Type":"application/x-git-bundle",
  "Content-Length":String(backup.sizeBytes),
  "Content-Disposition":"attachment; filename=\""+filename+"\"",
  "Cache-Control":"private, no-store",
  "X-Content-SHA256":backup.sha256,
  "X-Git-Ref-Count":String(backup.refs.length)
 });
 try{
  await pipeline(createReadStream(backup.path),res);
 }catch(error){
  if(!res.headersSent)throw error;
  res.destroy(error);
 }finally{
  await fs.rm(backup.directory,{recursive:true,force:true}).catch(()=>{});
 }
}));
router.get("/:id/search",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const p=z.object({
  q:z.string().trim().min(1).max(100),
  ref:z.string().trim().min(1).max(160).optional(),
  limit:z.coerce.number().int().min(1).max(200).optional()
 }).safeParse(req.query);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide search text between 1 and 100 characters and a valid result limit.",p.error.flatten());
 const result=await searchCode(repo._id,p.data.q,p.data.ref||repo.defaultBranch,p.data.limit||100);
 res.json(result);
}));
router.get("/:id/releases",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const [releases,tags]=await Promise.all([
  Release.find({repository:repo._id}).sort({publishedAt:-1}).limit(100).populate("author","username displayName avatarUrl"),
  listTags(repo._id)
 ]);
 res.json({releases,tags});
}));
router.post("/:id/releases",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 assertManage(await roleFor(repo,req.user._id));
 const p=z.object({
  tagName:z.string().trim().min(1).max(128),
  name:z.string().trim().min(1).max(120),
  notes:z.string().trim().min(1).max(5000),
  targetBranch:z.string().trim().min(1).max(160)
 }).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Release details are invalid.",p.error.flatten());
 const branches=await listBranches(repo._id);
 if(!branches.some(item=>item.name===p.data.targetBranch))throw new AppError(400,"BRANCH_NOT_FOUND","Choose an existing target branch.");
 if(await Release.exists({repository:repo._id,tagName:p.data.tagName}))throw new AppError(409,"RELEASE_EXISTS","A release already exists for this tag.");
 const tag=await withRepositoryLock(repo._id,()=>createTag(repo._id,p.data.tagName,p.data.targetBranch,p.data.notes,req.user));
 let release;
 try{
  release=await Release.create({
   repository:repo._id,tagName:tag.name,name:p.data.name,notes:p.data.notes,
   targetBranch:p.data.targetBranch,targetSha:tag.commitSha,author:req.user._id
  });
 }catch(error){
  await withRepositoryLock(repo._id,()=>deleteTag(repo._id,tag.name)).catch(()=>{});
  if(error.code===11000)throw new AppError(409,"RELEASE_EXISTS","A release already exists for this tag.");
  throw error;
 }
 await event(req.user._id,repo,"release.published","release",release.name,"Published "+release.name+" ("+release.tagName+").",release._id);
 res.status(201).json({release:await Release.findById(release._id).populate("author","username displayName avatarUrl")});
}));
router.get("/:id/graph",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const p=z.object({ref:z.string().trim().min(1).max(160).optional().default("all"),limit:z.coerce.number().int().min(1).max(200).optional().default(100)}).safeParse(req.query);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Invalid commit graph options.",p.error.flatten());
 const graph=await listCommitGraph(repo._id,p.data.ref,p.data.limit);
 res.json(graph);
}));
router.get("/:id/compare",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const p=z.object({base:z.string().trim().min(1).max(160),target:z.string().trim().min(1).max(160)}).safeParse(req.query);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Choose two commit refs to compare.",p.error.flatten());
 res.json(await compareCommits(repo._id,p.data.base,p.data.target));
}));
router.get("/:id/dependencies",dependencyScanLimiter,asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const ref=String(req.query.ref||repo.defaultBranch);
 const report=await scanDependencies(repo._id,ref);
 res.json({report});
}));
router.get("/:id/insights",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const ref=String(req.query.ref||"all");
 const days=Math.min(365,Math.max(7,Number(req.query.days)||90));
 res.json({insights:await getContributionStats(repo._id,ref,days)});
}));
router.get("/:id/branch-protection",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const rules=await BranchProtection.find({repository:repo._id}).sort({pattern:1}).lean();
 const branch=typeof req.query.branch==="string"?req.query.branch:"";
 res.json({rules,matched:branch?selectBranchProtection(rules,branch):null});
}));
router.put("/:id/branch-protection",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 assertManage(await roleFor(repo,req.user._id));
 const p=z.object({
  pattern:z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._/*?-]+$/).refine(value=>!value.includes("..")&&!value.includes("//")&&!value.startsWith("-"),"Branch pattern is invalid."),
  requirePullRequest:z.boolean().default(true),
  requiredApprovals:z.number().int().min(0).max(10).default(1),
  requireResolvedConversations:z.boolean().default(true),
  dismissStaleApprovals:z.boolean().default(true),
  preventDeletion:z.boolean().default(true)
 }).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Branch protection settings are invalid.",p.error.flatten());
 const rule=await BranchProtection.findOneAndUpdate({repository:repo._id,pattern:p.data.pattern},{$set:p.data,$setOnInsert:{repository:repo._id}},{upsert:true,new:true,runValidators:true});
 await event(req.user._id,repo,"branch.protection_updated","branch_protection",rule.pattern,"Updated protection rules for "+rule.pattern+".",rule._id);
 res.json({rule});
}));
router.delete("/:id/branch-protection",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 assertManage(await roleFor(repo,req.user._id));
 const p=z.object({pattern:z.string().trim().min(1).max(120)}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide the exact branch protection pattern to remove.");
 const removed=await BranchProtection.findOneAndDelete({repository:repo._id,pattern:p.data.pattern});
 if(!removed)throw notFound("Branch protection rule not found.");
 await event(req.user._id,repo,"branch.protection_deleted","branch_protection",removed.pattern,"Removed protection rules for "+removed.pattern+".",removed._id);
 res.json({deleted:true,pattern:removed.pattern});
}));
router.get("/:id/files",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);const ref=String(req.query.ref||repo.defaultBranch);res.json({files:await listFiles(repo._id,ref),ref});}));
router.get("/:id/files/content",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);res.json(await readFile(repo._id,String(req.query.ref||repo.defaultBranch),String(req.query.path||"")));}));
router.get("/:id/files/history",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const ref=String(req.query.ref||repo.defaultBranch);
 const file=String(req.query.path||"");
 const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
 res.json({history:await fileHistory(repo._id,ref,file,limit),ref,path:file});
}));
router.get("/:id/files/blame",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertRead(await roleFor(repo,req.user._id),repo);
 const ref=String(req.query.ref||repo.defaultBranch);
 const file=String(req.query.path||"");
 res.json(await fileBlame(repo._id,ref,file));
}));
router.get("/:id/commits",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);res.json({commits:await listCommits(repo._id,String(req.query.ref||repo.defaultBranch),Number(req.query.limit)||50)});}));
router.post("/:id/revert",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 const role=await roleFor(repo,req.user._id);
 assertWrite(role);
 const p=z.object({
  branch:z.string().trim().min(1).max(160),
  commitSha:z.string().regex(/^[a-f0-9]{40}$/i),
  expectedHead:z.string().regex(/^[a-f0-9]{40}$/i)
 }).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Choose a branch, commit and current branch head.",p.error.flatten());
 const protection=await protectionForBranch(repo,p.data.branch);if(protection?.requirePullRequest)throw new AppError(409,"DIRECT_PUSH_BLOCKED","This branch requires changes to be merged through an approved pull request.",{pattern:protection.pattern});
 const result=await withRepositoryLock(repo._id,()=>revertCommit(repo._id,p.data.branch,p.data.commitSha,p.data.expectedHead,req.user));
 await event(req.user._id,repo,"commit.reverted","commit",result.revertedCommit,"Reverted commit "+result.revertedCommit.slice(0,7)+" on "+result.branch+".",result.revertCommit);
 res.status(201).json({revert:result});
}));
router.get("/:id/commits/:sha/diff",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);res.json({diff:await diffCommit(repo._id,req.params.sha)});}));
router.get("/:id/branches",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);res.json({branches:await listBranches(repo._id)});}));
router.post("/:id/branches",asyncHandler(async(req,res)=>{requireDurableRepositoryStorage();const repo=await getRepo(req.params.id);assertWrite(await roleFor(repo,req.user._id));const p=z.object({name:z.string().trim().min(1).max(120),base:z.string().trim().min(1).max(160).optional()}).safeParse(req.body);if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide a valid branch and base ref.");const branch=await withRepositoryLock(repo._id,()=>createBranch(repo._id,p.data.name,p.data.base||repo.defaultBranch));await event(req.user._id,repo,"branch.created","branch",branch.name,"Created branch "+branch.name+".",branch.name);res.status(201).json({branch});}));
router.delete("/:id/branches",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 assertWrite(await roleFor(repo,req.user._id));
 const p=z.object({name:z.string().trim().min(1).max(160),expectedHead:z.string().regex(/^[a-f0-9]{40}$/i)}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide a branch name and its current head SHA.");
 const protection=await protectionForBranch(repo,p.data.name);
 if(protection?.preventDeletion)throw new AppError(409,"BRANCH_PROTECTED","This branch is protected from deletion.",{pattern:protection.pattern});
 const result=await withRepositoryLock(repo._id,()=>deleteBranch(repo._id,p.data.name,repo.defaultBranch,p.data.expectedHead));
 await event(req.user._id,repo,"branch.deleted","branch",result.name,"Deleted merged branch "+result.name+".",result.name);
 res.json({deleted:true,branch:result.name,deletedHead:result.deletedHead});
}));
router.post("/:id/merge-preview",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);const p=z.object({source:z.string().min(1).max(160),target:z.string().min(1).max(160)}).safeParse(req.body);if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Choose source and target branches.");res.json(await previewMerge(repo._id,p.data.source,p.data.target));}));
router.post("/:id/merge",asyncHandler(async(req,res)=>{requireDurableRepositoryStorage();const repo=await getRepo(req.params.id);assertManage(await roleFor(repo,req.user._id));const p=z.object({source:z.string().min(1).max(160),target:z.string().min(1).max(160),expectedHead:z.string().regex(/^[a-f0-9]{40}$/i).optional()}).safeParse(req.body);if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Choose valid source and target branches.");const protection=await protectionForBranch(repo,p.data.target);if(protection?.requirePullRequest)throw new AppError(409,"PULL_REQUEST_REQUIRED","This target branch accepts merges only through an approved pull request.",{pattern:protection.pattern});
 const result=await withRepositoryLock(repo._id,()=>mergeBranches(repo._id,p.data.source,p.data.target,p.data.expectedHead));await event(req.user._id,repo,"branch.merged","merge",p.data.source,"Merged "+p.data.source+" into "+p.data.target+".",p.data.source);res.json({merged:true,result});}));
router.post("/:id/merge-resolve",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 assertManage(await roleFor(repo,req.user._id));
 const p=z.object({
  source:z.string().trim().min(1).max(160),
  target:z.string().trim().min(1).max(160),
  expectedHead:z.string().regex(/^[a-f0-9]{40}$/i),
  expectedSourceSha:z.string().regex(/^[a-f0-9]{40}$/i),
  resolutions:z.array(z.object({
   path:z.string().trim().min(1).max(500),
   content:z.string().max(1048576).optional(),
   delete:z.boolean().optional()
  }).strict()).max(50)
 }).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","The source, target, branch heads or conflict resolutions are invalid.",p.error.flatten());
 const protection=await protectionForBranch(repo,p.data.target);if(protection?.requirePullRequest)throw new AppError(409,"PULL_REQUEST_REQUIRED","This target branch accepts merges only through an approved pull request.",{pattern:protection.pattern});
 const result=await withRepositoryLock(repo._id,()=>resolveMergeConflicts(repo._id,p.data.source,p.data.target,p.data.expectedHead,p.data.expectedSourceSha,p.data.resolutions,req.user));
 await event(req.user._id,repo,"branch.merged","merge",p.data.source,"Resolved merge conflicts and merged "+p.data.source+" into "+p.data.target+".",result.mergeCommit);
 res.status(201).json({merged:true,result});
}));
router.post("/:id/commits",asyncHandler(async(req,res)=>{requireDurableRepositoryStorage();const repo=await getRepo(req.params.id);assertWrite(await roleFor(repo,req.user._id));const p=z.object({branch:z.string().min(1).max(160),path:z.string().min(1).max(500),content:z.string().max(1048576),message:z.string().trim().min(3).max(180)}).safeParse(req.body);if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Branch, path, content or commit message is invalid.");const protection=await protectionForBranch(repo,p.data.branch);if(protection?.requirePullRequest)throw new AppError(409,"DIRECT_PUSH_BLOCKED","This branch requires changes to be merged through an approved pull request.",{pattern:protection.pattern});
 const commit=await withRepositoryLock(repo._id,()=>commitFile(repo._id,p.data.branch,p.data.path,p.data.content,p.data.message,req.user));await event(req.user._id,repo,"commit.created","repository",repo.name,"Committed "+p.data.path+" to "+p.data.branch+".",commit.sha);res.status(201).json({commit});}));
router.get("/:id/issues",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);const filter={repository:repo._id};if(["open","closed"].includes(req.query.status))filter.status=req.query.status;const issues=await Issue.find(filter).sort({number:-1}).limit(Math.min(100,Number(req.query.limit)||100)).populate("author","username displayName avatarUrl").populate("assignee","username displayName avatarUrl");res.json({issues});}));
router.post("/:id/issues",asyncHandler(async(req,res)=>{
 const repo=await getRepo(req.params.id);
 assertWrite(await roleFor(repo,req.user._id));
 const p=z.object({title:z.string().trim().min(1).max(180),description:z.string().max(12000).optional().default(""),priority:z.enum(["low","medium","high","critical"]).default("medium"),labels:z.array(z.string().trim().min(1).max(30)).max(12).default([])}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Issue details are invalid.",p.error.flatten());
 const last=await Issue.findOne({repository:repo._id}).sort({number:-1}).select("number");
 const number=await nextSequence("issue:"+repo._id,(last?.number||0));
 let issue;
 try{issue=await Issue.create({repository:repo._id,number,...p.data,author:req.user._id});}
 catch(error){if(error.code===11000)throw new AppError(409,"ISSUE_NUMBER_CONFLICT","An issue number conflicted. Refresh and try again.");throw error;}
 await event(req.user._id,repo,"issue.created","issue",issue.title,"Opened issue #"+issue.number+": "+issue.title+".",issue._id);
 res.status(201).json({issue:await Issue.findById(issue._id).populate("author","username displayName avatarUrl")});
}));
router.post("/:id/collaborators",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertManage(await roleFor(repo,req.user._id));const p=z.object({username:z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/),role:z.enum(["maintainer","developer","viewer"]).default("developer")}).safeParse(req.body);if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide a valid username and role.");const person=await User.findOne({username:p.data.username.toLowerCase()}).select("_id username displayName avatarUrl");if(!person)throw new AppError(404,"USER_NOT_FOUND","No CodeVault account has that username.");if(person._id.toString()===repo.owner._id.toString())throw new AppError(400,"OWNER_IS_NOT_COLLABORATOR","The owner already has full access.");try{const collaborator=await Collaborator.create({repository:repo._id,user:person._id,role:p.data.role,invitedBy:req.user._id,acceptedAt:new Date()});await event(req.user._id,repo,"collaborator.added","collaborator",person.username,"Added @"+person.username+" as "+p.data.role+".",person._id);res.status(201).json({collaborator:{...collaborator.toObject(),user:person}});}catch(e){if(e.code===11000)throw new AppError(409,"COLLABORATOR_EXISTS","That user already has access.");throw e;}}));
router.get("/:id/collaborators",asyncHandler(async(req,res)=>{const repo=await getRepo(req.params.id);assertRead(await roleFor(repo,req.user._id),repo);const collaborators=await Collaborator.find({repository:repo._id,acceptedAt:{$ne:null}}).populate("user","username displayName avatarUrl").populate("invitedBy","username displayName");res.json({collaborators,owner:repo.owner});}));
router.delete("/:id",asyncHandler(async(req,res)=>{
 requireDurableRepositoryStorage();
 const repo=await getRepo(req.params.id);
 if(await roleFor(repo,req.user._id)!=="owner")throw new AppError(403,"PERMISSION_DENIED","Only the owner can delete a repository.");
 const p=z.object({confirmation:z.string()}).strict().safeParse(req.body);
 if(!p.success||p.data.confirmation!==repo.name)throw new AppError(400,"CONFIRMATION_REQUIRED","Send the exact repository name to confirm deletion.");
 await withRepositoryLock(repo._id,async()=>{
  await assertRepositoryLease(repo._id);
  await fs.rm(repositoryPath(repo._id),{recursive:true,force:true});
  await purgeRepositoryRecords(repo._id);
  await Repository.deleteOne({_id:repo._id});
 });
 await event(req.user._id,null,"repository.deleted","repository",repo.name,"Deleted repository "+repo.name+".",repo._id);
 res.status(204).end();
}));
export default router;
