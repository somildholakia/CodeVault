import SequenceCounter from "../models/SequenceCounter.js";
import {AppError} from "../utils/errors.js";

const sequenceKeyPattern = /^(issue|pull_request):[a-f0-9]{24}$/i;

export async function nextSequence(key, initialValue = 0, counterModel = SequenceCounter) {
  if (typeof key !== "string" || !sequenceKeyPattern.test(key)) {
    throw new AppError(500, "INVALID_SEQUENCE_KEY", "A valid repository-scoped sequence key is required.");
  }
  if (!Number.isSafeInteger(initialValue) || initialValue < 0) {
    throw new AppError(500, "INVALID_SEQUENCE_BASE", "The current sequence value is invalid.");
  }

  // Keep an existing counter at least as high as legacy records before incrementing.
  // Concurrent first-time upserts can race on the _id index; the winner creates it,
  // while the loser continues to the atomic increment after the duplicate-key result.
  try {
    await counterModel.updateOne(
      {_id: key},
      {$max: {value: initialValue}},
      {upsert: true}
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const counter = await counterModel.findOneAndUpdate(
    {_id: key},
    {$inc: {value: 1}},
    {new: true}
  );
  if (!Number.isSafeInteger(counter?.value) || counter.value < 1) {
    throw new AppError(500, "SEQUENCE_ALLOCATION_FAILED", "The next repository item number could not be allocated.");
  }
  return counter.value;
}
