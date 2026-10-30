import mongoose from "mongoose";
const schema=new mongoose.Schema({repository:{type:mongoose.Schema.Types.ObjectId,ref:"Repository",required:true,index:true},user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},role:{type:String,enum:["maintainer","developer","viewer"],default:"viewer"},invitedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},acceptedAt:{type:Date,default:null}},{timestamps:true,versionKey:false});
schema.index({repository:1,user:1},{unique:true});
export default mongoose.model("Collaborator",schema);
