import mongoose from "mongoose";
const reviewSchema=new mongoose.Schema({
 user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},
 decision:{type:String,enum:["approved","changes_requested","commented"],required:true},
 body:{type:String,default:"",maxlength:5000},
 submittedAt:{type:Date,default:Date.now},
 commitSha:{type:String,default:"",match:/^$|^[a-f0-9]{40}$/i}
},{_id:false});
const reviewThreadSchema=new mongoose.Schema({
 author:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},
 body:{type:String,required:true,trim:true,minlength:1,maxlength:5000},
 path:{type:String,required:true,trim:true,maxlength:500},
 line:{type:Number,required:true,min:1},
 side:{type:String,enum:["RIGHT"],default:"RIGHT"},
 commitSha:{type:String,required:true,match:/^[a-f0-9]{40}$/i},
 resolved:{type:Boolean,default:false,index:true},
 resolvedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},
 resolvedAt:{type:Date,default:null},
 createdAt:{type:Date,default:Date.now}
});
const schema=new mongoose.Schema({
 repository:{type:mongoose.Schema.Types.ObjectId,ref:"Repository",required:true,index:true},
 number:{type:Number,required:true},
 title:{type:String,required:true,trim:true,minlength:1,maxlength:180},
 description:{type:String,default:"",maxlength:12000},
 author:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
 sourceBranch:{type:String,required:true,maxlength:160},
 targetBranch:{type:String,required:true,maxlength:160},
 status:{type:String,enum:["open","merging","merged","closed"],default:"open",index:true},
 mergeStartedAt:{type:Date,default:null},
 mergeSourceSha:{type:String,default:"",match:/^$|^[a-f0-9]{40}$/i},
 mergeTargetSha:{type:String,default:"",match:/^$|^[a-f0-9]{40}$/i},
 mergeClaimedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},
 mergeOperationId:{type:String,default:"",match:/^$|^[A-Za-z0-9_-]{8,128}$/},
 reviews:{type:[reviewSchema],default:[]},
 reviewThreads:{type:[reviewThreadSchema],default:[]},
 mergeCommit:{type:String,default:""},
 mergedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},
 mergedAt:{type:Date,default:null},
 closedAt:{type:Date,default:null}
},{timestamps:true,versionKey:false});
schema.index({repository:1,number:1},{unique:true});
schema.index({repository:1,status:1,updatedAt:-1});
schema.index({repository:1,sourceBranch:1,targetBranch:1},{unique:true,name:"uniq_active_pull_request_branch_pair",partialFilterExpression:{status:{$in:["open","merging"]}}});
export default mongoose.model("PullRequest",schema);
