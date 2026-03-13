import { describe, it, expect } from "vitest";
import { resolveTemplate, smsTemplates } from "../message-templates";

describe("resolveTemplate", () => {
  it("resolves the welcome_sms template", () => {
    const result = resolveTemplate("welcome_sms", {
      name: "Jane",
      packageName: "Pro Bundle",
      onboardingUrl: "https://app.example.com/onboard?session=123",
    });

    expect(result).toContain("Hey Jane");
    expect(result).toContain("Pro Bundle");
    expect(result).toContain("https://app.example.com/onboard?session=123");
  });

  it("falls back to default message for unknown templates", () => {
    const result = resolveTemplate("nonexistent_template", {
      name: "Bob",
      onboardingUrl: "https://example.com",
    });

    expect(result).toContain("Hi Bob");
    expect(result).toContain("https://example.com");
  });

  it("handles missing optional params in templates", () => {
    const result = resolveTemplate("welcome_sms", { name: "Test" });
    expect(result).toContain("Hey Test");
    expect(result).toContain("services"); // falls back to "services" default
  });
});

describe("smsTemplates", () => {
  it("has all expected template keys", () => {
    const expectedKeys = [
      "welcome_sms",
      "reminder_1",
      "reminder_2",
      "reminder_3",
      "urgent_reminder",
      "final_call",
      "completion_sms",
      "gmb_access_reminder",
      "a2p_update",
      "website_preview",
    ];

    for (const key of expectedKeys) {
      expect(smsTemplates).toHaveProperty(key);
      expect(typeof smsTemplates[key]).toBe("function");
    }
  });
});
