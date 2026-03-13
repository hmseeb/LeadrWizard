import { describe, it, expect } from "vitest";
import {
  formatPhoneE164,
  calculateCompletionPct,
  slugify,
  truncate,
  generateVisitorId,
} from "../index";

describe("formatPhoneE164", () => {
  it("formats 10-digit US number", () => {
    expect(formatPhoneE164("5551234567")).toBe("+15551234567");
  });

  it("formats 11-digit US number starting with 1", () => {
    expect(formatPhoneE164("15551234567")).toBe("+15551234567");
  });

  it("handles number with formatting characters", () => {
    expect(formatPhoneE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("preserves + prefix", () => {
    expect(formatPhoneE164("+44 20 1234 5678")).toBe("+442012345678");
  });
});

describe("calculateCompletionPct", () => {
  it("returns 100 when total is 0", () => {
    expect(calculateCompletionPct(0, 0)).toBe(100);
  });

  it("calculates correct percentage", () => {
    expect(calculateCompletionPct(3, 10)).toBe(30);
    expect(calculateCompletionPct(7, 10)).toBe(70);
    expect(calculateCompletionPct(10, 10)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(calculateCompletionPct(1, 3)).toBe(33);
    expect(calculateCompletionPct(2, 3)).toBe(67);
  });
});

describe("slugify", () => {
  it("converts to lowercase kebab-case", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slugify("AI Website (Pro)")).toBe("ai-website-pro");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  --hello--  ")).toBe("hello");
  });
});

describe("truncate", () => {
  it("returns text as-is if shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("generateVisitorId", () => {
  it("generates a string starting with v_", () => {
    const id = generateVisitorId();
    expect(id).toMatch(/^v_[a-z0-9]+_[a-z0-9]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateVisitorId()));
    expect(ids.size).toBe(100);
  });
});
