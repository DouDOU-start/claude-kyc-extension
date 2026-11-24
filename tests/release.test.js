import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions } from "../extension/lib/release.js";

test("release version comparison follows semantic ordering", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("v1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});
