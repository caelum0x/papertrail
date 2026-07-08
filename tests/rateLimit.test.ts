import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit } from "../lib/rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_MAX = "3";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
  });

  it("allows requests up to the max", () => {
    const key = `test-key-${Math.random()}`;
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(true);
  });

  it("blocks requests once the max is exceeded", () => {
    const key = `test-key-${Math.random()}`;
    checkRateLimit(key);
    checkRateLimit(key);
    checkRateLimit(key);
    const fourth = checkRateLimit(key);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-key-a-${Math.random()}`;
    const keyB = `test-key-b-${Math.random()}`;
    checkRateLimit(keyA);
    checkRateLimit(keyA);
    checkRateLimit(keyA);
    expect(checkRateLimit(keyA).allowed).toBe(false);
    expect(checkRateLimit(keyB).allowed).toBe(true);
  });
});
