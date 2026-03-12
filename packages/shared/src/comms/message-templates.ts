/**
 * SMS message templates for the outreach cadence.
 * Each template takes params and returns the message body.
 */

export interface TemplateParams {
  name: string;
  businessName?: string;
  packageName?: string;
  onboardingUrl: string;
  itemsRemaining?: number;
}

export const smsTemplates: Record<
  string,
  (params: TemplateParams) => string
> = {
  welcome_sms: (p) =>
    `Hey ${p.name}! Welcome aboard! I'm your setup assistant. Ready to get your ${p.packageName || "services"} running? Tap here: ${p.onboardingUrl}\n\nOr reply CALL and I'll ring you right now!`,

  reminder_1: (p) =>
    `Hey ${p.name}, just checking — ready to finish your setup? It only takes a few minutes: ${p.onboardingUrl}`,

  reminder_2: (p) =>
    `${p.name}, your ${p.packageName || "services"} are waiting! Setup takes just 5 min: ${p.onboardingUrl}\n\nReply CALL and I'll walk you through it by phone.`,

  call_reminder_1: (p) =>
    `Hi ${p.name}, I tried calling to help with your setup. When's a good time? Tap here to do it online: ${p.onboardingUrl}`,

  email_reminder_1: (p) =>
    `${p.name}, I also sent you an email about finishing your setup. You have ${p.itemsRemaining || "a few"} items left: ${p.onboardingUrl}`,

  reminder_3: (p) =>
    `${p.name}, your services can't activate until setup is done. Only ${p.itemsRemaining || "a few"} items left — takes 5 min: ${p.onboardingUrl}`,

  call_reminder_2: (p) =>
    `Hi ${p.name}, tried reaching you again. Your setup is almost done! Reply CALL or tap: ${p.onboardingUrl}`,

  urgent_reminder: (p) =>
    `${p.name}, this is urgent — your ${p.packageName || "services"} are on hold until you complete setup. Please finish here: ${p.onboardingUrl}\n\nOr reply CALL for immediate phone assistance.`,

  final_call: (p) =>
    `${p.name}, final notice — I've been trying to reach you about your ${p.packageName || "setup"}. A team member will reach out shortly if we don't hear from you. Finish here: ${p.onboardingUrl}`,

  // Post-onboarding
  completion_sms: (p) =>
    `Great news ${p.name}! Your setup is complete and your services are now live. If you need anything, just text me back!`,

  // Context-specific
  gmb_access_reminder: (p) =>
    `${p.name}, we need you to approve our Google Business access request. Check your email from Google and click "Approve." Need help? Reply HELP.`,

  a2p_update: (p) =>
    `${p.name}, your business texting registration is being processed. We'll let you know once it's approved (usually 2-4 weeks).`,

  website_preview: (p) =>
    `${p.name}, your website preview is ready! Check it out: ${p.onboardingUrl}\n\nReply APPROVE if it looks good, or let me know what to change (up to 3 adjustments).`,
};

/**
 * Resolve a template name to a message body with the given params.
 */
export function resolveTemplate(
  templateName: string,
  params: TemplateParams
): string {
  const template = smsTemplates[templateName];
  if (!template) {
    return `Hi ${params.name}, please continue your setup here: ${params.onboardingUrl}`;
  }
  return template(params);
}
