/**
 * Twilio phone number provisioner.
 * Searches for available local numbers and purchases one for an org.
 * Used during org signup (automatic) or from settings page (manual trigger).
 *
 * Uses raw Twilio REST API (no SDK) -- consistent with existing twilio-sms.ts pattern.
 * Twilio AvailablePhoneNumbers: https://www.twilio.com/docs/phone-numbers/global-catalog/api/available-numbers
 * Twilio IncomingPhoneNumbers: https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
 */

export interface TwilioProvisionConfig {
  accountSid: string;
  authToken: string;
}

export interface ProvisionOptions {
  country?: string;
  areaCode?: string;
  smsEnabled?: boolean;
}

export interface ProvisionResult {
  phoneNumber: string;
  sid: string;
}

/**
 * Search for an available phone number and purchase it.
 * Returns the purchased number in E.164 format and its SID.
 */
export async function provisionPhoneNumber(
  config: TwilioProvisionConfig,
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const country = options.country || "US";
  const auth = Buffer.from(
    `${config.accountSid}:${config.authToken}`
  ).toString("base64");

  // 1. Search for available numbers
  const searchParams = new URLSearchParams({
    SmsEnabled: String(options.smsEnabled ?? true),
    VoiceEnabled: "true",
    ...(options.areaCode ? { AreaCode: options.areaCode } : {}),
  });

  const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${searchParams}`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!searchRes.ok) {
    const errorBody = await searchRes.text();
    throw new Error(
      `Twilio number search failed (${searchRes.status}): ${errorBody}`
    );
  }

  const searchData = (await searchRes.json()) as {
    available_phone_numbers: Array<{
      phone_number: string;
      friendly_name: string;
    }>;
  };

  if (!searchData.available_phone_numbers?.length) {
    throw new Error("No phone numbers available in the requested area");
  }

  // 2. Purchase the first available number
  const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`;

  const buyRes = await fetch(buyUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      PhoneNumber: searchData.available_phone_numbers[0].phone_number,
    }),
  });

  if (!buyRes.ok) {
    const errorBody = await buyRes.text();
    throw new Error(
      `Twilio number purchase failed (${buyRes.status}): ${errorBody}`
    );
  }

  const result = (await buyRes.json()) as {
    phone_number: string;
    sid: string;
  };

  return {
    phoneNumber: result.phone_number,
    sid: result.sid,
  };
}
