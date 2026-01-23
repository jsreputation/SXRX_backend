# ADR-003: Caching Strategy - Redis with Tag-Based Invalidation

## Status
Accepted

## Context
The SXRX platform makes frequent calls to external APIs (Tebra SOAP API, Shopify API) that:
- Have rate limits
- Return data that changes infrequently (patient data, provider lists, practice info)
- Have high latency (SOAP API calls can take 1-3 seconds)
- Need to be invalidated when related data changes (e.g., patient update invalidates chart cache)

## Decision
We implemented Redis caching with tag-based invalidation:

### Architecture
1. **Cache Service**: Centralized `cacheService.js` managing Redis connections
2. **TTL-based Expiration**: Different TTLs for different data types:
   - Availability: 60 seconds (frequently changing)
   - Tebra responses: 300 seconds (5 minutes)
   - Practice/Provider lists: 600 seconds (10 minutes)
3. **Tag-Based Invalidation**: Cache keys include prefixes for pattern-based deletion:
   - `sxrx:availability:*` - All availability caches
   - `sxrx:tebra:getPatient:*` - All patient data caches
   - `sxrx:chart:*` - All patient chart caches
4. **Graceful Degradation**: Cache failures don't break the application (returns null, falls back to API calls)

### Key Features
- **Versioned Keys**: Optional version suffix for cache invalidation (`:v2`)
- **Pattern Deletion**: `deletePattern()` method for bulk invalidation
- **Automatic Reconnection**: Redis client handles reconnection with exponential backoff
- **Disabled Mode**: Can disable caching via `REDIS_ENABLED=false` for development

## Consequences

### Positive
- Significant reduction in API calls (especially to Tebra SOAP API)
- Faster response times for cached data
- Reduced rate limit issues
- Tag-based invalidation ensures data consistency
- Graceful degradation maintains availability

### Negative
- Additional infrastructure dependency (Redis server)
- Cache invalidation complexity (must remember to invalidate on updates)
- Potential for stale data if invalidation is missed
- Memory usage for cached data

### Implementation Notes
- Cache keys use consistent prefix (`sxrx:`) for easy management
- TTLs are configurable via environment variables
- Cache service logs hits/misses for monitoring
- Pattern deletion uses Redis `KEYS` command (acceptable for our scale)

## Alternatives Considered
1. **In-memory caching (Node.js)**: Rejected due to lack of persistence and multi-server support
2. **Database caching**: Rejected due to performance (PostgreSQL not optimized for cache workloads)
3. **CDN caching**: Not applicable for API responses with user-specific data

## References
- Redis Documentation: https://redis.io/docs/
- Cache invalidation patterns: https://redis.io/docs/manual/patterns/cache-invalidation/
