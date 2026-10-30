import {Router} from "express";
import {requireAuth} from "../middleware/auth.js";
import Repository from "../models/Repository.js";
import Collaborator from "../models/Collaborator.js";
import Issue from "../models/Issue.js";
import Activity from "../models/Activity.js";
import {listCommits} from "../services/git.js";
import {asyncHandler} from "../utils/errors.js";
const router=Router();router.use(requireAuth);
router.get("/overview",asyncHandler(async(req,res)=>{
 const ms=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository"),ids=ms.map(x=>x.repository);
 const repositories=await Repository.find({$or:[{owner:req.user._id},{visibility:"public"},{_id:{$in:ids}}]}).sort({updatedAt:-1}).limit(50).populate("owner","username displayName avatarUrl");
 const repoIds=repositories.map(x=>x._id),openIssues=await Issue.countDocuments({repository:{$in:repoIds},status:"open"}),collaborators=await Collaborator.countDocuments({repository:{$in:repoIds},acceptedAt:{$ne:null}});
 const activity=[],today=new Date();today.setHours(0,0,0,0);
 for(let offset=6;offset>=0;offset--){const start=new Date(today);start.setDate(start.getDate()-offset);const end=new Date(start);end.setDate(end.getDate()+1);let count=0;for(const repo of repositories.filter(x=>x.gitInitialized).slice(0,20)){try{const logs=await listCommits(repo._id,repo.defaultBranch,100);count+=logs.filter(c=>new Date(c.date)>=start&&new Date(c.date)<end).length;}catch{}}activity.push({date:start.toISOString().slice(0,10),label:start.toLocaleDateString("en",{weekday:"short"}),commits:count});}
 const recentActivity=await Activity.find({$or:[{repository:{$in:repoIds}},{actor:req.user._id,repository:null}]}).sort({createdAt:-1}).limit(8).populate("actor","username displayName");
 res.json({summary:{repositories:repositories.length,openIssues,collaborators,commitsLast7Days:activity.reduce((n,d)=>n+d.commits,0)},repositories,activity,recentActivity,generatedAt:new Date().toISOString()});
}));
export default router;
