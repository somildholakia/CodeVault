import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.CLIENT_ORIGIN = "https://codevault.example";
const {default: app} = await import("../src/app.js");

test("health endpoint remains readable without an Origin header", async () => {
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
});

test("health endpoint emits credentialed CORS headers for an allowed origin", async () => {
  const response = await request(app)
    .get("/api/health")
    .set("Origin", "https://codevault.example");
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "https://codevault.example");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
});

test("an untrusted origin cannot read the health response through CORS", async () => {
  const response = await request(app)
    .get("/api/health")
    .set("Origin", "https://attacker.example");
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("a cross-origin state-changing request is rejected before database access", async () => {
  const response = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "https://attacker.example")
    .send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ORIGIN_NOT_ALLOWED");
});

test("cookie-authenticated mutation without Origin is rejected", async () => {
  const response = await request(app)
    .post("/api/auth/logout")
    .set("Cookie", "codevault_session=example-session")
    .send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ORIGIN_REQUIRED");
});

test("allowed cookie-authenticated mutation passes origin validation", async () => {
  const response = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "https://codevault.example")
    .set("Cookie", "codevault_session=example-session")
    .send({});
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
});

test("originless bearer-authenticated API request passes origin validation", async () => {
  const response = await request(app)
    .post("/api/auth/logout")
    .set("Authorization", "Bearer example-token")
    .send({});
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
});


test("login attempts have a dedicated low ceiling and a stable JSON error", async () => {
  const responses = [];
  for (let attempt = 0; attempt < 11; attempt++) {
    responses.push(await request(app)
      .post("/api/auth/login")
      .send({email:"rate-limit-login@example.com",password:"correct-horse-battery"}));
  }
  assert.ok(responses.slice(0,10).every(response => response.status === 503));
  assert.equal(responses[10].status,429);
  assert.equal(responses[10].body.error.code,"AUTH_RATE_LIMITED");
  assert.match(responses[10].body.error.message,/15 minutes/);
});

test("registration has a separate, stricter attempt ceiling", async () => {
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    responses.push(await request(app)
      .post("/api/auth/register")
      .send({
        username:"rate_limit_user_"+attempt,
        displayName:"Rate Limit User",
        email:"rate-limit-register-"+attempt+"@example.com",
        password:"correct-horse-battery"
      }));
  }
  assert.ok(responses.slice(0,5).every(response => response.status === 503));
  assert.equal(responses[5].status,429);
  assert.equal(responses[5].body.error.code,"AUTH_RATE_LIMITED");
});
