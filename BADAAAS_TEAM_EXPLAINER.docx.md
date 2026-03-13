# LeadrWizard: The Badaaas Onboarding Engine

## How We Turn New Clients Into Delivered Results — Automatically

---

## What You'll Learn in This Document

This document explains what LeadrWizard is, why we built it, what it does for Badaaas and our clients, and what each team member needs to know to work with it. Whether you're technical or not, you'll walk away understanding exactly how the system works and why it matters.

---

# Part 1: The Big Picture

## What Problem Does LeadrWizard Solve?

Here's the reality of running a service agency: **the hardest part isn't selling — it's delivering.**

Every time Badaaas closes a new client, we need information from them before we can do anything:

- Business name, logo, colors, and tagline for their website
- Google account credentials and business details for GMB
- Legal business name, EIN, and address for A2P text registration
- Business hours, review links, and contact info for GHL automations

**Before LeadrWizard**, collecting this information was a nightmare:

- Someone on the team had to manually email or call the client
- Clients would respond slowly — or not at all
- Follow-ups fell through the cracks
- It could take **days or weeks** just to get the basics
- Meanwhile, the client is sitting there wondering why nothing's happening
- The team is buried in admin work instead of delivering value
- Some clients would ghost entirely, leaving services undelivered and money on the table

**This is the problem LeadrWizard eliminates.**

---

## What Is LeadrWizard?

LeadrWizard is an **AI-powered onboarding engine** that automatically collects everything we need from a new client — across SMS, phone calls, email, and a web widget — so our team can focus on delivering services instead of chasing information.

**The moment a client pays, LeadrWizard takes over.** Within seconds, the client receives their first message. The AI handles the conversation, follows up persistently, and doesn't stop until it has everything we need. No human effort required for 90%+ of onboardings.

---

## Why This Makes Badaaas Bad Ass From Minute One

Think about what the client experiences:

**Without LeadrWizard:**
- Client pays → silence for hours or days → eventually gets an email asking for info → responds partially → more back-and-forth → services finally start delivering weeks later

**With LeadrWizard:**
- Client pays → **gets a text within seconds** → answers a few questions → gets a phone call from an AI assistant if needed → their website is being built, their GMB is being optimized, their texting is being registered, and their CRM is being set up — all before they even think to wonder "when does this start?"

**That first impression is everything.** The client feels like they hired a team that has their act together. They feel taken care of. They feel like they made the right decision. And they did — because while competitors are still sending "Hey, can you fill out this form?" emails three days later, Badaaas already has the client's website in preview.

This is how you get referrals. This is how you reduce churn. This is how you scale without hiring an army.

---

# Part 2: What LeadrWizard Actually Does

## The Full Journey: Payment to Delivery

Here's what happens step by step when a new client buys a Badaaas package:

### Step 1: Client Pays (Time: 0 minutes)

Whether the client buys through a sales call or self-serve checkout (via Stripe), the payment event triggers LeadrWizard instantly.

**What the system does automatically:**
- Creates the client record in our database
- Sets up their GoHighLevel CRM sub-account
- Deploys our automation snapshot to their CRM (chatbot, missed call text back, review management — all pre-configured)
- Creates their onboarding session
- Queues the first SMS

**Why this matters:** Before anyone on our team lifts a finger, the client already has a CRM account with working automations. That's value delivered in seconds.

### Step 2: First Contact (Time: ~2 minutes)

The client receives a personalized SMS:

> "Hey [Name]! This is Badaaas. We're fired up to get your [Package Name] rolling! Let's grab a few details so we can start building. Tap here to get started: [link] — or just reply CALL and we'll ring you!"

**Why SMS first:** 98% open rate. Email sits unread. SMS gets attention.

### Step 3: The AI Conversation

Now the client has three ways to provide their information:

#### Option A: The Web Widget (Visual Mode)
Client clicks the link → opens a branded onboarding wizard → answers one question at a time with a progress bar showing how close they are to done.

The widget is:
- Simple and mobile-friendly
- Shows progress per service ("Website Build: 70% complete")
- Remembers where they left off if they close and come back

#### Option B: The Web Widget (Voice Mode)
Same link, but the client clicks "Switch to Voice" → talks to an AI assistant powered by ElevenLabs that asks questions conversationally and records the answers automatically.

**Why voice matters:** Some people hate filling out forms. Talking is faster and more natural, especially for business owners on the go.

#### Option C: AI Phone Call (Vapi)
If the client texts back "CALL" — or doesn't respond and it's time for a follow-up call — LeadrWizard places an AI-powered phone call.

The AI assistant:
- Introduces itself and explains what info is needed
- Asks questions one at a time in natural conversation
- Records answers in real-time
- Can schedule a callback if the client is busy
- Escalates to a human if the client asks for one

