import test from "node:test";
import assert from "node:assert/strict";
import {cookieOptions, sessionCookieName} from "../src/middleware/auth.js";

function withEnvironment(overrides, callback) {
  const keys = new Set([...Object.keys(overrides), "NODE_ENV", "COOKIE_SAME_SITE", "COOKIE_NAME"]);
  const previous = new Map([...keys].map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("uses a Lax cookie for local development by default", () => {
  withEnvironment({NODE_ENV: "development", COOKIE_SAME_SITE: undefined}, () => {
    const options = cookieOptions();
    assert.equal(options.sameSite, "lax");
    assert.equal(options.secure, false);
    assert.equal(options.httpOnly, true);
  });
});

test("uses a Secure None cookie in production for split frontend and API deployments", () => {
  withEnvironment({NODE_ENV: "production", COOKIE_SAME_SITE: undefined}, () => {
    const options = cookieOptions();
    assert.equal(options.sameSite, "none");
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
  });
});

test("never emits SameSite=None without Secure, including explicit local configuration", () => {
  withEnvironment({NODE_ENV: "development", COOKIE_SAME_SITE: "none"}, () => {
    const options = cookieOptions();
    assert.equal(options.sameSite, "none");
    assert.equal(options.secure, true);
  });
});

test("allows an explicit Strict policy when the frontend and API share a site", () => {
  withEnvironment({NODE_ENV: "production", COOKIE_SAME_SITE: "strict"}, () => {
    const options = cookieOptions();
    assert.equal(options.sameSite, "strict");
    assert.equal(options.secure, true);
  });
});

test("falls back to the environment default for an unsupported SameSite value", () => {
  withEnvironment({NODE_ENV: "production", COOKIE_SAME_SITE: "invalid"}, () => {
    assert.equal(cookieOptions().sameSite, "none");
    assert.equal(cookieOptions().secure, true);
  });
});

test("supports a configurable session cookie name", () => {
  withEnvironment({COOKIE_NAME: "custom_codevault_session"}, () => {
    assert.equal(sessionCookieName(), "custom_codevault_session");
  });
});
