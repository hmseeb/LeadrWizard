-- Migration: 00017_skip_fields_with_clients_row_fallback.sql
-- Purpose: Stop asking onboarding questions for fields the resolvers
--          already fall back to via the `clients` table. Cuts the
--          IGNITE onboarding from 15-19 questions down to 9-13.
--
-- Background:
--
-- Both auto-trigger resolvers (`resolveWebsiteBuildInput`,
-- `resolveA2PInput`) read the `clients` row at trigger time and use
-- it as a fallback for several fields:
--
--   clients.name          -> a2p contact_name, website-build business_name (2nd fallback)
--   clients.email         -> website-build email, a2p contact_email
--   clients.phone         -> website-build phone, a2p business_phone
--   clients.business_name -> website-build business_name, a2p legal_business_name (RISKY)
--
-- The `clients` row is populated at provisioning time (manual create,
-- GHL import, payment webhook). `name` and `email` are NOT NULL columns,
-- so they're always present. `phone` and `business_name` are nullable
-- but in practice are populated for any real client.
--
-- This means the widget does NOT need to ask the client for these
-- fields again — the resolver finds them on the clients row when the
-- auto-trigger fires. Marking them as `required: false` here means
-- the widget skips them entirely. The resolver still requires a
-- non-empty value, so if the clients row is incomplete, the trigger
-- fails with a "missing required fields" error and Greg can fix it
-- via the manual button's inline form (same flow as the existing
-- niche/services_offered manual override).
--
-- Two A2P fields are KEPT as required even though clients-row fallback
-- exists, for safety:
--
--   - legal_business_name: Twilio Trust Hub matches against IRS
--     records. Falling back to clients.business_name (which is usually
--     the DBA / display name) risks brand rejection by carriers, which
--     adds a 1-7 day delay. The client must explicitly type their
--     legal name.
--
-- All other A2P fields stay required because they have no fallback
-- (ein, business_address/city/state/zip).
--
-- Idempotent: safe to re-run.

-- ============================================================
-- website-build: drop business_name / phone / email from required
-- (resolver falls back to clients row)
-- ============================================================
update public.service_definitions
set
  required_data_fields = '[
    {"key": "business_name", "label": "Business Name", "type": "text", "required": false, "placeholder": "e.g., Acme Plumbing", "help_text": "Leave blank to use the name on file"},
    {"key": "niche", "label": "Business Niche/Industry", "type": "text", "required": true, "placeholder": "e.g., Plumbing, Dentist, Restaurant"},
    {"key": "phone", "label": "Business Phone", "type": "phone", "required": false, "help_text": "Leave blank to use the phone on file"},
    {"key": "email", "label": "Business Email", "type": "email", "required": false, "help_text": "Leave blank to use the email on file"},
    {"key": "services_offered", "label": "Services You Offer", "type": "textarea", "required": true, "placeholder": "List the main services you offer"},
    {"key": "existing_website", "label": "Do you have an existing website? (URL or type ''none'')", "type": "text", "required": true, "placeholder": "https://yourbusiness.com or ''none''", "help_text": "If you already have a site we''ll import your logo, colors, and copy from it. Type ''none'' if you don''t have one."},
    {"key": "tagline", "label": "Business Tagline", "type": "text", "required": false, "placeholder": "e.g., Your trusted local plumber", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "primary_color", "label": "Preferred Brand Color", "type": "text", "required": false, "placeholder": "e.g., Blue, #3B82F6", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "address", "label": "Business Address", "type": "text", "required": false, "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "about_text", "label": "About Your Business", "type": "textarea", "required": false, "help_text": "A brief description we can use on your About page", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "logo_url", "label": "Logo (upload or URL)", "type": "file", "required": false}
  ]'::jsonb,
  updated_at = now()
where slug = 'website-build';

-- ============================================================
-- a2p-registration: drop business_phone / contact_name / contact_email
-- from required (resolver falls back to clients row).
-- legal_business_name stays required to avoid Twilio brand rejection.
-- ============================================================
update public.service_definitions
set
  required_data_fields = '[
    {"key": "legal_business_name", "label": "Legal Business Name", "type": "text", "required": true, "help_text": "Must match IRS records exactly — often differs from your display/trade name"},
    {"key": "ein", "label": "EIN (Tax ID)", "type": "text", "required": true, "placeholder": "XX-XXXXXXX", "help_text": "Your federal Employer Identification Number"},
    {"key": "business_address", "label": "Business Address", "type": "text", "required": true},
    {"key": "business_city", "label": "City", "type": "text", "required": true},
    {"key": "business_state", "label": "State", "type": "text", "required": true},
    {"key": "business_zip", "label": "ZIP Code", "type": "text", "required": true},
    {"key": "business_phone", "label": "Business Phone", "type": "phone", "required": false, "help_text": "Leave blank to use the phone on file"},
    {"key": "contact_name", "label": "Primary Contact Name", "type": "text", "required": false, "help_text": "Leave blank to use the contact name on file"},
    {"key": "contact_email", "label": "Primary Contact Email", "type": "email", "required": false, "help_text": "Leave blank to use the email on file"}
  ]'::jsonb,
  updated_at = now()
where slug = 'a2p-registration';
