import { describe, it, expect } from "vitest";
import { parseInboundSMS } from "../twilio-sms";

describe("parseInboundSMS", () => {
  it("parses a standard Twilio webhook body", () => {
    const body = {
      MessageSid: "SM1234567890",
      From: "+15551234567",
      To: "+15559876543",
      Body: "Hello, I need help with setup",
      NumMedia: "0",
    };

    const result = parseInboundSMS(body);

    expect(result.messageSid).toBe("SM1234567890");
    expect(result.from).toBe("+15551234567");
    expect(result.to).toBe("+15559876543");
    expect(result.body).toBe("Hello, I need help with setup");
    expect(result.numMedia).toBe(0);
    expect(result.mediaUrls).toEqual([]);
  });

  it("parses media attachments", () => {
    const body = {
      MessageSid: "SM123",
      From: "+15551234567",
      To: "+15559876543",
      Body: "",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/img1.jpg",
      MediaUrl1: "https://api.twilio.com/media/img2.jpg",
    };

    const result = parseInboundSMS(body);

    expect(result.numMedia).toBe(2);
    expect(result.mediaUrls).toEqual([
      "https://api.twilio.com/media/img1.jpg",
      "https://api.twilio.com/media/img2.jpg",
    ]);
  });

  it("handles empty/missing fields gracefully", () => {
    const result = parseInboundSMS({});

    expect(result.messageSid).toBe("");
    expect(result.from).toBe("");
    expect(result.to).toBe("");
    expect(result.body).toBe("");
    expect(result.numMedia).toBe(0);
  });
});
