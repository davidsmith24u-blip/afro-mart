const test = require("node:test");
const assert = require("node:assert");
const { kmToSteps, toCSV, toJSON } = require("../www/convert.js");

test("converts km and miles", () => {
  assert.strictEqual(kmToSteps(10), 13158);
  assert.strictEqual(kmToSteps(1, 76, "mi"), 2118);
});
test("rejects invalid input", () => {
  assert.ok(isNaN(kmToSteps(-1)));
  assert.ok(isNaN(kmToSteps(5, 0)));
});
test("exports", () => {
  const e = [{ date: "2026-01-01T00:00:00Z", distanceKm: 10, stepLengthCm: 76, steps: 13158 }];
  assert.match(toCSV(e), /13158/);
  assert.strictEqual(JSON.parse(toJSON(e)).samples[0].steps, 13158);
});
