# Deprecated Code Documentation

This document lists all deprecated code in the SXRX backend that should not be used in new development but is kept for backward compatibility or reference purposes.

## Last Updated
January 2026

## Deprecated Components

### MongoDB Models (`src/models/`)

**Status:** Deprecated - MongoDB has been removed from this project

**Files:**
- `src/models/User.js`
- `src/models/Appointment.js`
- `src/models/Availability.js`
- `src/models/Consultation.js`
- `src/models/Doctor.js`
- `src/models/Questionnaire.js`

**Reason for Deprecation:**
The project migrated from MongoDB to PostgreSQL for better relational data management, ACID compliance, and integration with existing healthcare systems.

**Replacement:**
- All data is now stored in PostgreSQL tables
- Database schema is managed through migrations in `src/db/migrations/`
- Models are replaced by direct PostgreSQL queries using the `pg` library

**Migration Notes:**
- These files are kept only for reference
- They export empty objects and should not be imported
- Any code importing these models should be updated to use PostgreSQL queries directly

**Removal Plan:**
These files can be safely removed after ensuring no code references them. To check for references:
```bash
grep -r "require.*models/" backend/src
grep -r "from.*models/" backend/src
```

### Legacy Error Handling

**Status:** Updated - MongoDB error handling removed

**File:** `src/utils/errorHandler.js`

**Changes:**
- Removed `MongoError` error handling (line 157)
- Updated to handle PostgreSQL-specific error codes:
  - `PGSQL_*` codes for general database errors
  - `23505` for unique constraint violations
  - `23503` for foreign key constraint violations
  - Connection errors (`ECONNREFUSED`, `ETIMEDOUT`)

**Reason:**
The application now exclusively uses PostgreSQL, so MongoDB-specific error handling is no longer needed.

## Guidelines for Working with Deprecated Code

1. **Do Not Use:** Never import or use deprecated models in new code
2. **Do Not Modify:** Do not update deprecated code unless removing it entirely
3. **Document Dependencies:** If you find code that depends on deprecated components, document it and plan for migration
4. **Test Removal:** Before removing deprecated code, ensure:
   - No imports or references exist
   - All tests pass
   - No runtime dependencies

## Removal Checklist

Before removing deprecated code:

- [ ] Search codebase for all references
- [ ] Update any code that references deprecated components
- [ ] Run full test suite
- [ ] Verify no runtime errors
- [ ] Update this document
- [ ] Remove deprecated files
- [ ] Update README if needed

## Questions?

If you're unsure whether code is deprecated or need help migrating from deprecated components, please:
1. Check this document
2. Review the project's migration history
3. Consult with the development team
