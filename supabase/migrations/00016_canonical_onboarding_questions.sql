-- Migration: 00016_canonical_onboarding_questions.sql
-- Purpose: Force the `a2p-registration` and `website-build`
--          service_definitions rows to the canonical question shape
--          required by their downstream auto-trigger resolvers, across
--          ALL orgs (matched by slug, not by seed UUID).
--
-- Why this exists:
--
-- The widget response route's auto-triggers
-- (`triggerDefaultWebsiteBuild`, `triggerA2PSubmission`) run the moment
-- a service crosses `pending_onboarding -> ready_to_deliver`. Both
-- helpers throw if a single required field is missing from the
-- collected `session_responses` for that client_service. If the
-- corresponding `service_definitions.required_data_fields` list does
-- not ASK for those fields with `required: true`, the widget never
-- prompts the client for them, the service still gets promoted to
-- `ready_to_deliver` once the (incomplete) required set is satisfied,
-- the auto-trigger fires, the resolver throws, and the build/A2P
-- submission silently no-ops. Greg ends up with services stuck at
-- `ready_to_deliver` and no automation behind them.
--
-- For website-build, the resolver requires:
--   business_name, niche, phone, email, services_offered
-- For a2p-registration, the resolver requires:
--   legal_business_name, ein, business_address, business_city,
--   business_state, business_zip, business_phone, contact_name,
--   contact_email
--
-- This migration force-aligns BOTH service_definitions to those
-- required sets so every org (not just the demo seed org) is in a
-- known-good state. It mirrors the lesson from 00015: never match by
-- seed UUID — real production orgs have their own UUIDs. Match by
-- `slug` so any org's row gets canonicalized.
--
-- The website-build update is also re-applied here for safety (it
-- duplicates 00015's UPDATE). 00015 + 00016 are both idempotent — the
-- final state is the same regardless of run order.
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- a2p-registration — 9 required fields matching `resolveA2PInput`
-- ============================================================
update public.service_definitions
set
  required_data_fields = '[
    {"key": "legal_business_name", "label": "Legal Business Name", "type": "text", "required": true, "help_text": "Must match IRS records exactly"},
    {"key": "ein", "label": "EIN (Tax ID)", "type": "text", "required": true, "placeholder": "XX-XXXXXXX", "help_text": "Your federal Employer Identification Number"},
    {"key": "business_address", "label": "Business Address", "type": "text", "required": true},
    {"key": "business_city", "label": "City", "type": "text", "required": true},
    {"key": "business_state", "label": "State", "type": "text", "required": true},
    {"key": "business_zip", "label": "ZIP Code", "type": "text", "required": true},
    {"key": "business_phone", "label": "Business Phone", "type": "phone", "required": true},
    {"key": "contact_name", "label": "Primary Contact Name", "type": "text", "required": true},
    {"key": "contact_email", "label": "Primary Contact Email", "type": "email", "required": true}
  ]'::jsonb,
  updated_at = now()
where slug = 'a2p-registration';

-- ============================================================
-- website-build — 5 required + existing_website gate + 4 conditional
-- (same shape as 00015, re-applied here so any org's row that didn't
-- get touched by 00015 gets the canonical shape now)
-- ============================================================
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
where slug = 'website-build';
