import mongoose from "mongoose";
const schema=new mongoose.Schema({actor:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},repository:{type:mongoose.Schema.Types.ObjectId,ref:"Repository",default:null,index:true},action:{type:String,required:true,maxlength:80},entityType:{type:String,enum:["repository","issue","branch","merge","collaborator","pull_request","release","user"],required:true},entityId:{type:String,default:""},entityName:{type:String,default:"",maxlength:180},summary:{type:String,required:true,maxlength:350},metadata:{type:mongoose.Schema.Types.Mixed,default:{}}},{timestamps:true,versionKey:false});
schema.index({repository:1,createdAt:-1});schema.index({actor:1,createdAt:-1});
export default mongoose.model("Activity",schema);
