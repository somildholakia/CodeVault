import {Router} from "express";
import mongoose from "mongoose";
import {z} from "zod";
import Issue from "../models/Issue.js";
import Collaborator from "../models/Collaborator.js";
import Activity from "../models/Activity.js";
import User from "../models/User.js";
import {requireAuth} from "../middleware/auth.js";
import {AppError,asyncHandler,notFound} from "../utils/errors.js";
const router=Router();router.use(requireAuth);
async function load(id){if(!mongoose.isValidObjectId(id))throw notFound("Issue not found.");const issue=await Issue.findById(id).populate("repository").populate("author","username displayName avatarUrl").populate("assignee","username displayName avatarUrl");if(!issue||!issue.repository)throw notFound("Issue not found.");return issue;}
async function role(issue,uid){const repo=issue.repository;if(repo.owner.toString()===uid.toString())return "owner";const c=await Collaborator.findOne({repository:repo._id,user:uid,acceptedAt:{$ne:null}});if(c)return c.role;if(repo.visibility==="public")return "public-viewer";throw notFound("Issue not found.");}
async function event(uid,issue,action,summary){await Activity.create({actor:uid,repository:issue.repository._id,action,entityType:"issue",entityId:issue._id.toString(),entityName:issue.title,summary});}
router.get("/issues/:issueId",asyncHandler(async(req,res)=>{const issue=await load(req.params.issueId);await role(issue,req.user._id);res.json({issue});}));
router.patch("/issues/:issueId",asyncHandler(async(req,res)=>{
 const issue=await load(req.params.issueId),r=await role(issue,req.user._id);if(!["owner","maintainer","developer"].includes(r))throw new AppError(403,"PERMISSION_DENIED","You cannot update issues in this repository.");
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
