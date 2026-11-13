# Subscription and entitlement architecture

## Current state (2026-11)

- **No payment provider is connected.** `billing_live` is false; every account is on the Free plan.
- The mechanism below is implemented and tested, and is inactive until `TRUSTCODE_BILLING_WEBHOOK_SECRET` is set on
  the server. Choosing a provider (the plans file mentions Paddle or Lemon Squeezy) and writing a translator from
  its webhook format to the events below is the remaining work. No provider-specific code exists.
- What the plans promise is in `backend/app/billing/plans.py`. Free: 300 server verifications per month. Pro and
  Team are marked "planned". The local Security tab is free and unlimited on every plan.
  From extension 1.0.0 Verify and Session also run locally by default and are **not metered**: limits below apply to
  server analysis only (`docs/LOCAL_ENGINE_ARCHITECTURE.md`).

## Who decides

```
billing provider ──signed event──▶ POST /api/v1/billing/webhook ──▶ subscriptions table
                                                                        │
extension / website ──signed-in request──▶ GET /api/v1/me/entitlements ◀┘   (answer: plan, state, limits, usage)
every server feature ──▶ enforce_quota() reads the same decision on the server
```

The extension only displays the answer. A local setting, a cached value or a modified extension cannot unlock a
server feature, because each request is checked against the account on the server. There is no paid feature that
runs locally, so there is nothing to unlock on the client.

## Lifecycle (`backend/app/billing/subscriptions.py`)

| State | Paid features | How it is reached |
|---|---|---|
| free | no | no subscription |
| active | yes | `subscription.activated` / `subscription.renewed`, and now < period end |
| renewal_due | yes, for 3 days | period ended, renewal not yet confirmed |
| payment_failed | yes, for 7 days | `payment.failed` |
| cancelled | yes, until the period already paid for ends | `subscription.cancelled` |
| expired | no | grace ran out, period ended, or `subscription.expired` |
| refunded / disputed | no, immediately | `payment.refunded` / `payment.disputed` |

Billing periods come from the event (`period_start`, `period_end`), never from the calendar month.

## Webhook protections

- Signature: `X-TrustCode-Signature: t=<unix time>,v1=<HMAC-SHA256 of "<t>.<body>">`; timestamps older than
  5 minutes are refused; comparison is constant-time. Without a configured secret the endpoint answers 503.
- Idempotent: each event id is stored once; a repeat returns `duplicate`.
- Ordering: an event older than the last applied one returns `stale` and changes nothing.
- Unknown accounts and unknown plans are recorded and ignored. Every accepted or rejected call is audited.

## Offline behaviour

- The last verified answer is cached in VS Code SecretStorage for 72 hours and shown with its age and an
  "offline" marker. After that the tab says the plan could not be verified.
- A failed verification never stops a local scan: the Security tab does not depend on the server.
- Server features need the server anyway, so an expired subscription cannot be used offline.

## Not built

A payment provider integration, checkout, invoices, team seats, usage periods tied to the billing period (usage
still resets on the first of the month), and a signed entitlement token for third-party verification.
