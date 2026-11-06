import mongoose from "mongoose";

const schema = new mongoose.Schema({
  repository: {type: mongoose.Schema.Types.ObjectId, ref: "Repository", required: true, index: true},
  tagName: {type: String, required: true, trim: true, maxlength: 128},
  name: {type: String, required: true, trim: true, minlength: 1, maxlength: 120},
  notes: {type: String, default: "", maxlength: 5000},
  targetBranch: {type: String, required: true, maxlength: 160},
  targetSha: {type: String, required: true, match: /^[a-f0-9]{40}$/i},
  author: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
  publishedAt: {type: Date, default: Date.now, index: true}
}, {timestamps: true, versionKey: false});

schema.index({repository: 1, tagName: 1}, {unique: true});
schema.index({repository: 1, publishedAt: -1});

export default mongoose.model("Release", schema);
