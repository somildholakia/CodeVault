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