**Why this matters:** We're meeting the client wherever they're comfortable. Form person? Widget. Phone person? AI call. Text person? SMS. No friction.

### Step 4: Smart Follow-Up (If No Response)

If the client doesn't respond, LeadrWizard doesn't give up. It follows a proven escalation cadence:

| Time After Payment | What Happens |
|-------------------|-------------|
| **1 hour** | SMS reminder: "Quick reminder — we just need a few details to get started!" |
| **4 hours** | Another SMS with urgency: "We're ready to build — just waiting on you!" |
| **24 hours** | AI phone call: conversational, friendly, persistent |
| **48 hours** | Email + SMS combo |
| **72 hours** | Second AI phone call |
| **5 days** | Urgent SMS: "We really want to get this done for you" |
| **7 days** | Final AI phone call → if no answer, escalate to human |

**Why 8 steps:** Data shows that most clients respond within the first 3 touches. But some need more. By step 7, we've tried SMS, voice, and email across a full week. The ones who still haven't responded need human intervention — and that's when the Client Support Lead gets notified.

**Important:** The moment a client responds to ANY message, all pending follow-ups are cancelled. We're persistent, not annoying.

### Step 5: Service Delivery (Automatic)

As the AI collects data, services start executing automatically:

#### AI Website Build
1. AI matches the client's business niche to a template (plumbing, dental, restaurant, etc.)
2. Claude AI customizes the HTML with the client's brand, colors, content, and contact info
3. The site is deployed to Vercel with a preview link
4. Client gets a text: "Your website preview is ready! Check it out: [link]"
5. Client can request up to 3 rounds of changes (via text or widget)
6. Once approved, the site goes live on their custom subdomain

#### Google Business Profile Optimization
1. System searches Google for the client's existing business listing
2. Requests management access (client gets an email from Google to approve)
3. Once approved, the system automatically optimizes: business hours, categories, phone number, description
4. If the client hasn't approved access after 24 hours, they get a reminder SMS

#### A2P 10DLC Registration (Text Message Compliance)
1. System submits the client's business info to Twilio's Trust Hub
2. Creates a brand registration (takes 1-7 business days for approval)
3. Once the brand is approved, creates a messaging campaign
4. Campaign approval takes 1-3 additional days
5. The system polls for status every 15 minutes and updates automatically
6. **Why this matters:** Without A2P registration, business text messages get filtered and blocked by carriers. This is legally required and most agencies skip it or do it manually.

#### GoHighLevel Automations
1. Sub-account is created at payment (Step 1)
2. Automation snapshot is deployed (chatbot, missed call text back, review management, text follow-ups)
3. All collected client data is synced to their CRM contact record
4. Client's GHL account is ready to use from day one

### Step 6: Completion

When all four services are delivered:
- Client gets a completion text: "Everything's set up and ready to go!"
- The onboarding session is marked complete in the dashboard
- The Client Support Lead can verify everything looks good
- Analytics are updated

---

# Part 3: The Dashboard

## What the Client Support Lead Sees

The admin dashboard at `app.leadrwizard.com` is the command center for all onboarding activity.

### Dashboard Home
The main screen shows at a glance:

**Key Metrics (Top Cards):**
- **Active Onboardings** — how many clients are currently being onboarded
- **Completed** — how many finished today/this period
- **Total Clients** — overall client count
- **Open Escalations** — how many need human attention (this is your priority number)

**Secondary Metrics:**
- Average completion percentage across active sessions
- Pending outreach items (how many messages are queued)
- Services delivered count
- Daily interaction volume

**Today's Outreach:**
- How many SMS, voice calls, and emails were sent today
- Gives a sense of system activity

**Pending Tasks:**
- Grouped by type: A2P registrations waiting, GMB access requests pending, websites awaiting approval, etc.
- These are things that are in progress but waiting on external systems or client action

**Recent Escalations:**
- The last 5 escalations that need attention
- Quick view of client name, reason, and status

**14-Day Trends:**
- Historical data table showing completions, interactions, deliveries, and escalations per day

### Onboardings Page
Shows every active onboarding session in a table:
- Client name and business
- Status badge (Active, Paused, Completed, Abandoned)
- Progress bar (e.g., 65% complete)
- Current channel (last way the client interacted — SMS, widget, voice)
- Last activity timestamp

**How to use this:** Sort by "Last Activity" to find clients who haven't interacted recently. The system handles follow-ups automatically, but this gives you visibility.

### Clients Page
Full directory of all clients with:
- Contact info
- Service progress (e.g., "3 of 4 services delivered")
- Onboarding completion percentage

Click into any client for their detail page.

