// backend/src/utils/pagination.js
// Pagination utility functions

/**
 * Parse pagination parameters from request query
 * @param {Object} req - Express request object
 * @param {Object} options - Pagination options
 * @param {number} options.defaultPage - Default page number (default: 1)
 * @param {number} options.defaultLimit - Default items per page (default: 20)
 * @param {number} options.maxLimit - Maximum items per page (default: 100)
 * @returns {Object} Pagination parameters { page, limit, offset }
 */
function parsePaginationParams(req, options = {}) {
  const {
    defaultPage = 1,
    defaultLimit = 20,
    maxLimit = 100
  } = options;

  const page = Math.max(1, parseInt(req.query.page) || defaultPage);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit) || defaultLimit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Create pagination metadata
 * @param {Object} params
 * @param {number} params.page - Current page number
 * @param {number} params.limit - Items per page
 * @param {number} params.total - Total number of items
 * @returns {Object} Pagination metadata
 */
function createPaginationMeta({ page, limit, total }) {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    nextPage: hasNextPage ? page + 1 : null,
    previousPage: hasPreviousPage ? page - 1 : null
  };
}

/**
 * Create paginated response
 * @param {Array} data - Array of items for current page
 * @param {Object} pagination - Pagination metadata
 * @param {Object} additional - Additional response fields
 * @returns {Object} Paginated response object
 */
function createPaginatedResponse(data, pagination, additional = {}) {
  return {
    success: true,
    data,
    pagination,
    ...additional
  };
}

/**
 * Apply pagination to database query
 * @param {Function} queryFn - Function that returns a database query promise
 * @param {Object} pagination - Pagination parameters { page, limit, offset }
 * @returns {Promise<Object>} Paginated result { data, pagination }
 */
async function paginateQuery(queryFn, pagination) {
  const { limit, offset } = pagination;

  // Get total count (modify query to count)
  const countQuery = queryFn(true); // Pass true to indicate count query
  const countResult = await countQuery;
  const total = parseInt(countResult.rows?.[0]?.count || countResult.count || 0);

  // Get paginated data
  const dataQuery = queryFn(false, { limit, offset });
  const dataResult = await dataQuery;
  const data = dataResult.rows || dataResult.data || [];

  const paginationMeta = createPaginationMeta({
    page: pagination.page,
    limit,
    total
  });

  return {
    data,
    pagination: paginationMeta
  };
}

/**
 * Pagination middleware for Express routes
 * Adds pagination parameters to req.pagination
 */
function paginationMiddleware(options = {}) {
  return (req, res, next) => {
    req.pagination = parsePaginationParams(req, options);
    next();
  };
}

module.exports = {
  parsePaginationParams,
  createPaginationMeta,
  createPaginatedResponse,
  paginateQuery,
  paginationMiddleware
};
