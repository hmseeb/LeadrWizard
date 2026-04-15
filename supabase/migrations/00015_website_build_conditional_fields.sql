-- Migration: 00015_website_build_conditional_fields.sql
-- Purpose: Make the website-build onboarding flow ask about the
--          existing-website URL up front, and conditionally ask for
--          tagline / address / about_text / primary_color when the
--          client has no site for us to scrape. Without this, the
--          widget never asks for any of those fields (they were
--          marked `required: false` and the widget only asks
--          required fields), so clients without an existing site go
--          through onboarding without ever giving us the info we need
--          to build their site from scratch.
--
-- The conditional-required logic is enforced by the new `required_if`
-- field on `DataFieldDefinition`, evaluated by
-- `filterCurrentlyRequiredFields` in `packages/shared/src/utils/required-fields.ts`.
-- Both the widget GET (next-question selection) and POST (auto-completion
-- check + ready_to_deliver promotion) honor it via the same helper, so
-- they can't drift.
--
-- Idempotent: safe to run on databases that already have the new shape.

update public.service_definitions
set
  required_data_fields = '[
    {"key": "business_name", "label": "Business Name", "type": "text", "required": true, "placeholder": "e.g., Acme Plumbing"},
    {"key": "niche", "label": "Business Niche/Industry", "type": "text", "required": true, "placeholder": "e.g., Plumbing, Dentist, Restaurant"},
    {"key": "phone", "label": "Business Phone", "type": "phone", "required": true},
    {"key": "email", "label": "Business Email", "type": "email", "required": true},
    {"key": "services_offered", "label": "Services You Offer", "type": "textarea", "required": true, "placeholder": "List the main services you offer"},
    {"key": "existing_website", "label": "Do you have an existing website? (URL or type ''none'')", "type": "text", "required": true, "placeholder": "https://yourbusiness.com or ''none''", "help_text": "If you already have a site we''ll import your logo, colors, and copy from it. Type ''none'' if you don''t have one."},
    {"key": "tagline", "label": "Business Tagline", "type": "text", "required": false, "placeholder": "e.g., Your trusted local plumber", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "primary_color", "label": "Preferred Brand Color", "type": "text", "required": false, "placeholder": "e.g., Blue, #3B82F6", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "address", "label": "Business Address", "type": "text", "required": false, "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "about_text", "label": "About Your Business", "type": "textarea", "required": false, "help_text": "A brief description we can use on your About page", "required_if": {"field": "existing_website", "equals_empty": true}},
    {"key": "logo_url", "label": "Logo (upload or URL)", "type": "file", "required": false}
  ]'::jsonb,
  updated_at = now()
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
