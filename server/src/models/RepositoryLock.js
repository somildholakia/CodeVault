import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: {type: String, required: true},
  ownerToken: {type: String, default: ""},
  leaseUntil: {type: Date, default: () => new Date(0)},
  fence: {type: Number, default: 0, min: 0},
  acquiredAt: {type: Date, default: null},
  heartbeatAt: {type: Date, default: null},
  releasedAt: {type: Date, default: null}
}, {
  collection: "repository_locks",
  timestamps: false,
  versionKey: false
});

// Retain released rows so the monotonic fencing value is never reset.
export default mongoose.models.RepositoryLock ||
  mongoose.model("RepositoryLock", schema);
