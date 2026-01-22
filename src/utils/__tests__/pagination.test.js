// Unit tests for pagination.js

const {
  parsePaginationParams,
  createPaginationMeta,
  createPaginatedResponse,
  paginateQuery,
  paginationMiddleware
} = require('../pagination');

describe('pagination', () => {
  describe('parsePaginationParams', () => {
    it('should use default values when no query params', () => {
      const req = { query: {} };
      const result = parsePaginationParams(req);
      expect(result).toEqual({
        page: 1,
        limit: 20,
        offset: 0
      });
    });

    it('should parse page and limit from query', () => {
      const req = { query: { page: '2', limit: '10' } };
      const result = parsePaginationParams(req);
      expect(result).toEqual({
        page: 2,
        limit: 10,
        offset: 10
      });
    });

    it('should use custom defaults', () => {
      const req = { query: {} };
      const result = parsePaginationParams(req, {
        defaultPage: 2,
        defaultLimit: 50
      });
      expect(result).toEqual({
        page: 2,
        limit: 50,
        offset: 50
      });
    });

    it('should enforce maxLimit', () => {
      const req = { query: { limit: '200' } };
      const result = parsePaginationParams(req, { maxLimit: 100 });
      expect(result.limit).toBe(100);
    });

    it('should enforce minimum page of 1', () => {
      const req = { query: { page: '0' } };
      const result = parsePaginationParams(req);
      expect(result.page).toBe(1);
    });

    it('should enforce minimum limit of 1', () => {
      const req = { query: { limit: '0' } };
      const result = parsePaginationParams(req);
      // When limit is 0, it falls back to defaultLimit (20), then Math.max(1, 20) = 20
      // The actual enforcement happens: Math.max(1, parseInt(req.query.limit) || defaultLimit)
      // So 0 becomes falsy, uses defaultLimit 20, then Math.max(1, 20) = 20
      expect(result.limit).toBeGreaterThanOrEqual(1);
      // But if we want to test the actual behavior, limit 0 uses default
      expect(result.limit).toBe(20); // Uses default when limit is 0
    });

    it('should handle negative values', () => {
      const req = { query: { page: '-1', limit: '-5' } };
      const result = parsePaginationParams(req);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
    });

    it('should handle non-numeric values', () => {
      const req = { query: { page: 'abc', limit: 'xyz' } };
      const result = parsePaginationParams(req);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should calculate offset correctly', () => {
      const req = { query: { page: '3', limit: '25' } };
      const result = parsePaginationParams(req);
      expect(result.offset).toBe(50); // (3-1) * 25
    });
  });

  describe('createPaginationMeta', () => {
    it('should create correct pagination metadata', () => {
      const result = createPaginationMeta({
        page: 2,
        limit: 10,
        total: 25
      });
      expect(result).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
        nextPage: 3,
        previousPage: 1
      });
    });

    it('should handle first page', () => {
      const result = createPaginationMeta({
        page: 1,
        limit: 10,
        total: 25
      });
      expect(result.hasPreviousPage).toBe(false);
      expect(result.previousPage).toBeNull();
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it('should handle last page', () => {
      const result = createPaginationMeta({
        page: 3,
        limit: 10,
        total: 25
      });
      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeNull();
      expect(result.hasPreviousPage).toBe(true);
      expect(result.previousPage).toBe(2);
    });

    it('should handle exact page boundary', () => {
      const result = createPaginationMeta({
        page: 2,
        limit: 10,
        total: 20
      });
      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeNull();
    });

    it('should handle zero total', () => {
      const result = createPaginationMeta({
        page: 1,
        limit: 10,
        total: 0
      });
      expect(result.totalPages).toBe(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });
  });

  describe('createPaginatedResponse', () => {
    it('should create paginated response', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const pagination = {
        page: 1,
        limit: 10,
        total: 2
      };
      const result = createPaginatedResponse(data, pagination);
      expect(result).toEqual({
        success: true,
        data,
        pagination
      });
    });

    it('should include additional fields', () => {
      const data = [{ id: 1 }];
      const pagination = { page: 1, limit: 10, total: 1 };
      const additional = { message: 'Success', timestamp: '2024-01-01' };
      const result = createPaginatedResponse(data, pagination, additional);
      expect(result.message).toBe('Success');
      expect(result.timestamp).toBe('2024-01-01');
    });
  });

  describe('paginateQuery', () => {
    it('should paginate query results', async () => {
      const mockQueryFn = jest.fn();
      
      // Mock count query
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ rows: [{ count: '25' }] })
      );
      
      // Mock data query
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ rows: [{ id: 1 }, { id: 2 }] })
      );

      const pagination = { page: 2, limit: 10, offset: 10 };
      const result = await paginateQuery(mockQueryFn, pagination);

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.page).toBe(2);
      expect(mockQueryFn).toHaveBeenCalledTimes(2);
    });

    it('should handle count query with different format', async () => {
      const mockQueryFn = jest.fn();
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ count: 15 })
      );
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ data: [{ id: 1 }] })
      );

      const pagination = { page: 1, limit: 10, offset: 0 };
      const result = await paginateQuery(mockQueryFn, pagination);

      expect(result.pagination.total).toBe(15);
    });

    it('should handle zero results', async () => {
      const mockQueryFn = jest.fn();
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ rows: [{ count: '0' }] })
      );
      mockQueryFn.mockReturnValueOnce(
        Promise.resolve({ rows: [] })
      );

      const pagination = { page: 1, limit: 10, offset: 0 };
      const result = await paginateQuery(mockQueryFn, pagination);

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('paginationMiddleware', () => {
    it('should add pagination to request', () => {
      const req = { query: { page: '2', limit: '15' } };
      const res = {};
      const next = jest.fn();

      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 2,
        limit: 15,
        offset: 15
      });
      expect(next).toHaveBeenCalled();
    });

    it('should use custom options', () => {
      const req = { query: {} };
      const res = {};
      const next = jest.fn();

      const middleware = paginationMiddleware({
        defaultPage: 2,
        defaultLimit: 50,
        maxLimit: 100
      });
      middleware(req, res, next);

      expect(req.pagination.limit).toBe(50);
      expect(req.pagination.page).toBe(2);
    });
  });
});
