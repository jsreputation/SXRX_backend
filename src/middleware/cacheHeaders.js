// backend/src/middleware/cacheHeaders.js
// Middleware to add Cache-Control, ETag, and Last-Modified headers to responses

const crypto = require('crypto');

/**
 * Generate ETag from response data
 * @param {*} data - Response data
 * @returns {string} ETag value
 */
function generateETag(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `"${hash}"`;
}

/**
 * Middleware to add cache headers to responses
 * @param {Object} options - Cache header options
 * @param {number} options.maxAge - Max age in seconds (default: 300)
 * @param {boolean} options.private - Whether response is private (default: false)
 * @param {boolean} options.mustRevalidate - Whether must revalidate (default: false)
 * @param {boolean} options.etag - Whether to generate ETag (default: true)
 * @returns {Function} Express middleware
 */
function cacheHeaders(options = {}) {
  const {
    maxAge = 300, // 5 minutes default
    private: isPrivate = false,
    mustRevalidate = false,
    etag = true
  } = options;

  return (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json to add cache headers
    res.json = function(data) {
      // Build Cache-Control header
      const cacheControl = [
        isPrivate ? 'private' : 'public',
        `max-age=${maxAge}`,
        mustRevalidate ? 'must-revalidate' : null
      ].filter(Boolean).join(', ');
      
      res.setHeader('Cache-Control', cacheControl);
      
      // Add Last-Modified header (current time)
      res.setHeader('Last-Modified', new Date().toUTCString());
      
      // Generate and add ETag if enabled
      if (etag) {
        const etagValue = generateETag(data);
        res.setHeader('ETag', etagValue);
        
        // Check If-None-Match header for conditional requests
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch === etagValue) {
          return res.status(304).end(); // Not Modified
        }
      }
      
      // Check If-Modified-Since header
      const ifModifiedSince = req.headers['if-modified-since'];
      if (ifModifiedSince) {
        const lastModified = new Date(res.getHeader('Last-Modified'));
        const modifiedSince = new Date(ifModifiedSince);
        if (lastModified <= modifiedSince) {
          return res.status(304).end(); // Not Modified
        }
      }
      
      return originalJson(data);
    };
    
    next();
  };
}

/**
 * Middleware factory for different cache strategies
 */
const cacheStrategies = {
  // No caching
  noCache: () => cacheHeaders({ maxAge: 0, private: true, mustRevalidate: true }),
  
  // Short-term cache (1 minute)
  short: () => cacheHeaders({ maxAge: 60 }),
  
  // Medium-term cache (5 minutes)
  medium: () => cacheHeaders({ maxAge: 300 }),
  
  // Long-term cache (1 hour)
  long: () => cacheHeaders({ maxAge: 3600 }),
  
  // Private cache (user-specific)
  private: (maxAge = 300) => cacheHeaders({ maxAge, private: true }),
  
  // Custom cache
  custom: (options) => cacheHeaders(options)
};

module.exports = { cacheHeaders, cacheStrategies };
