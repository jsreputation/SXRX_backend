// backend/src/db/migrate.js
// Database migration system

const fs = require('fs');
const path = require('path');
const { query } = require('./pg');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

/**
 * Ensure migrations table exists
 */
async function ensureMigrationsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename ON ${MIGRATIONS_TABLE}(filename);
  `;
  await query(sql);
  logger.info('[MIGRATIONS] Migrations table ensured');
}

/**
 * Get list of executed migrations
 */
async function getExecutedMigrations() {
  const { rows } = await query(`SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY id`);
  return rows.map(row => row.filename);
}

/**
 * Get list of migration files
 */
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('[MIGRATIONS] Migrations directory does not exist:', MIGRATIONS_DIR);
    return [];
  }
  
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();
  
  return files;
}

/**
 * Execute a single migration file
 */
async function executeMigration(filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Migration file not found: ${filePath}`);
  }
  
  const sql = fs.readFileSync(filePath, 'utf8');
  
  logger.info(`[MIGRATIONS] Executing migration: ${filename}`);
  
  try {
    // Execute migration SQL
    await query(sql);
    
    // Record migration as executed
    await query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [filename]
    );
    
    logger.info(`[MIGRATIONS] ✅ Migration executed successfully: ${filename}`);
    return true;
  } catch (error) {
    logger.error(`[MIGRATIONS] ❌ Migration failed: ${filename}`, error);
    throw error;
  }
}

/**
 * Run all pending migrations
 */
async function runMigrations() {
  try {
    logger.info('[MIGRATIONS] Starting migration process...');
    
    // Ensure migrations table exists
    await ensureMigrationsTable();
    
    // Get executed and pending migrations
    const executed = await getExecutedMigrations();
    const allFiles = getMigrationFiles();
    const pending = allFiles.filter(file => !executed.includes(file));
    
    if (pending.length === 0) {
      logger.info('[MIGRATIONS] No pending migrations');
      return { executed: 0, pending: 0 };
    }
    
    logger.info(`[MIGRATIONS] Found ${pending.length} pending migration(s): ${pending.join(', ')}`);
    
    // Execute pending migrations in order
    let executedCount = 0;
    for (const filename of pending) {
      await executeMigration(filename);
      executedCount++;
    }
    
    logger.info(`[MIGRATIONS] ✅ Migration process completed. Executed ${executedCount} migration(s)`);
    
    return {
      executed: executedCount,
      pending: pending.length
    };
  } catch (error) {
    logger.error('[MIGRATIONS] Migration process failed:', error);
    throw error;
  }
}

/**
 * Get migration status
 */
async function getMigrationStatus() {
  try {
    await ensureMigrationsTable();
    const executed = await getExecutedMigrations();
    const allFiles = getMigrationFiles();
    const pending = allFiles.filter(file => !executed.includes(file));
    
    return {
      executed: executed.length,
      pending: pending.length,
      executedFiles: executed,
      pendingFiles: pending,
      allFiles: allFiles.length
    };
  } catch (error) {
    logger.error('[MIGRATIONS] Failed to get migration status:', error);
    throw error;
  }
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  executeMigration,
  ensureMigrationsTable
};
