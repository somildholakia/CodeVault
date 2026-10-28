export class AppError extends Error {
  constructor(statusCode, code, message, details) { super(message); this.statusCode = statusCode; this.code = code; this.details = details; }
}
export function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
export function notFound(message = "The requested resource was not found.") { return new AppError(404, "NOT_FOUND", message); }
