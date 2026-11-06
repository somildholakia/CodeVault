const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function hasBearerAuthorization(value = "") {
  return /^Bearer\s+\S+/i.test(String(value || ""));
}

export function validateUnsafeRequestOrigin({
  method,
  origin,
  allowedOrigins,
  hasSessionCookie = false,
  hasBearerToken = false
}) {
  if (safeMethods.has(String(method || "").toUpperCase())) return null;

  if (origin && !allowedOrigins.includes(origin)) {
    return {
      code: "ORIGIN_NOT_ALLOWED",
      message: "This request origin is not allowed."
    };
  }

  if (!origin && hasSessionCookie && !hasBearerToken) {
    return {
      code: "ORIGIN_REQUIRED",
      message: "Cookie-authenticated changes must include an allowed request origin."
    };
  }

  return null;
}
