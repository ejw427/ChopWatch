import { describe, expect, it } from "vitest";
import {
  clearProductVersionCache,
  getProductVersion,
} from "../src/version.js";

describe("getProductVersion", () => {
  it("reads a semver from root package.json", () => {
    clearProductVersionCache();
    const v = getProductVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
