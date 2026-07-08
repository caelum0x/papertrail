import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "../lib/admin-audit/apiKeys";

describe("admin-audit apiKeys", () => {
  describe("generateApiKey", () => {
    it("returns a key with the pt_live_ prefix", () => {
      const { key } = generateApiKey();
      expect(key.startsWith("pt_live_")).toBe(true);
    });

    it("stores a hash that matches hashApiKey of the raw key", () => {
      const { key, keyHash } = generateApiKey();
      expect(keyHash).toBe(hashApiKey(key));
    });

    it("never stores the raw secret in the hash", () => {
      const { key, keyHash } = generateApiKey();
      expect(keyHash).not.toContain(key);
      // sha256 hex is 64 chars
      expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("exposes a non-secret prefix that is a strict, shorter start of the key", () => {
      const { key, keyPrefix } = generateApiKey();
      expect(key.startsWith(keyPrefix)).toBe(true);
      expect(keyPrefix.length).toBeLessThan(key.length);
      expect(keyPrefix.startsWith("pt_live_")).toBe(true);
    });

    it("produces unique keys across calls", () => {
      const a = generateApiKey();
      const b = generateApiKey();
      expect(a.key).not.toBe(b.key);
      expect(a.keyHash).not.toBe(b.keyHash);
    });
  });

  describe("hashApiKey", () => {
    it("is deterministic for the same input", () => {
      expect(hashApiKey("pt_live_abc")).toBe(hashApiKey("pt_live_abc"));
    });

    it("differs for different inputs", () => {
      expect(hashApiKey("pt_live_abc")).not.toBe(hashApiKey("pt_live_abd"));
    });
  });
});
