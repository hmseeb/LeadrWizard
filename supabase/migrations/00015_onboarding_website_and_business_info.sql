-- 00015_onboarding_website_and_business_info.sql
--
-- Add `website_url` and `business_information` onboarding questions to the
-- services that don't already collect them. The widget picks questions up
-- straight from `service_definitions.required_data_fields`, so this is a
-- pure data migration — no schema changes, no code changes.
--
-- Coverage per service:
--   - gmb-optimization   → add both (no website, no business info field)
--   - a2p-registration   → add both (both required by Twilio/TCR to verify
--                          the brand and describe the messaging use case)
--   - ghl-automations    → add both (needed to personalize chatbot / SMS
--                          follow-ups and link the site in replies)
--   - website-build      → skip: `existing_website` (url) and `about_text`
--                          (textarea) already serve these roles, and the
--                          website-build trigger code reads `existing_website`
--                          by name, so renaming would break it.
--
-- This migration is idempotent: it only appends a field when a field with
-- the same `key` is not already present, so re-running it (or running it
-- on a DB that was seeded after the seed.sql update) is a no-op.

-- Helper: append a field to required_data_fields only if its key is not
-- already present. We inline the logic per service so the migration is a
-- plain SQL script (no functions/DO blocks needed).

-- GMB Optimization: add website_url (optional) and business_information (required)
update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'website_url',
    'label', 'Business Website URL',
    'type', 'url',
    'required', false,
    'placeholder', 'https://yourbusiness.com',
    'help_text', 'Your business website — we will link it to your GMB profile'
  )
)
where slug = 'gmb-optimization'
  and not (required_data_fields @> '[{"key": "website_url"}]'::jsonb);

update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'business_information',
    'label', 'Business Information',
    'type', 'textarea',
    'required', true,
    'placeholder', 'Tell us about your business, what you do, and who you serve',
    'help_text', 'A short overview we will use to enrich your GMB profile and description'
  )
)
where slug = 'gmb-optimization'
  and not (required_data_fields @> '[{"key": "business_information"}]'::jsonb);

-- A2P 10DLC Registration: both required (Twilio/TCR needs them)
update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'website_url',
    'label', 'Business Website URL',
    'type', 'url',
    'required', true,
    'placeholder', 'https://yourbusiness.com',
    'help_text', 'Required by Twilio/TCR to verify your business during A2P 10DLC registration'
  )
)
where slug = 'a2p-registration'
  and not (required_data_fields @> '[{"key": "website_url"}]'::jsonb);

update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'business_information',
    'label', 'Business Information',
    'type', 'textarea',
    'required', true,
    'placeholder', 'Describe your business, what products/services you sell, and how customers opt in to SMS',
    'help_text', 'Used in the A2P brand and campaign submission — be specific about messaging use case'
  )
)
where slug = 'a2p-registration'
  and not (required_data_fields @> '[{"key": "business_information"}]'::jsonb);

-- GHL Automations Setup: website optional, business info required
update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'website_url',
    'label', 'Business Website URL',
    'type', 'url',
    'required', false,
    'placeholder', 'https://yourbusiness.com',
    'help_text', 'We will link it in automated SMS/email replies and your chatbot'
  )
)
where slug = 'ghl-automations'
  and not (required_data_fields @> '[{"key": "website_url"}]'::jsonb);

update public.service_definitions
set required_data_fields = required_data_fields || jsonb_build_array(
  jsonb_build_object(
    'key', 'business_information',
    'label', 'Business Information',
    'type', 'textarea',
    'required', true,
    'placeholder', 'Tell us about your business, what you do, and who you serve',
    'help_text', 'Used to personalize chatbot replies, SMS follow-ups, and review requests'
  )
)
where slug = 'ghl-automations'
  and not (required_data_fields @> '[{"key": "business_information"}]'::jsonb);

-- Nudge PostgREST to reload so the admin API picks up the updated
-- definitions immediately without a redeploy.
notify pgrst, 'reload schema';
