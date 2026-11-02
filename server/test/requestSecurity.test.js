import test from "node:test";
import assert from "node:assert/strict";
import {hasBearerAuthorization,validateUnsafeRequestOrigin} from "../src/utils/requestSecurity.js";

const allowedOrigins = ["https://codevault.example", "https://preview.codevault.example"];

test("recognizes a non-empty bearer token case-insensitively", () => {
  assert.equal(hasBearerAuthorization("Bearer abc123"), true);
  assert.equal(hasBearerAuthorization("bearer abc123"), true);
});

test("does not treat empty or non-bearer authorization as bearer authentication", () => {
  assert.equal(hasBearerAuthorization("Bearer "), false);
  assert.equal(hasBearerAuthorization("Basic abc123"), false);
  assert.equal(hasBearerAuthorization(""), false);
});

test("does not require an origin for safe read-only methods", () => {
  assert.equal(validateUnsafeRequestOrigin({
    method: "GET",
    origin: "https://attacker.example",
    allowedOrigins
  }), null);
});

test("allows state-changing requests from an exact configured origin", () => {
  assert.equal(validateUnsafeRequestOrigin({
    method: "POST",
    origin: "https://codevault.example",
    allowedOrigins,
    hasSessionCookie: true
  }), null);
});

test("rejects a state-changing request from an untrusted origin", () => {
  assert.deepEqual(validateUnsafeRequestOrigin({
    method: "DELETE",
    origin: "https://attacker.example",
    allowedOrigins,
    hasSessionCookie: true
  }), {
    code: "ORIGIN_NOT_ALLOWED",
    message: "This request origin is not allowed."
  });
});

test("rejects cookie-authenticated changes when the request has no origin", () => {
  assert.deepEqual(validateUnsafeRequestOrigin({
    method: "PATCH",
    origin: undefined,
    allowedOrigins,
    hasSessionCookie: true
  }), {
    code: "ORIGIN_REQUIRED",
    message: "Cookie-authenticated changes must include an allowed request origin."
  });
});

test("allows originless API clients that authenticate with a bearer token", () => {
  assert.equal(validateUnsafeRequestOrigin({
    method: "PUT",
    origin: undefined,
    allowedOrigins,
    hasSessionCookie: false,
    hasBearerToken: true
  }), null);
});

test("allows originless unauthenticated login and registration requests", () => {
  assert.equal(validateUnsafeRequestOrigin({
    method: "POST",
    origin: undefined,
    allowedOrigins
  }), null);
});

test("treats browser-safe OPTIONS requests as preflight rather than mutations", () => {
  assert.equal(validateUnsafeRequestOrigin({
    method: "OPTIONS",
    origin: "https://attacker.example",
    allowedOrigins
  }), null);
});
