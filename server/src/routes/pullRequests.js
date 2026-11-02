import {Router} from "express";
import mongoose from "mongoose";
import {z} from "zod";
import PullRequest from "../models/PullRequest.js";
import Repository from "../models/Repository.js";
import Collaborator from "../models/Collaborator.js";
import Activity from "../models/Activity.js";
import BranchProtection from "../models/BranchProtection.js";
import {requireAuth} from "../middleware/auth.js";
import {AppError,asyncHandler,notFound} from "../utils/errors.js";
import {listBranches,previewMerge,mergeBranches,listCommits,withRepositoryLock,diffBranches,isAddedDiffLine} from "../services/git.js";
import {evaluateReviewGate,selectBranchProtection} from "../services/pullRequestPolicy.js";
import {nextSequence} from "../services/sequences.js";
import {assertPullRequestOpen,claimPullRequestMerge,completePullRequestMerge,releasePullRequestMerge} from "../services/pullRequestLifecycle.js";
const router=Router();router.use(requireAuth);
async function findRepo(id){if(!mongoose.isValidObjectId(id))throw notFound("Repository not found.");const repo=await Repository.findById(id);if(!repo)throw notFound("Repository not found.");return repo;}
async function roleFor(repo,userId){if(repo.owner.toString()===userId.toString())return "owner";const c=await Collaborator.findOne({repository:repo._id,user:userId,acceptedAt:{$ne:null}});return c?.role||null;}
function assertRead(role,repo){if(!role&&repo.visibility!=="public")throw notFound("Repository not found.");}
function assertWrite(role){if(!["owner","maintainer","developer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","You do not have permission to create or update pull requests.");}
function assertManage(role){if(!["owner","maintainer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","Only the owner or a maintainer can merge pull requests.");}
async function protectionForBranch(repo,branch){const rules=await BranchProtection.find({repository:repo._id}).lean();return selectBranchProtection(rules,branch);}
async function loadPullRequest(id){if(!mongoose.isValidObjectId(id))throw notFound("Pull request not found.");const pr=await PullRequest.findById(id).populate("repository").populate("author","username displayName avatarUrl").populate("mergedBy","username displayName avatarUrl").populate("reviews.user","username displayName avatarUrl").populate("reviewThreads.author","username displayName avatarUrl").populate("reviewThreads.resolvedBy","username displayName avatarUrl");if(!pr||!pr.repository)throw notFound("Pull request not found.");return pr;}
async function record(actor,pr,action,summary){await Activity.create({actor,repository:pr.repository._id,action,entityType:"pull_request",entityId:pr._id.toString(),entityName:pr.title,summary});}
router.get("/",asyncHandler(async(req,res)=>{
 const membership=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository");
 const own=await Repository.find({owner:req.user._id}).select("_id");
 const visible=await Repository.find({visibility:"public"}).select("_id").limit(500);
 const ids=[...membership.map(x=>x.repository),...own.map(x=>x._id),...visible.map(x=>x._id)];
 const filter={repository:{$in:ids}};
 if(req.query.repository){const repo=await findRepo(String(req.query.repository));assertRead(await roleFor(repo,req.user._id),repo);filter.repository=repo._id;}
 if(["open","merged","closed"].includes(req.query.status))filter.status=req.query.status;
 const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
 const pullRequests=await PullRequest.find(filter).sort({updatedAt:-1}).limit(limit).populate("repository","name visibility defaultBranch").populate("author","username displayName avatarUrl").populate("mergedBy","username displayName avatarUrl");
 res.json({pullRequests});
}));
router.post("/",asyncHandler(async(req,res)=>{
 const p=z.object({repositoryId:z.string().regex(/^[a-f0-9]{24}$/i),title:z.string().trim().min(1).max(180),description:z.string().max(12000).optional().default(""),sourceBranch:z.string().trim().min(1).max(160),targetBranch:z.string().trim().min(1).max(160)}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Pull-request details are invalid.",p.error.flatten());
 const repo=await findRepo(p.data.repositoryId);assertWrite(await roleFor(repo,req.user._id));
 if(p.data.sourceBranch===p.data.targetBranch)throw new AppError(400,"SAME_BRANCH","Source and target branches must be different.");
 const branches=await listBranches(repo._id),names=new Set(branches.map(x=>x.name));
 if(!names.has(p.data.sourceBranch)||!names.has(p.data.targetBranch))throw new AppError(400,"BRANCH_NOT_FOUND","Choose existing source and target branches.");
 const duplicate=await PullRequest.findOne({repository:repo._id,sourceBranch:p.data.sourceBranch,targetBranch:p.data.targetBranch,status:{$in:["open","merging"]}});
 if(duplicate)throw new AppError(409,"PULL_REQUEST_EXISTS","An open pull request already exists for these branches.");
 const last=await PullRequest.findOne({repository:repo._id}).sort({number:-1}).select("number");
 const number=await nextSequence("pull_request:"+repo._id,(last?.number||0));
 let pr;
 try{pr=await PullRequest.create({repository:repo._id,number,title:p.data.title,description:p.data.description,sourceBranch:p.data.sourceBranch,targetBranch:p.data.targetBranch,author:req.user._id});}
 catch(e){
  if(e.code===11000){
   const duplicateNow=await PullRequest.exists({repository:repo._id,sourceBranch:p.data.sourceBranch,targetBranch:p.data.targetBranch,status:{$in:["open","merging"]}});
   if(duplicateNow)throw new AppError(409,"PULL_REQUEST_EXISTS","An open pull request already exists for these branches.");
   throw new AppError(409,"PULL_REQUEST_NUMBER_CONFLICT","A pull request number conflicted. Refresh and try again.");
  }
  throw e;
 }
 await record(req.user._id,pr,"pull_request.created","Opened pull request #"+pr.number+": "+pr.title+".");
 res.status(201).json({pullRequest:await PullRequest.findById(pr._id).populate("repository","name visibility defaultBranch").populate("author","username displayName avatarUrl")});
}));
router.get("/:id",asyncHandler(async(req,res)=>{const pr=await loadPullRequest(req.params.id);assertRead(await roleFor(pr.repository,req.user._id),pr.repository);res.json({pullRequest:pr});}));
router.post("/:id/reviews",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);assertRead(await roleFor(pr.repository,req.user._id),pr.repository);
 assertPullRequestOpen(pr,"reviewed");
 if(pr.author._id.toString()===req.user._id.toString())throw new AppError(403,"SELF_REVIEW_NOT_ALLOWED","You cannot review your own pull request.");
 const p=z.object({decision:z.enum(["approved","changes_requested","commented"]),body:z.string().trim().max(5000).optional().default("")}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Review decision or comment is invalid.");
 const sourceBranch=(await listBranches(pr.repository._id)).find(item=>item.name===pr.sourceBranch);
 if(!sourceBranch)throw new AppError(409,"SOURCE_BRANCH_MISSING","The pull-request source branch no longer exists.");
 const reviews=pr.reviews.map(item=>item.toObject());
 const existing=reviews.find(item=>String(item.user?._id??item.user)===req.user._id.toString());
 if(existing){existing.decision=p.data.decision;existing.body=p.data.body;existing.submittedAt=new Date();existing.commitSha=sourceBranch.sha;}
 else reviews.push({user:req.user._id,decision:p.data.decision,body:p.data.body,commitSha:sourceBranch.sha,submittedAt:new Date()});
 const saved=await PullRequest.findOneAndUpdate({_id:pr._id,status:"open"},{$set:{reviews}},{new:true});
 if(!saved)throw new AppError(409,"PULL_REQUEST_BUSY","This pull request has started merging. Refresh before changing its review.");
 await record(req.user._id,pr,"pull_request.reviewed","Reviewed pull request #"+pr.number+" as "+p.data.decision+".");
 const updated=await loadPullRequest(pr._id);res.status(201).json({pullRequest:updated});
}));
router.get("/:id/diff",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);
 assertRead(await roleFor(pr.repository,req.user._id),pr.repository);
 const result=await diffBranches(pr.repository._id,pr.sourceBranch,pr.targetBranch);
 res.json({sourceSha:result.source,targetSha:result.target,diff:result.diff});
}));
router.post("/:id/comments",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);
 const role=await roleFor(pr.repository,req.user._id);
 if(!role)throw new AppError(403,"COLLABORATOR_REQUIRED","Only repository members can add inline review comments.");
 assertPullRequestOpen(pr,"commented on");
 const p=z.object({
  path:z.string().trim().min(1).max(500),
  line:z.number().int().min(1).max(10000000),
  side:z.enum(["RIGHT"]).default("RIGHT"),
  commitSha:z.string().regex(/^[a-f0-9]{40}$/i),
  body:z.string().trim().min(1).max(5000)
 }).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Inline comment details are invalid.",p.error.flatten());
 const diff=await diffBranches(pr.repository._id,pr.sourceBranch,pr.targetBranch);
 if(diff.source!==p.data.commitSha)throw new AppError(409,"DIFF_OUTDATED","The source branch has moved. Refresh the pull-request diff before commenting.");
 if(!isAddedDiffLine(diff.diff,p.data.path,p.data.line))throw new AppError(400,"LINE_NOT_IN_DIFF","Inline comments must be attached to an added line in the current pull-request diff.");
 pr.reviewThreads.push({author:req.user._id,body:p.data.body,path:p.data.path,line:p.data.line,side:p.data.side,commitSha:p.data.commitSha});
 const saved=await PullRequest.findOneAndUpdate({_id:pr._id,status:"open"},{$set:{reviewThreads:pr.reviewThreads.map(item=>item.toObject())}},{new:true});
 if(!saved)throw new AppError(409,"PULL_REQUEST_BUSY","This pull request has started merging. Refresh before adding a comment.");
 await record(req.user._id,pr,"pull_request.inline_comment","Commented on "+p.data.path+":"+p.data.line+" in pull request #"+pr.number+".");
 res.status(201).json({pullRequest:await loadPullRequest(pr._id)});
}));
router.patch("/:id/comments/:commentId",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);
 const role=await roleFor(pr.repository,req.user._id);
 assertRead(role,pr.repository);
 assertPullRequestOpen(pr,"updated");
 const p=z.object({resolved:z.boolean()}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Provide a resolved boolean value.");
 const thread=pr.reviewThreads.id(req.params.commentId);
 if(!thread)throw notFound("Inline review comment not found.");
 const authorId=thread.author?._id?.toString?.()||thread.author?.toString?.();
 if(authorId!==req.user._id.toString()&&!["owner","maintainer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","Only the comment author, owner or maintainer can resolve this thread.");
 const saved=await PullRequest.findOneAndUpdate(
  {_id:pr._id,status:"open","reviewThreads._id":thread._id},
  {$set:{
   "reviewThreads.$.resolved":p.data.resolved,
   "reviewThreads.$.resolvedBy":p.data.resolved?req.user._id:null,
   "reviewThreads.$.resolvedAt":p.data.resolved?new Date():null
  }},
  {new:true}
 );
 if(!saved)throw new AppError(409,"PULL_REQUEST_BUSY","This pull request has started merging. Refresh before resolving a thread.");
 await record(req.user._id,pr,p.data.resolved?"pull_request.thread_resolved":"pull_request.thread_reopened",(p.data.resolved?"Resolved":"Reopened")+" an inline review thread in pull request #"+pr.number+".");
 res.json({pullRequest:await loadPullRequest(pr._id)});
}));
router.post("/:id/close",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id),role=await roleFor(pr.repository,req.user._id);
 if(pr.author._id.toString()!==req.user._id.toString()&&!["owner","maintainer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","Only the author, owner or maintainer can close this pull request.");
 assertPullRequestOpen(pr,"closed");
 const closedAt=new Date();
 const closed=await PullRequest.findOneAndUpdate({_id:pr._id,status:"open"},{$set:{status:"closed",closedAt}},{new:true});
 if(!closed)throw new AppError(409,"PULL_REQUEST_BUSY","This pull request has started merging. Refresh before closing it.");
 await record(req.user._id,pr,"pull_request.closed","Closed pull request #"+pr.number+".");
 res.json({pullRequest:await loadPullRequest(pr._id)});
}));
router.post("/:id/merge",asyncHandler(async(req,res)=>{
 const initial=await loadPullRequest(req.params.id);
 assertManage(await roleFor(initial.repository,req.user._id));
 assertPullRequestOpen(initial,"merged");

 // Atomically claim the PR state before validating mutable reviews or touching Git.
 // All review/comment/close writes use status=open compare-and-set filters, so they
 // cannot slip in after this claim.
 await claimPullRequestMerge(initial._id);

 let mergeResult;
 let gitMergeCompleted=false;
 try {
  mergeResult=await withRepositoryLock(initial.repository._id,async()=>{
   const pr=await loadPullRequest(initial._id);
   if(pr.status!=="merging")throw new AppError(409,"PULL_REQUEST_STATE_CHANGED","The pull-request merge claim is no longer active.");
   assertManage(await roleFor(pr.repository,req.user._id));

   const sourceBranch=(await listBranches(pr.repository._id)).find(item=>item.name===pr.sourceBranch);
   if(!sourceBranch)throw new AppError(409,"SOURCE_BRANCH_MISSING","The pull-request source branch no longer exists.");

   const protection=await protectionForBranch(pr.repository,pr.targetBranch);
   const gate=evaluateReviewGate(pr.reviews,pr.author._id,{
    requiredApprovals:protection?.requiredApprovals??1,
    currentSourceSha:sourceBranch.sha,
    dismissStaleApprovals:protection?.dismissStaleApprovals===true
   });
   if(gate.reason==="changes_requested")throw new AppError(409,"CHANGES_REQUESTED","A reviewer has requested changes. Resolve the feedback and update the review before merging.");
   if(!gate.allowed)throw new AppError(409,"APPROVAL_REQUIRED","This branch requires "+gate.requiredApprovals+" current independent approval(s).",{
    approvalCount:gate.approvalCount,
    requiredApprovals:gate.requiredApprovals,
    staleApprovals:gate.staleApprovals||0
   });
   if(protection?.requireResolvedConversations&&pr.reviewThreads.some(thread=>!thread.resolved)) {
    throw new AppError(409,"UNRESOLVED_CONVERSATIONS","Resolve every inline review conversation before merging.");
   }

   const preview=await previewMerge(pr.repository._id,pr.sourceBranch,pr.targetBranch);
   if(!preview.canMerge)throw new AppError(409,"MERGE_CONFLICT","Resolve the branch conflicts before merging.",{conflicts:preview.conflicts,files:preview.files});
   await mergeBranches(pr.repository._id,pr.sourceBranch,pr.targetBranch,preview.targetHead,sourceBranch.sha);
   gitMergeCompleted=true;
   const latest=await listCommits(pr.repository._id,pr.targetBranch,1);
   const mergeCommit=latest[0]?.sha||"";
   await completePullRequestMerge(pr._id,{
    mergedBy:req.user._id,
    mergedAt:new Date(),
    mergeCommit
   });
   return {mergeCommit,number:pr.number,title:pr.title};
  });

  const completed=await loadPullRequest(initial._id);
  await record(req.user._id,completed,"pull_request.merged","Merged pull request #"+mergeResult.number+": "+mergeResult.title+".");
  res.json({pullRequest:completed,mergeCommit:mergeResult.mergeCommit});
 } catch(error) {
  // Never reopen after Git has moved the target branch. A later request must
  // reconcile a merge whose database finalization failed, rather than create a
  // second PR or risk applying the merge twice.
  if(!gitMergeCompleted)await releasePullRequestMerge(initial._id).catch(()=>{});
  throw error;
 }
}));
export default router;
