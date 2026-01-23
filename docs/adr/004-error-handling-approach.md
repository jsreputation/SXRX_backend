# ADR-004: Error Handling Approach

## Status
Accepted

## Context
The SXRX platform integrates with multiple external services (Tebra SOAP API, Shopify, Stripe, RevenueHunt) and needs:
- Consistent error responses across all endpoints
- Proper HTTP status codes
- Detailed error information for debugging
- User-friendly error messages
- Error tracking and monitoring (Sentry)

## Decision
We implemented a centralized error handling middleware with structured error codes:

### Architecture
1. **Error Handler Middleware**: `errorHandler.js` catches all errors and formats responses
2. **Error Codes**: Standardized error codes (e.g., `VALIDATION_ERROR`, `DATABASE_ERROR`, `AUTHENTICATION_ERROR`)
3. **Error Classification**: Errors are classified by type:
   - Validation errors (400)
   - Authentication errors (401)
   - Authorization errors (403)
   - Not found errors (404)
   - Conflict errors (409)
   - Database errors (500)
   - External API errors (502)
4. **Sentry Integration**: Errors are automatically sent to Sentry for monitoring
5. **PostgreSQL-Specific Handling**: Handles PostgreSQL error codes (`23505` for unique violations, `23503` for foreign keys)

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required field: email",
    "details": {}
  }
}
```

## Consequences

### Positive
- Consistent error format across all endpoints
- Easier debugging with structured error codes
- Automatic error tracking via Sentry
- Proper HTTP status codes for API consumers
- PostgreSQL-specific error handling improves user experience

### Negative
- All errors must go through middleware (slight performance overhead)
- Need to maintain error code constants
- Error messages may expose internal details (mitigated by environment-based logging)

### Error Categories
- **Client Errors (4xx)**: Validation, authentication, authorization, not found, conflict
- **Server Errors (5xx)**: Database errors, external API errors, internal errors
- **Network Errors**: Connection timeouts, DNS failures

## Alternatives Considered
1. **Per-route error handling**: Rejected due to inconsistency and code duplication
2. **Error classes with inheritance**: Considered but current approach is simpler and sufficient
3. **Error codes in database**: Overkill for our use case

## References
- Express Error Handling: https://expressjs.com/en/guide/error-handling.html
- HTTP Status Codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- Sentry Documentation: https://docs.sentry.io/
