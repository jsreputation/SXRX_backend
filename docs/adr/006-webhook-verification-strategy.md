# ADR-006: Webhook Verification Strategy

## Status
Accepted

## Context
The SXRX platform receives webhooks from multiple services:
- **Shopify**: Order creation, payment events (uses HMAC-SHA256 signatures)
- **Stripe**: Payment events (uses HMAC-SHA256 signatures with timestamp)
- **RevenueHunt v2**: Questionnaire completions (no webhook secrets/signatures)

Each service has different verification requirements and security models.

## Decision
We implemented service-specific webhook verification middleware:

### Architecture
1. **Middleware Chain**: `webhookVerification.js` provides verification functions:
   - `verifyShopifyWebhook()`: HMAC-SHA256 signature verification
   - `verifyStripeWebhook()`: HMAC-SHA256 with timestamp verification
   - `verifyRevenueHuntWebhook()`: No verification (v2 doesn't use secrets)

2. **Raw Body Preservation**: 
   - Stripe webhooks require raw body for signature verification
   - Middleware captures raw body before JSON parsing
   - Raw body stored in `req.rawBody` for verification

3. **Service-Specific Routes**:
   - `/webhooks/shopify/*`: Shopify signature verification
   - `/webhooks/stripe`: Stripe signature verification
   - `/webhooks/revenue-hunt`: No verification (bypasses signature checks)

### Verification Methods

#### Shopify
- **Method**: HMAC-SHA256 of request body
- **Header**: `X-Shopify-Hmac-SHA256`
- **Secret**: `SHOPIFY_WEBHOOK_SECRET` from environment
- **Failure**: Returns 401 Unauthorized

#### Stripe
- **Method**: HMAC-SHA256 of timestamp + payload
- **Header**: `stripe-signature` (contains timestamp and signature)
- **Secret**: `STRIPE_WEBHOOK_SECRET` from environment
- **Timestamp Validation**: Prevents replay attacks (rejects requests > 5 minutes old)
- **Failure**: Returns 401 Unauthorized

#### RevenueHunt v2
- **Method**: None (no webhook secrets in v2)
- **Security**: Relies on HTTPS and endpoint obscurity
- **Note**: All requests accepted without signature verification

## Consequences

### Positive
- Service-specific verification matches each provider's security model
- Raw body preservation enables accurate signature verification
- Timestamp validation prevents replay attacks (Stripe)
- Graceful handling of services without signatures (RevenueHunt)

### Negative
- Different verification logic for each service (more code to maintain)
- RevenueHunt v2 has no signature verification (security concern)
- Raw body must be captured before JSON parsing (middleware ordering critical)

### Security Considerations
- **Shopify/Stripe**: Strong security via HMAC signatures
- **RevenueHunt**: Relies on HTTPS and endpoint security (no signature verification)
- **Replay Attacks**: Stripe timestamp validation mitigates this
- **Body Tampering**: HMAC verification detects any body modifications

## Alternatives Considered
1. **Universal signature verification**: Rejected due to RevenueHunt v2 not supporting signatures
2. **IP whitelisting**: Considered but impractical (dynamic IPs, multiple services)
3. **API key authentication**: Not supported by webhook providers

## Implementation Notes
- Middleware must be applied before body parsing for signature verification
- Raw body is stored in `req.rawBody` for verification functions
- Failed verifications return 401 immediately (no processing)
- RevenueHunt webhook route explicitly bypasses verification middleware

## References
- Shopify Webhook Verification: https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook
- Stripe Webhook Verification: https://stripe.com/docs/webhooks/signatures
- RevenueHunt v2 Documentation: No webhook secrets in v2
