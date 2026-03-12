export {
  sendSMS,
  parseInboundSMS,
  logInboundSMS,
  validateTwilioSignature,
  type TwilioConfig,
  type SendSMSParams,
  type SendSMSResult,
  type InboundSMS,
} from "./twilio-sms";

export {
  initiateOutboundCall,
  processCallEndEvent,
  getCallStatus,
  type VapiConfig,
  type OutboundCallParams,
  type OutboundCallResult,
  type VapiCallEndEvent,
} from "./vapi-calls";

export {
  sendEmail,
  emailTemplates,
  type GHLEmailConfig,
  type SendEmailParams,
  type SendEmailResult,
} from "./ghl-email";

export {
  resolveTemplate,
  smsTemplates,
  type TemplateParams,
} from "./message-templates";

export {
  processOutreachQueue,
  handleInboundSMSReply,
} from "./outreach-processor";