### Client Detail Page
Everything about one client:
- **Profile:** Name, email, phone, business name, GHL account status
- **Services:** Card for each service showing status (pending, in progress, delivered, opted out)
- **Interaction History:** Complete timeline of every SMS, call, email, widget session, and system event — with timestamps
- **Escalations:** Any times the system flagged this client for human help

### Escalations Page
The most important page for the Client Support Lead. Shows all escalations with:
- **Color coding:** Red = open, Yellow = assigned, Green = resolved
- Reason for escalation
- Client name and business
- Channel where it happened
- Who it's assigned to
- When it was created

**When does an escalation happen?**
- Client texts "HELP"
- Client asks to speak to a human during a voice call
- Client is unresponsive after the full 7-day cadence
- A service task fails (A2P registration rejected, GMB access denied, etc.)
- Any situation the AI determines it can't handle

### Other Pages
- **Services** — View the four service definitions and their required data fields
- **Packages** — View service bundles and pricing
- **Templates** — Browse website niche templates (plumbing, dental, restaurant, etc.)
- **Settings** — Integration configuration and outreach cadence settings

---

# Part 4: The AI — What It Does and Doesn't Do

## What the AI Handles (No Human Needed)

| Task | How |
|------|-----|
| First contact after payment | Automated SMS within minutes |
| Collecting client data | Widget, SMS, or AI phone call — whichever the client prefers |
| Follow-up reminders | 8-step escalation cadence across SMS, voice, and email |
| Website generation | Claude AI customizes HTML templates with client data |
| Website revisions | Client texts feedback, Claude regenerates (up to 3 rounds) |
| A2P registration | Full Twilio Trust Hub submission and status polling |
| GMB access + optimization | Google API integration for listing management |
| GHL setup | Sub-account creation, snapshot deployment, data sync |
| Progress tracking | Real-time completion percentages and status updates |
| Interaction logging | Every message, call, and event is recorded |

## What the AI Does NOT Handle (Human Required)

| Situation | What Happens | What the CSL Does |
|-----------|-------------|-------------------|
| Client unresponsive after 7 days | Escalation created, Slack/Chat notification sent | Personally reach out, determine if client needs help or has changed their mind |
| A2P registration rejected | Task marked failed, escalation created | Review rejection reason, correct business info, resubmit manually or through the system |
| GMB access not approved after multiple reminders | Escalation created | Walk client through the Google approval email, possibly do a screen share |
| Client asks for a human | Escalation created immediately | Take over the conversation, resolve the issue, mark escalation resolved |
| Website can't be auto-generated (no matching template) | Escalation created | Assign to design team for manual template creation |
| Unusual or complex client questions | Escalation created | Answer the question, resume the automated flow |
| Quality review of completed onboardings | Not automated | Review delivered services, verify website looks good, confirm GHL is configured correctly |

---

# Part 5: The Client Support Lead's Daily Workflow

## Morning Routine (10 minutes)

1. **Open the Dashboard** — check the four KPI cards at the top
2. **Check Open Escalations** — this is your #1 priority. How many need attention?
3. **Review Pending Tasks** — any A2P registrations stuck? GMB access requests lingering?
4. **Scan Active Onboardings** — anyone been stuck at the same completion % for days?

## Throughout the Day

- **Escalation notifications arrive in Slack/Google Chat** — these are rich notifications with full context: client info, what happened, recent conversation history, and a link to the dashboard
- **Resolve escalations as they come in** — assign to yourself, handle it, mark resolved
- **Spot-check completed onboardings** — click into recently completed clients and verify:
  - Website looks professional and has correct info
  - GHL automations are working
  - All services show "delivered" status

## Weekly Review

- **14-Day Trends table** — are completions trending up? Are escalations trending down?
- **Abandoned sessions** — any clients who dropped off? Worth a personal outreach?
- **Average completion %** — if this is low, clients might be getting stuck on specific questions

---

# Part 6: How the Pieces Connect (Technical Overview)

This section is for team members who want to understand the technology. Skip it if you're not technical.

## System Architecture

```
Client Pays (Stripe)
       │
       ▼
┌──────────────────┐
│  Payment Webhook  │ ── Creates client, session, GHL account
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Outreach Engine  │ ── Sends SMS, emails, AI calls on schedule
└────────┬─────────┘
         │
    ┌────┼────┬──────────┐
    ▼    ▼    ▼          ▼
  SMS  Voice  Email    Widget
(Twilio)(Vapi)(GHL)  (Browser)
    │    │    │          │
    └────┼────┴──────────┘
         │
         ▼
┌──────────────────┐
│   AI Agent Brain  │ ── Decides what to ask next, routes responses
│   (Claude AI)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Service Execution │ ── Website, A2P, GMB, GHL tasks
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    Dashboard      │ ── Monitoring, escalations, analytics
└──────────────────┘
```

