import jwt from "jsonwebtoken";
import User from "../models/User.js";
import {AppError,asyncHandler} from "../utils/errors.js";
const cookieName=()=>process.env.COOKIE_NAME||"codevault_session";
export function cookieOptions(){return {httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:7*24*60*60*1000};}
export const requireAuth=asyncHandler(async(req,_res,next)=>{
 const token=req.cookies?.[cookieName()]||(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)throw new AppError(401,"AUTH_REQUIRED","Sign in to continue.");
 if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new AppError(503,"AUTH_NOT_CONFIGURED","Authentication is not configured.");
 let payload;try{payload=jwt.verify(token,process.env.JWT_SECRET,{issuer:"codevault",audience:"codevault-web"});}catch{throw new AppError(401,"SESSION_INVALID","Your session has expired. Sign in again.");}
 const user=await User.findById(payload.sub).select("_id username displayName email avatarUrl bio skills createdAt status");
 if(!user||user.status!=="active")throw new AppError(401,"SESSION_INVALID","The account for this session is unavailable.");
 req.user=user;next();
});
export function issueSession(user,res){
 if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new AppError(503,"AUTH_NOT_CONFIGURED","Set JWT_SECRET to a random value at least 32 characters long.");
 const token=jwt.sign({},process.env.JWT_SECRET,{subject:user._id.toString(),expiresIn:process.env.JWT_TTL||"7d",issuer:"codevault",audience:"codevault-web"});
 res.cookie(cookieName(),token,cookieOptions());
}
export function clearSession(res){res.clearCookie(cookieName(),cookieOptions());}
