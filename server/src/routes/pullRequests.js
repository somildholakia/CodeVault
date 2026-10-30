import {Router} from "express";
import mongoose from "mongoose";
import {z} from "zod";
import PullRequest from "../models/PullRequest.js";
import Repository from "../models/Repository.js";
import Collaborator from "../models/Collaborator.js";
import Activity from "../models/Activity.js";
import {requireAuth} from "../middleware/auth.js";
import {AppError,asyncHandler,notFound} from "../utils/errors.js";
import {listBranches,previewMerge,mergeBranches,listCommits,withRepositoryLock} from "../services/git.js";
import {evaluateReviewGate} from "../services/pullRequestPolicy.js";
const router=Router();router.use(requireAuth);
async function findRepo(id){if(!mongoose.isValidObjectId(id))throw notFound("Repository not found.");const repo=await Repository.findById(id);if(!repo)throw notFound("Repository not found.");return repo;}
async function roleFor(repo,userId){if(repo.owner.toString()===userId.toString())return "owner";const c=await Collaborator.findOne({repository:repo._id,user:userId,acceptedAt:{$ne:null}});return c?.role||null;}
function assertRead(role,repo){if(!role&&repo.visibility!=="public")throw notFound("Repository not found.");}
function assertWrite(role){if(!["owner","maintainer","developer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","You do not have permission to create or update pull requests.");}
function assertManage(role){if(!["owner","maintainer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","Only the owner or a maintainer can merge pull requests.");}
async function loadPullRequest(id){if(!mongoose.isValidObjectId(id))throw notFound("Pull request not found.");const pr=await PullRequest.findById(id).populate("repository").populate("author","username displayName avatarUrl").populate("mergedBy","username displayName avatarUrl").populate("reviews.user","username displayName avatarUrl");if(!pr||!pr.repository)throw notFound("Pull request not found.");return pr;}
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
 const duplicate=await PullRequest.findOne({repository:repo._id,sourceBranch:p.data.sourceBranch,targetBranch:p.data.targetBranch,status:"open"});
 if(duplicate)throw new AppError(409,"PULL_REQUEST_EXISTS","An open pull request already exists for these branches.");
 const last=await PullRequest.findOne({repository:repo._id}).sort({number:-1}).select("number");
 let pr;
 try{pr=await PullRequest.create({repository:repo._id,number:(last?.number||0)+1,title:p.data.title,description:p.data.description,sourceBranch:p.data.sourceBranch,targetBranch:p.data.targetBranch,author:req.user._id});}
 catch(e){if(e.code===11000)throw new AppError(409,"PULL_REQUEST_NUMBER_CONFLICT","A pull request was created at the same time. Refresh and try again.");throw e;}
 await record(req.user._id,pr,"pull_request.created","Opened pull request #"+pr.number+": "+pr.title+".");
 res.status(201).json({pullRequest:await PullRequest.findById(pr._id).populate("repository","name visibility defaultBranch").populate("author","username displayName avatarUrl")});
}));
router.get("/:id",asyncHandler(async(req,res)=>{const pr=await loadPullRequest(req.params.id);assertRead(await roleFor(pr.repository,req.user._id),pr.repository);res.json({pullRequest:pr});}));
router.post("/:id/reviews",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);assertRead(await roleFor(pr.repository,req.user._id),pr.repository);
 if(pr.status!=="open")throw new AppError(409,"PULL_REQUEST_CLOSED","Only open pull requests can be reviewed.");
 if(pr.author._id.toString()===req.user._id.toString())throw new AppError(403,"SELF_REVIEW_NOT_ALLOWED","You cannot review your own pull request.");
 const p=z.object({decision:z.enum(["approved","changes_requested","commented"]),body:z.string().trim().max(5000).optional().default("")}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Review decision or comment is invalid.");
 const existing=pr.reviews.find(x=>x.user.toString()===req.user._id.toString());
 if(existing){existing.decision=p.data.decision;existing.body=p.data.body;existing.submittedAt=new Date();}
 else pr.reviews.push({user:req.user._id,decision:p.data.decision,body:p.data.body,submittedAt:new Date()});
 await pr.save();await record(req.user._id,pr,"pull_request.reviewed","Reviewed pull request #"+pr.number+" as "+p.data.decision+".");
 const updated=await loadPullRequest(pr._id);res.status(201).json({pullRequest:updated});
}));
router.post("/:id/close",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id),role=await roleFor(pr.repository,req.user._id);
 if(pr.author._id.toString()!==req.user._id.toString()&&!["owner","maintainer"].includes(role))throw new AppError(403,"PERMISSION_DENIED","Only the author, owner or maintainer can close this pull request.");
 if(pr.status!=="open")throw new AppError(409,"PULL_REQUEST_CLOSED","This pull request is no longer open.");
 pr.status="closed";pr.closedAt=new Date();await pr.save();
 await record(req.user._id,pr,"pull_request.closed","Closed pull request #"+pr.number+".");
 res.json({pullRequest:await loadPullRequest(pr._id)});
}));
router.post("/:id/merge",asyncHandler(async(req,res)=>{
 const pr=await loadPullRequest(req.params.id);assertManage(await roleFor(pr.repository,req.user._id));
 if(pr.status!=="open")throw new AppError(409,"PULL_REQUEST_CLOSED","Only open pull requests can be merged.");
 const gate=evaluateReviewGate(pr.reviews,pr.author._id);
 if(gate.reason==="changes_requested")throw new AppError(409,"CHANGES_REQUESTED","A reviewer has requested changes. Resolve the feedback and update the review before merging.");
 if(!gate.allowed)throw new AppError(409,"APPROVAL_REQUIRED","At least one collaborator must approve this pull request before merging.");
 const preview=await previewMerge(pr.repository._id,pr.sourceBranch,pr.targetBranch);
 if(!preview.canMerge)throw new AppError(409,"MERGE_CONFLICT","Resolve the branch conflicts before merging.",{conflicts:preview.conflicts,files:preview.files});
 await withRepositoryLock(pr.repository._id,()=>mergeBranches(pr.repository._id,pr.sourceBranch,pr.targetBranch,preview.targetHead));
 const latest=await listCommits(pr.repository._id,pr.targetBranch,1);
 pr.status="merged";pr.mergedBy=req.user._id;pr.mergedAt=new Date();pr.mergeCommit=latest[0]?.sha||"";
 await pr.save();await record(req.user._id,pr,"pull_request.merged","Merged pull request #"+pr.number+": "+pr.title+".");
 res.json({pullRequest:await loadPullRequest(pr._id),mergeCommit:pr.mergeCommit});
}));
export default router;
