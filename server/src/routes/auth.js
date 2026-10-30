import {Router} from "express";
import bcrypt from "bcryptjs";
import {z} from "zod";
import User from "../models/User.js";
import Activity from "../models/Activity.js";
import {requireAuth,issueSession,clearSession} from "../middleware/auth.js";
import {AppError,asyncHandler} from "../utils/errors.js";
const router=Router();
router.post("/register",asyncHandler(async(req,res)=>{
 const p=z.object({username:z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).transform(v=>v.toLowerCase()),displayName:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(10).max(128)}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Account details are invalid.",p.error.flatten());
 const {username,displayName,email,password}=p.data;let user;
 try{user=await User.create({username,displayName,email,passwordHash:await bcrypt.hash(password,12)});}catch(e){if(e.code===11000)throw new AppError(409,"ACCOUNT_EXISTS","That username or email is already registered.");throw e;}
 issueSession(user,res);await Activity.create({actor:user._id,action:"account.created",entityType:"user",entityId:user._id.toString(),entityName:user.username,summary:"Created a CodeVault account."});
 res.status(201).json({user:user.toJSON()});
}));
router.post("/login",asyncHandler(async(req,res)=>{
 const p=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Enter a valid email and password.");
 const user=await User.findOne({email:p.data.email}).select("+passwordHash");
 if(!user||!(await bcrypt.compare(p.data.password,user.passwordHash)))throw new AppError(401,"INVALID_CREDENTIALS","Email or password is incorrect.");
 if(user.status!=="active")throw new AppError(403,"ACCOUNT_DISABLED","This account is disabled.");
 user.lastLoginAt=new Date();await user.save();issueSession(user,res);res.json({user:user.toJSON()});
}));
router.post("/logout",(_req,res)=>{clearSession(res);res.status(204).end();});
router.get("/me",requireAuth,(req,res)=>res.json({user:req.user.toJSON()}));
router.patch("/profile",requireAuth,asyncHandler(async(req,res)=>{
 const p=z.object({displayName:z.string().trim().min(1).max(80).optional(),bio:z.string().trim().max(500).optional(),skills:z.array(z.string().trim().min(1).max(40)).max(40).optional()}).strict().safeParse(req.body);
 if(!p.success)throw new AppError(400,"VALIDATION_ERROR","Profile fields are invalid.",p.error.flatten());
 Object.assign(req.user,p.data);await req.user.save();res.json({user:req.user.toJSON()});
}));
export default router;
