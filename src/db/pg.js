// backend/src/db/pg.js
// Lightweight PostgreSQL pool helper used for small persistence tasks
// (Customer ↔ Tebra mapping). This does not change existing Mongo usage
// elsewhere in the codebase.

const { Pool } = require('pg');
const logger = require('../utils/logger');

// Cache environment variables
const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL || null,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'sxrx',
};

// Build config from env (DATABASE_URL takes precedence)
function getPoolConfig(targetDb) {
  if (DB_CONFIG.connectionString) {
    return {
      connectionString: DB_CONFIG.connectionString,
      ssl: DB_CONFIG.ssl,
      // Connection pool settings for better performance
      max: parseInt(process.env.PG_MAX_CONNECTIONS) || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }
  return {
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    database: targetDb || DB_CONFIG.database,
    ssl: DB_CONFIG.ssl,
    // Connection pool settings for better performance
    max: parseInt(process.env.PG_MAX_CONNECTIONS) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
}

let pool;

async function ensureDatabaseExists() {
  logger.info('Ensuring database exists');
  
  // Extract database name from config
  let targetDb = DB_CONFIG.database;
  
  // If DATABASE_URL is set, try to extract database name from it
  if (DB_CONFIG.connectionString) {
    try {
      const url = new URL(DB_CONFIG.connectionString);
      const dbName = url.pathname.slice(1); // Remove leading slash
      if (dbName) {
        targetDb = dbName;
        logger.debug('Extracted database name from DATABASE_URL', { targetDb });
      }
    } catch (e) {
      logger.warn('Could not parse DATABASE_URL, using default', { targetDb });
    }
  }
  
  logger.debug('Target database', { targetDb });
  
  // Attempt a simple connection; if DB doesn't exist, create it.
  try {
    const testPool = new Pool(getPoolConfig());
    const client = await testPool.connect();
    logger.info('Database connection successful - database exists');
    client.release();
    await testPool.end();
    return; // database exists
  } catch (err) {
    logger.warn('Connection test failed', { code: err?.code, message: err?.message });
    
    // If error code 3D000 (invalid_catalog_name) or message contains "does not exist" -> DB does not exist
    const isDbNotFound = err?.code === '3D000' || 
                        /does not exist/i.test(err?.message || '') ||
                        /database.*does not exist/i.test(err?.message || '');
    
    if (isDbNotFound) {
      logger.info('Database does not exist, creating it', { targetDb });
      // Connect to default 'postgres' database and create the target DB
      
      // Build admin config (connect to 'postgres' database)
      let adminConfig;
      if (DB_CONFIG.connectionString) {
        // Replace database name in URL with 'postgres'
        const url = new URL(DB_CONFIG.connectionString);
        url.pathname = '/postgres';
        adminConfig = {
          connectionString: url.toString(),
          ssl: DB_CONFIG.ssl,
        };
      } else {
        adminConfig = getPoolConfig('postgres');
      }
      
      const adminPool = new Pool(adminConfig);
      try {
        const adminClient = await adminPool.connect();
        try {
          // Properly escape database name to prevent SQL injection
          const escapedDbName = targetDb.replace(/"/g, '""'); // Escape quotes
          const createDbQuery = `CREATE DATABASE "${escapedDbName}"`;
          await adminClient.query(createDbQuery);
          logger.info('Database created successfully', { targetDb });
        } catch (e) {
          // Ignore if already exists (race condition or already created)
          if (e && /already exists/i.test(e.message || '')) {
            logger.info('Database already exists (race condition)', { targetDb });
          } else {
            logger.error('Failed to create database', { error: e.message, targetDb });
            throw e;
          }
        } finally {
          adminClient.release();
        }
      } finally {
        await adminPool.end();
      }
      logger.info('Database setup complete');
      return; // created or already existed
    }
    
    // Unknown error, log and rethrow
    logger.error('Unexpected error during database check', { error: err.message, code: err?.code });
    throw err;
  }
}

async function ensurePool() {
  if (pool) return pool;
  await ensureDatabaseExists();
  pool = new Pool(getPoolConfig());
  return pool;
}

async function query(text, params) {
  try {
    const p = await ensurePool();
    const client = await p.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  } catch (error) {
    logger.errorWithContext(error, {
      operation: 'database_query',
      query: text.substring(0, 100), // Log first 100 chars to avoid logging huge queries
      hasParams: !!params && params.length > 0,
      code: error?.code
    });
    throw error;
  }
}

module.exports = { getPoolConfig, ensurePool, query };
