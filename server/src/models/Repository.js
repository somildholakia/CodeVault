import mongoose from "mongoose";
const schema=new mongoose.Schema({name:{type:String,required:true,trim:true,minlength:1,maxlength:80},slug:{type:String,required:true,trim:true,lowercase:true,match:/^[a-z0-9._-]+$/},description:{type:String,default:"",trim:true,maxlength:350},owner:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},visibility:{type:String,enum:["public","private"],default:"private",index:true},defaultBranch:{type:String,default:"main",maxlength:120},archived:{type:Boolean,default:false},gitInitialized:{type:Boolean,default:false},lastActivityAt:{type:Date,default:Date.now}},{timestamps:true,versionKey:false});
schema.index({owner:1,slug:1},{unique:true});schema.index({visibility:1,updatedAt:-1});
export default mongoose.model("Repository",schema);
