import mongoose from "mongoose";
const reviewSchema=new mongoose.Schema({
 user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},
 decision:{type:String,enum:["approved","changes_requested","commented"],required:true},
 body:{type:String,default:"",maxlength:5000},
 submittedAt:{type:Date,default:Date.now}
},{_id:false});
const schema=new mongoose.Schema({
 repository:{type:mongoose.Schema.Types.ObjectId,ref:"Repository",required:true,index:true},
 number:{type:Number,required:true},
 title:{type:String,required:true,trim:true,minlength:1,maxlength:180},
 description:{type:String,default:"",maxlength:12000},
 author:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
 sourceBranch:{type:String,required:true,maxlength:160},
 targetBranch:{type:String,required:true,maxlength:160},
 status:{type:String,enum:["open","merged","closed"],default:"open",index:true},
 reviews:{type:[reviewSchema],default:[]},
 mergeCommit:{type:String,default:""},
 mergedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},
 mergedAt:{type:Date,default:null},
 closedAt:{type:Date,default:null}
},{timestamps:true,versionKey:false});
schema.index({repository:1,number:1},{unique:true});
schema.index({repository:1,status:1,updatedAt:-1});
export default mongoose.model("PullRequest",schema);
