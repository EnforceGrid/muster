# Muster

**Structured evidence collection over email — when you need a record of who said what.**

Muster sends structured question emails to organisation members, receives their free-text replies correlated by conversation thread, and stores the raw attributed responses. It does not extract, classify, or analyse anything. That is your application layer's job.

## When to use it

Use Muster whenever you need an attributable paper trail of responses from people inside an organisation:

- Compliance and regulatory audits
- Due diligence exercises
- Internal surveys where attribution matters
- Approval workflows requiring written sign-off
- Any process where "who said what, and when" is load-bearing

## Prerequisites

- Node >= 20.10
- Docker (for the bundled Postgres)
- An OpenAI API key (for LLM-drafted invitation emails)

## Setup

```bash
npm install
npm run build:types      # generates src/schemas/generated.ts from specs/schemas/
cp .env.example .env     # fill in OPENAI_API_KEY at minimum
npm run db:up            # starts postgres on port 5434
npm run muster init      # applies database schema (idempotent)
```

## Configuration

All configuration is via environment variables. See `.env.example` for the full list.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | API key for LLM-drafted invitations |
| `MUSTER_MODEL_ID` | No | `gpt-4o-mini` | Model override |
| `MUSTER_APP_NAME` | No | `Muster` | Product name in prompts and CLI |
| `MUSTER_DOMAIN` | No | `muster.example.com` | Reply-to domain for correlation tokens |
| `DATABASE_URL` | No | `postgres://muster:muster@localhost:5434/muster` | Postgres connection URL |
| `MUSTER_SMTP_HOST` | No | — | SMTP host for production send; omit to use file outbox |
| `MUSTER_IMAP_HOST` | No | — | IMAP host for `poll-replies`; required if using IMAP receive |

## Quick start

```bash
# 1. Create an assessment from an org-config YAML
npm run muster start-assessment -- --org-config fixtures/example-org.yaml
# => assessment_id: <uuid>

# 2. Draft and send invitations (file outbox by default, SMTP if configured)
npm run muster send-invitations -- <assessment_id>
# => sent: k.weber@acme-example.com → invitation_id=<uuid>

# 3a. Receive replies via IMAP (production)
npm run muster poll-replies -- --assessment <assessment_id>

# 3b. Ingest a reply manually (development / testing)
echo "We use Tableau for dashboards and a custom Python scoring model." > /tmp/reply.txt
npm run muster ingest-reply -- --thread <thread_id> --body-file /tmp/reply.txt

# 4. Review the audit trail
npm run muster audit-tail -- --assessment <assessment_id>

# 5. Inspect the full state tree
npm run muster dump-state -- <assessment_id>
```

## Architecture

```
organisation
  └── assessment
        └── stakeholder_profile (one per invited person)
              └── invitation (email out, carries correlation token)
                    └── interview_thread (tracks conversation state)
                          └── interview_exchange (each inbound reply)
                                └── audit_event (immutable record)
```

Every LLM call is wrapped in a policy envelope and recorded in the audit log before the call is made. Every inbound reply is stored verbatim with a SHA-256 hash for provenance.

## Mail adapters

**Outbound (send-invitations):**

- `FileSender` (default): writes `.eml` files to `var/outbox/`. Set no SMTP variables to use this.
- `SmtpSender`: set `MUSTER_SMTP_HOST` and related variables to send via SMTP.

**Inbound (poll-replies):**

- `ImapPoller`: set `MUSTER_IMAP_HOST` and related variables. Fetches unseen messages, extracts the correlation token from the `To` address (`reply+<token>@<domain>`), marks messages seen, and yields `InboundMessage` objects for ingestion.

## What Muster does NOT do

- Extract structured data from replies (no entity extraction, no NLP)
- Classify or score what respondents say
- Analyse gaps, risks, or compliance posture
- Send follow-up questions autonomously

All of that belongs in your application layer, which consumes `interview_exchange` rows from the database.

## Development

```bash
npm run typecheck    # TypeScript type check (zero errors expected)
npm run lint         # ESLint
npm test             # node test runner
npm run db:down      # stop Postgres
```
