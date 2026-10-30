import {Router} from "express";
import {requireAuth} from "../middleware/auth.js";
import Collaborator from "../models/Collaborator.js";
import Repository from "../models/Repository.js";
import Activity from "../models/Activity.js";
import {asyncHandler} from "../utils/errors.js";
const router=Router();router.use(requireAuth);
router.get("/",asyncHandler(async(req,res)=>{const ms=await Collaborator.find({user:req.user._id,acceptedAt:{$ne:null}}).select("repository");const own=await Repository.find({owner:req.user._id}).select("_id");const ids=[...ms.map(x=>x.repository),...own.map(x=>x._id)];const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));const activities=await Activity.find({$or:[{repository:{$in:ids}},{actor:req.user._id,repository:null}]}).sort({createdAt:-1}).limit(limit).populate("actor","username displayName");res.json({activities});}));
export default router;
