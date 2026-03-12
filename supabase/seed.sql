-- LeadrWizard Seed Data
-- Demo organization with sample services and packages

-- Demo Organization
insert into public.organizations (id, name, slug, logo_url) values
  ('11111111-1111-1111-1111-111111111111', 'LeadrWizard Demo', 'leadrwizard-demo', null);

-- Service Definitions
insert into public.service_definitions (id, org_id, name, slug, description, required_data_fields, setup_steps) values

  -- Website Build
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'AI Website Build', 'website-build',
   'AI-generated website from niche template library, hosted on Vercel',
   '[
     {"key": "business_name", "label": "Business Name", "type": "text", "required": true, "placeholder": "e.g., Acme Plumbing"},
     {"key": "niche", "label": "Business Niche/Industry", "type": "text", "required": true, "placeholder": "e.g., Plumbing, Dentist, Restaurant"},
     {"key": "tagline", "label": "Business Tagline", "type": "text", "required": false, "placeholder": "e.g., Your trusted local plumber"},
     {"key": "primary_color", "label": "Preferred Brand Color", "type": "text", "required": false, "placeholder": "e.g., Blue, #3B82F6"},
     {"key": "logo_url", "label": "Logo (upload or URL)", "type": "file", "required": false},
     {"key": "phone", "label": "Business Phone", "type": "phone", "required": true},
     {"key": "email", "label": "Business Email", "type": "email", "required": true},
     {"key": "address", "label": "Business Address", "type": "text", "required": false},
     {"key": "services_offered", "label": "Services You Offer", "type": "textarea", "required": true, "placeholder": "List the main services you offer"},
     {"key": "about_text", "label": "About Your Business", "type": "textarea", "required": false, "help_text": "A brief description we can use on your About page"}
   ]'::jsonb,
   '[
     {"key": "select_template", "label": "Select Niche Template", "description": "Find or create a template for this niche", "automated": true, "task_type": "website_generation"},
     {"key": "generate_site", "label": "Generate Website", "description": "AI generates customized website", "automated": true, "task_type": "website_generation"},
     {"key": "deploy_preview", "label": "Deploy Preview", "description": "Deploy to Vercel for client review", "automated": true, "task_type": "website_generation"},
     {"key": "client_approval", "label": "Client Approval", "description": "Client reviews and approves (up to 3 adjustments)", "automated": false}
   ]'::jsonb),

  -- GMB Optimization
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '11111111-1111-1111-1111-111111111111',
   'GMB Optimization', 'gmb-optimization',
   'Google My Business profile setup and optimization via API',
   '[
     {"key": "google_email", "label": "Google Account Email", "type": "email", "required": true, "help_text": "The Google account that owns or manages your GMB listing"},
     {"key": "business_name", "label": "Business Name (as on Google)", "type": "text", "required": true},
     {"key": "business_address", "label": "Business Address", "type": "text", "required": true},
     {"key": "business_phone", "label": "Business Phone", "type": "phone", "required": true},
     {"key": "business_category", "label": "Primary Business Category", "type": "text", "required": true, "placeholder": "e.g., Plumber, Dentist, Restaurant"},
     {"key": "business_hours_mon", "label": "Monday Hours", "type": "text", "required": false, "placeholder": "e.g., 9:00 AM - 5:00 PM or Closed"},
     {"key": "business_hours_tue", "label": "Tuesday Hours", "type": "text", "required": false},
     {"key": "business_hours_wed", "label": "Wednesday Hours", "type": "text", "required": false},
     {"key": "business_hours_thu", "label": "Thursday Hours", "type": "text", "required": false},
     {"key": "business_hours_fri", "label": "Friday Hours", "type": "text", "required": false},
     {"key": "business_hours_sat", "label": "Saturday Hours", "type": "text", "required": false},
     {"key": "business_hours_sun", "label": "Sunday Hours", "type": "text", "required": false},
     {"key": "business_description", "label": "Business Description", "type": "textarea", "required": false, "help_text": "250 chars max for GMB"}
   ]'::jsonb,
   '[
     {"key": "request_access", "label": "Request GMB Access", "description": "Request management access via Google API", "automated": true, "task_type": "gmb_access_request"},
     {"key": "optimize_profile", "label": "Optimize Profile", "description": "Update business info, categories, hours", "automated": true, "task_type": "gmb_access_request"}
   ]'::jsonb),

  -- A2P Registration
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'A2P 10DLC Registration', 'a2p-registration',
   'Business texting registration via Twilio for compliant SMS',
   '[
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
   '[
     {"key": "create_brand", "label": "Register Brand", "description": "Create brand profile with TCR via Twilio", "automated": true, "task_type": "a2p_registration"},
     {"key": "create_campaign", "label": "Register Campaign", "description": "Register messaging campaign", "automated": true, "task_type": "a2p_registration"},
     {"key": "assign_number", "label": "Assign Phone Number", "description": "Assign Twilio number to messaging service", "automated": true, "task_type": "a2p_registration"}
   ]'::jsonb),

  -- GHL Automations (from snapshot)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111',
   'GHL Automations Setup', 'ghl-automations',
   'Chatbot, missed call text back, text follow up, Google review management — deployed from GHL snapshot',
   '[
     {"key": "business_name", "label": "Business Name", "type": "text", "required": true},
     {"key": "business_phone", "label": "Business Phone", "type": "phone", "required": true},
     {"key": "business_email", "label": "Business Email", "type": "email", "required": true},
     {"key": "business_hours", "label": "Business Hours Summary", "type": "text", "required": false, "placeholder": "e.g., Mon-Fri 9-5, Sat 10-2"},
     {"key": "review_link", "label": "Google Review Link", "type": "url", "required": false, "help_text": "Your Google Maps review link"}
   ]'::jsonb,
   '[
     {"key": "provision_account", "label": "Create GHL Sub-Account", "description": "Provision new GHL location for client", "automated": true, "task_type": "ghl_sub_account_provision"},
     {"key": "deploy_snapshot", "label": "Deploy Snapshot", "description": "Deploy automation snapshot to sub-account", "automated": true, "task_type": "ghl_snapshot_deploy"},
     {"key": "customize", "label": "Customize Automations", "description": "Update snapshot with client-specific data", "automated": true, "task_type": "ghl_snapshot_deploy"}
   ]'::jsonb);

-- Starter Package (all 4 services)
insert into public.service_packages (id, org_id, name, description, price_cents) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111',
   'Starter Package',
   'Website + GMB + A2P + GHL Automations — everything to get your business online and running',
   49900);

insert into public.package_services (package_id, service_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- Sample niche templates
insert into public.niche_templates (org_id, niche_name, description, template_data) values
  ('11111111-1111-1111-1111-111111111111', 'Plumbing', 'Professional plumbing service website', '{"layout": "service-business", "sections": ["hero", "services", "about", "reviews", "contact"], "color_scheme": "blue"}'),
  ('11111111-1111-1111-1111-111111111111', 'Dental', 'Modern dental practice website', '{"layout": "healthcare", "sections": ["hero", "services", "team", "reviews", "booking", "contact"], "color_scheme": "teal"}'),
  ('11111111-1111-1111-1111-111111111111', 'Restaurant', 'Restaurant with menu and reservation', '{"layout": "food-service", "sections": ["hero", "menu", "about", "reviews", "reservation", "contact"], "color_scheme": "warm"}');