## External Services We Use

| Service | What It Does for Us | Cost Model |
|---------|-------------------|-----------|
| **Supabase** | Database, authentication, cron job scheduling | Free tier available, scales with usage |
| **Twilio** | SMS messaging + A2P 10DLC registration | Per-message pricing (~$0.0079/SMS) |
| **Vapi** | AI-powered outbound phone calls | Per-minute pricing |
| **ElevenLabs** | In-browser voice AI for the widget | Per-minute pricing |
| **Anthropic (Claude)** | AI brain — generates websites, powers conversations | Per-token pricing |
| **GoHighLevel** | CRM — sub-accounts, automations, email | Part of existing GHL subscription |
| **Google Business Profile API** | GMB listing management | Free (Google API) |
| **Vercel** | Website hosting and deployment | Free tier for static sites |
| **Stripe** | Payment processing and checkout | Standard Stripe fees (2.9% + $0.30) |
| **Slack / Google Chat** | Escalation notifications for the team | Free (webhook-based) |

## Data We Collect Per Service

### Website Build (10 fields)
Business name, niche/industry, tagline, primary brand color, logo URL, phone, email, physical address, services offered, about text

### GMB Optimization (13 fields)
Google account email, business name, address, phone, category, hours for each day of the week, business description

### A2P Registration (9 fields)
Legal business name, EIN, business address, city, state, ZIP, business phone, contact name, contact email

### GHL Automations (5 fields)
Business name, business phone, business email, business hours, review link

**Total: 37 data points collected automatically across all four services.**

---

# Part 7: Key Numbers to Know

| Metric | What It Means |
|--------|-------------|
| **Completion %** | How much of the required data has been collected for a client (0-100%) |
| **Active Sessions** | Clients currently in the onboarding process |
| **Escalation Rate** | % of onboardings that need human intervention (lower = better) |
| **Avg Time to Complete** | How long from payment to all services delivered |
| **Channel Mix** | Which channels clients prefer (SMS vs. widget vs. voice) |
| **Services Delivered** | Total count of individual services completed |

---

# Part 8: Frequently Asked Questions

**Q: What if the client's phone number is wrong?**
A: SMS will fail, triggering an email follow-up instead. If email also bounces, an escalation is created for the CSL.

**Q: Can a client opt out of a specific service?**
A: Yes. Services can be marked as "opted out" and the system will skip those questions and not execute those tasks.

**Q: What if a client responds at 2 AM?**
A: The system processes responses 24/7. Widget submissions are instant. SMS replies are processed immediately. The AI doesn't sleep.

**Q: What happens if Twilio or Vapi goes down?**
A: Failed sends are retried automatically (up to 3 attempts with backoff). If they still fail, an escalation is created. The system never silently drops a message.

**Q: Can we customize the messages?**
A: Yes. All SMS templates, email templates, and outreach timing are configurable per organization. Currently set via the database; a UI editor is planned.

**Q: Can we add new services beyond the current four?**
A: Yes. The system is built to be service-agnostic. New services are defined with their required data fields and setup steps. The AI automatically incorporates them into the onboarding flow.

**Q: What data is stored and where?**
A: Everything is stored in Supabase (PostgreSQL database) with row-level security. Every interaction is logged. Data is isolated per organization.

**Q: How do clients access the widget?**
A: Via a link sent in the initial SMS. The widget is embedded on a page and identified by the client's unique session ID. No login required — the link IS their access.

---

# Summary

**LeadrWizard makes Badaaas bad ass because:**

1. **Speed** — Clients hear from us within minutes of paying, not days
2. **Persistence** — The AI follows up across 8 touchpoints over 7 days, so no client falls through the cracks
3. **Flexibility** — Clients choose how they want to interact: text, call, form, or voice chat
4. **Automation** — 37 data points collected and 4 services delivered without manual effort
5. **Professionalism** — Clients experience a polished, branded onboarding that builds confidence from the first touch
6. **Scalability** — Whether we have 5 clients or 500, the system handles them all the same way
7. **Visibility** — The dashboard gives the Client Support Lead full control and oversight without drowning in operational details
8. **Intelligence** — The AI knows when to push, when to wait, and when to call for help

**The bottom line:** LeadrWizard lets a small team deliver at the speed and scale of a much larger one. Clients get faster results. The team spends less time chasing and more time delivering. And Badaaas looks like the most organized, responsive agency in the game — because it is.

---

*This document covers LeadrWizard as of March 2026. The system is actively being developed with additional features including Stripe checkout integration, admin CRUD interfaces, real-time dashboard updates, and expanded analytics.*
