# ADR-002: Authentication Strategy - JWT with Refresh Tokens

## Status
Accepted

## Context
The SXRX platform needs secure authentication for:
- Shopify storefront customers accessing protected endpoints
- API access from frontend applications
- Stateless authentication (no server-side session storage)
- Token rotation for enhanced security
- Support for 2FA (Two-Factor Authentication)

## Decision
We implemented JWT (JSON Web Tokens) with refresh tokens and token rotation:

### Architecture
1. **Access Tokens**: Short-lived (15 minutes default) JWTs containing user identity
2. **Refresh Tokens**: Long-lived tokens stored in PostgreSQL, used to obtain new access tokens
3. **Token Rotation**: Each refresh generates a new refresh token, invalidating the old one
4. **2FA Support**: TOTP-based 2FA with backup codes, verified after password authentication

### Implementation Details
- **Access Token Claims**: `userId`, `email`, `customerId`, `iat`, `exp`
- **Refresh Token Storage**: PostgreSQL table `refresh_tokens` with:
  - Token hash (SHA-256)
  - User ID
  - Expiration date
  - Created/updated timestamps
- **Token Rotation**: New refresh token issued on each refresh, old token invalidated
- **Revocation**: Tokens can be revoked individually or for all user tokens

## Consequences

### Positive
- Stateless authentication (no server-side session storage)
- Scalable across multiple servers
- Token rotation enhances security
- Refresh tokens stored securely (hashed) in database
- 2FA adds additional security layer

### Negative
- Cannot revoke access tokens before expiration (must wait for expiry)
- Refresh token database lookup on each refresh (minimal performance impact)
- More complex than simple session-based auth

### Security Considerations
- Access tokens are short-lived to limit exposure if compromised
- Refresh tokens are hashed before storage (SHA-256)
- Token rotation prevents token reuse attacks
- 2FA provides defense-in-depth

## Alternatives Considered
1. **Session-based auth**: Rejected due to scalability concerns and need for stateless API
2. **OAuth 2.0**: Considered but overkill for our use case (Shopify customers)
3. **API keys**: Rejected due to lack of user context and rotation complexity

## References
- JWT Specification: https://tools.ietf.org/html/rfc7519
- Token rotation best practices: OWASP Authentication Cheat Sheet
