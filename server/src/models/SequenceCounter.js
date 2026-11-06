import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: {type: String, required: true},
  value: {type: Number, required: true, min: 0}
}, {
  collection: "sequence_counters",
  versionKey: false,
  timestamps: true
});

export default mongoose.model("SequenceCounter", schema);
