import test from "node:test";
import assert from "node:assert/strict";
import { requestHostJSON } from "../tools/sync/http.mjs";

const loading = (header = "x-cocktail-plus-state") =>
  new Response("[]", {
    headers: {
      [header]: "ASYNC-MISS",
      "x-cocktail-plus-retry-after-ms": "100",
    },
  });

test("an asynchronous cache placeholder is reread before returning characters", async () => {
  for (const header of ["x-cocktail-plus-state", "x-cocktail-cache"]) {
    let calls = 0;
    const characters = [{ name: "测试角色", avatar: "installed.png" }];
    const result = await requestHostJSON(
      async () => (++calls === 1 ? loading(header) : Response.json(characters)),
      "/api/characters/all",
    );
    assert.deepEqual(result, characters);
    assert.equal(calls, 2);
  }
});

test("an actually empty character list is returned without retry", async () => {
  let calls = 0;
  assert.deepEqual(
    await requestHostJSON(async () => {
      calls++;
      return Response.json([]);
    }, "/api/characters/all"),
    [],
  );
  assert.equal(calls, 1);
});

test("a cache that never becomes ready fails explicitly after bounded reads", async () => {
  let calls = 0;
  await assert.rejects(
    requestHostJSON(async () => {
      calls++;
      return loading();
    }, "/api/characters/all"),
    { code: "HOST_CACHE_LOADING" },
  );
  assert.equal(calls, 10);
});

test("write responses, authorization failures and network failures are never retried", async () => {
  for (const endpoint of [
    "/api/characters/merge-attributes",
    "/api/worldinfo/edit",
  ]) {
    let calls = 0;
    await requestHostJSON(async () => {
      calls++;
      return loading();
    }, endpoint);
    assert.equal(calls, 1);
  }
  for (const status of [401, 403, 500]) {
    let calls = 0;
    await assert.rejects(
      requestHostJSON(async () => {
        calls++;
        return new Response("host failure", { status });
      }, "/api/characters/all"),
      { code: status === 500 ? "HOST_HTTP" : "HOST_AUTH" },
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    requestHostJSON(async () => {
      calls++;
      throw new Error("connection reset");
    }, "/api/characters/all"),
    /connection reset/,
  );
  assert.equal(calls, 1);
});
