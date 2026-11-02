import {Router} from "express";
import {requireAuth} from "../middleware/auth.js";
import Repository from "../models/Repository.js";
import Collaborator from "../models/Collaborator.js";
import Issue from "../models/Issue.js";
import Activity from "../models/Activity.js";
import {listCommitDatesSince} from "../services/git.js";
import {asyncHandler} from "../utils/errors.js";
const router=Router();router.use(requireAuth);
router.get("/overview",asyncHandler(async(req,res)=>{
 const ms=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository"),ids=ms.map(x=>x.repository);
 const repositories=await Repository.find({$or:[{owner:req.user._id},{visibility:"public"},{_id:{$in:ids}}]}).sort({updatedAt:-1}).limit(50).populate("owner","username displayName avatarUrl");
 const repoIds=repositories.map(x=>x._id),openIssues=await Issue.countDocuments({repository:{$in:repoIds},status:"open"}),collaborators=await Collaborator.countDocuments({repository:{$in:repoIds},acceptedAt:{$ne:null}});
 const today=new Date();today.setUTCHours(0,0,0,0);
 const weekStart=new Date(today);weekStart.setUTCDate(weekStart.getUTCDate()-6);
 const countByDay=new Map();
 const trackedRepositories=repositories.filter(repo=>repo.gitInitialized).slice(0,20);
 const datesByRepository=await Promise.all(trackedRepositories.map(async repo=>{
  try{return await listCommitDatesSince(repo._id,repo.defaultBranch,weekStart);}
  catch{return [];}
 }));
 for(const dates of datesByRepository){
  for(const timestamp of dates){
   const day=timestamp.slice(0,10);
   countByDay.set(day,(countByDay.get(day)||0)+1);
  }
 }
 const activity=[];
 for(let offset=6;offset>=0;offset--){
  const start=new Date(today);
  start.setUTCDate(start.getUTCDate()-offset);
  const date=start.toISOString().slice(0,10);
  activity.push({
   date,
   label:start.toLocaleDateString("en",{weekday:"short",timeZone:"UTC"}),
   commits:countByDay.get(date)||0
  });
 }
 const recentActivity=await Activity.find({$or:[{repository:{$in:repoIds}},{actor:req.user._id,repository:null}]}).sort({createdAt:-1}).limit(8).populate("actor","username displayName");
 res.json({summary:{repositories:repositories.length,openIssues,collaborators,commitsLast7Days:activity.reduce((n,d)=>n+d.commits,0)},repositories,activity,recentActivity,generatedAt:new Date().toISOString()});
}));
export default router;
