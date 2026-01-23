# ADR-001: Database Choice - PostgreSQL over MongoDB

## Status
Accepted

## Context
The SXRX platform requires a robust, relational database to handle:
- User authentication and session management (refresh tokens, 2FA secrets)
- Customer-to-patient mappings
- Questionnaire completion tracking
- Subscription and billing records
- Email verification tokens
- Webhook retry queue
- Complex queries with joins and transactions

Initially, the codebase had references to MongoDB, but the actual implementation uses PostgreSQL.

## Decision
We chose PostgreSQL as the primary database for the following reasons:

1. **Relational Data Model**: The application has clear relationships (customers → patients, patients → appointments, orders → billing records) that benefit from foreign keys and referential integrity.

2. **ACID Compliance**: Critical for financial transactions (billing, payments) and data consistency (customer-patient mappings).

3. **SQL Standard**: Well-understood query language, easier to debug and optimize.

4. **Mature Ecosystem**: Excellent tooling, monitoring, and backup solutions.

5. **Performance**: Better performance for complex queries with joins compared to NoSQL for our use case.

6. **Transaction Support**: Essential for operations like creating a patient and mapping in a single transaction.

7. **JSON Support**: PostgreSQL's JSONB type provides NoSQL-like flexibility when needed (e.g., questionnaire answers, webhook payloads).

## Consequences

### Positive
- Strong data integrity through foreign keys and constraints
- Excellent performance for relational queries
- Mature tooling and ecosystem
- Easy to hire developers familiar with SQL
- Better suited for financial/healthcare data with strict requirements

### Negative
- Requires schema migrations for schema changes (vs. schema-less MongoDB)
- More complex setup than MongoDB for simple use cases
- Need to manage connection pooling and query optimization

### Migration Notes
- All MongoDB models have been deprecated (see `DEPRECATED.md`)
- Error handling updated to use PostgreSQL-specific error codes (`23505` for unique violations, `23503` for foreign key violations)
- All new code uses PostgreSQL via `pg` library

## References
- PostgreSQL Documentation: https://www.postgresql.org/docs/
- Migration guide: `backend/DEPRECATED.md`
