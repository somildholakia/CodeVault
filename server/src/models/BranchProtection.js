import mongoose from "mongoose";
const schema=new mongoose.Schema({
 repository:{type:mongoose.Schema.Types.ObjectId,ref:"Repository",required:true,index:true},
 pattern:{type:String,required:true,trim:true,minlength:1,maxlength:120},
 requirePullRequest:{type:Boolean,default:true},
 requiredApprovals:{type:Number,default:1,min:0,max:10},
 requireResolvedConversations:{type:Boolean,default:true},
 dismissStaleApprovals:{type:Boolean,default:true},
 preventDeletion:{type:Boolean,default:true}
},{timestamps:true,versionKey:false});
schema.index({repository:1,pattern:1},{unique:true});
export default mongoose.model("BranchProtection",schema);
