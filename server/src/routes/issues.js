import {Router} from "express";
import mongoose from "mongoose";
import {z} from "zod";
import Issue from "../models/Issue.js";
import Repository from "../models/Repository.js";
import {buildIssueListFilter,canWriteIssueRole,normalizeIssueListScope} from "../services/issueList.js";
import Collaborator from "../models/Collaborator.js";
import Activity from "../models/Activity.js";
import User from "../models/User.js";
import {requireAuth} from "../middleware/auth.js";
import {AppError,asyncHandler,notFound} from "../utils/errors.js";
const router=Router();router.use(requireAuth);
async function load(id){if(!mongoose.isValidObjectId(id))throw notFound("Issue not found.");const issue=await Issue.findById(id).populate("repository").populate("author","username displayName avatarUrl").populate("assignee","username displayName avatarUrl").populate("comments.author","username displayName avatarUrl");if(!issue||!issue.repository)throw notFound("Issue not found.");return issue;}
async function role(issue,uid){const repo=issue.repository;if(repo.owner.toString()===uid.toString())return "owner";const c=await Collaborator.findOne({repository:repo._id,user:uid,acceptedAt:{$ne:null}});if(c)return c.role;if(repo.visibility==="public")return "public-viewer";throw notFound("Issue not found.");}
async function event(uid,issue,action,summary){await Activity.create({actor:uid,repository:issue.repository._id,action,entityType:"issue",entityId:issue._id.toString(),entityName:issue.title,summary});}
router.get("/issues",asyncHandler(async(req,res)=>{
 const memberships=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository role");
 const repositoryIds=[...new Set(memberships.map(x=>x.repository.toString()))];
 const owned=await Repository.find({owner:req.user._id}).select("_id");
 const ownedIds=owned.map(x=>x._id.toString());
 const accessibleIds=[...new Set([...repositoryIds,...ownedIds])];
 const writableRepositoryIds=new Set([...ownedIds,...memberships.filter(item=>canWriteIssueRole(item.role)).map(item=>item.repository.toString())]);
 const status=String(req.query.status||"open");
 if(!["open","closed","all"].includes(status))throw new AppError(400,"INVALID_ISSUE_STATUS","Choose open, closed or all issues.");
 const priority=String(req.query.priority||"");
 if(priority&&!["low","medium","high","critical"].includes(priority))throw new AppError(400,"INVALID_ISSUE_PRIORITY","Choose a valid issue priority.");
 const scope=normalizeIssueListScope(String(req.query.scope||"all"));
 const page=Math.max(1,Math.min(10000,Number.parseInt(req.query.page,10)||1));
 const limit=Math.max(1,Math.min(50,Number.parseInt(req.query.limit,10)||20));
 const filter=buildIssueListFilter({repositoryIds:accessibleIds,status,priority,search:req.query.search,scope,userId:req.user._id});
 const [total,issues]=await Promise.all([
  Issue.countDocuments(filter),
  Issue.find(filter).sort({updatedAt:-1,_id:-1}).skip((page-1)*limit).limit(limit)
   .populate("repository","name slug visibility defaultBranch")
   .populate("author","username displayName avatarUrl")
   .populate("assignee","username displayName avatarUrl")
 ]);
 const visibleIssues=issues.map(issue=>{
  const item=issue.toObject();
  const repositoryId=item.repository?._id?.toString()||item.repository?.toString();
  item.canWrite=writableRepositoryIds.has(repositoryId);
  return item;
 });
 res.json({issues:visibleIssues,total,page,limit,pages:Math.ceil(total/limit)});
}));
router.get("/issues/:issueId",asyncHandler(async(req,res)=>{const issue=await load(req.params.issueId);const permission=await role(issue,req.user._id);const data=issue.toObject();data.canWrite=canWriteIssueRole(permission);res.json({issue:data});}));
router.patch("/issues/:issueId",asyncHandler(async(req,res)=>{
 const issue=await load(req.params.issueId),r=await role(issue,req.user._id);if(!canWriteIssueRole(r))throw new AppError(403,"PERMISSION_DENIED","You cannot update issues in this repository.");
 const p=z.object({title:z.string().trim().min(1).max(180).optional(),description:z.string().max(12000).optional(),status:z.enum(["open","closed"]).optional(),priority:z.enum(["low","medium","high","critical"]).optional(),labels:z.array(z.string().trim().min(1).max(30)).max(12).optional(),assigneeUsername:z.string().trim().min(3).max(30).optional()}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Issue fields are invalid.",p.error.flatten());
 const changes={...p.data};delete changes.assigneeUsername;
 if(p.data.assigneeUsername){const person=await User.findOne({username:p.data.assigneeUsername.toLowerCase()}).select("_id");if(!person)throw new AppError(404,"USER_NOT_FOUND","No account has that username.");const member=await Collaborator.findOne({repository:issue.repository._id,user:person._id,acceptedAt:{$ne:null}});if(person._id.toString()!==issue.repository.owner.toString()&&!member)throw new AppError(400,"ASSIGNEE_NOT_MEMBER","Assignee must be the owner or an accepted collaborator.");changes.assignee=person._id;}
 if(changes.status==="closed")issue.closedAt=new Date();if(changes.status==="open")issue.closedAt=null;Object.assign(issue,changes);await issue.save();await event(req.user._id,issue,"issue.updated","Updated issue #"+issue.number+": "+issue.title+".");
 res.json({issue:await Issue.findById(issue._id).populate("author","username displayName avatarUrl").populate("assignee","username displayName avatarUrl")});
}));
router.post("/issues/:issueId/comments",asyncHandler(async(req,res)=>{
 const issue=await load(req.params.issueId);await role(issue,req.user._id);const p=z.object({body:z.string().trim().min(1).max(5000)}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Comment text must be between 1 and 5000 characters.");
 issue.comments.push({author:req.user._id,body:p.data.body});await issue.save();await event(req.user._id,issue,"issue.comment.created","Commented on issue #"+issue.number+".");
 const saved=await Issue.findById(issue._id).populate("comments.author","username displayName avatarUrl");res.status(201).json({comments:saved.comments});
}));
export default router;
