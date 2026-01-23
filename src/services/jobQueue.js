// backend/src/services/jobQueue.js
// Background job queue using BullMQ for async processing

const { Queue, Worker } = require('bullmq');
const logger = require('../utils/logger');

class JobQueueService {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.enabled = process.env.REDIS_ENABLED !== 'false';
    
    if (!this.enabled) {
      logger.warn('[JOB_QUEUE] Redis not enabled, job queue disabled');
      return;
    }

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    // Parse Redis URL properly
    let connection;
    try {
      if (redisUrl.includes('://')) {
        const url = new URL(redisUrl);
        connection = {
          host: url.hostname || 'localhost',
          port: parseInt(url.port) || 6379,
          password: url.password || undefined,
          // BullMQ can also use the full URL
          url: redisUrl
        };
      } else {
        // Fallback for simple host:port format
        const parts = redisUrl.split(':');
        connection = {
          host: parts[0] || 'localhost',
          port: parseInt(parts[1]) || 6379
        };
      }
    } catch (error) {
      logger.error('[JOB_QUEUE] Failed to parse Redis URL', {
        error: error?.message || error?.toString() || 'Unknown error',
        redisUrl: redisUrl.replace(/:[^:@]+@/, ':****@') // Mask password in logs
      });
      // Fallback to default
      connection = {
        host: 'localhost',
        port: 6379
      };
    }

    this.connection = connection;
    
    // Test Redis connection on startup (async, non-blocking)
    // Note: This runs asynchronously and won't block startup
    setImmediate(() => {
      this.testConnection().catch((err) => {
        logger.warn('[JOB_QUEUE] Redis connection test failed (workers may not function)', {
          error: err?.message || err?.toString() || 'Unknown error',
          code: err?.code
        });
      });
    });
    
    this.defaultJobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: {
        age: 24 * 3600, // Keep completed jobs for 24 hours
        count: 1000 // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600 // Keep failed jobs for 7 days
      }
    };
  }

  /**
   * Get or create a queue
   * @param {string} queueName - Queue name
   * @returns {Queue} BullMQ queue instance
   */
  getQueue(queueName) {
    if (!this.enabled) {
      logger.warn(`[JOB_QUEUE] Queue ${queueName} requested but Redis is disabled`);
      return null;
    }

    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    const queue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: this.defaultJobOptions
    });

    this.queues.set(queueName, queue);
    logger.info(`[JOB_QUEUE] Created queue: ${queueName}`);
    return queue;
  }

  /**
   * Add a job to the queue
   * @param {string} queueName - Queue name
   * @param {string} jobName - Job name
   * @param {Object} data - Job data
   * @param {Object} options - Job options
   * @returns {Promise<string>} Job ID
   */
  async addJob(queueName, jobName, data, options = {}) {
    if (!this.enabled) {
      logger.warn(`[JOB_QUEUE] Job ${jobName} requested but Redis is disabled, executing immediately`);
      // Fallback: execute immediately if Redis is disabled
      return await this.executeJobImmediately(jobName, data);
    }

    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not available`);
    }

    const job = await queue.add(jobName, data, {
      ...this.defaultJobOptions,
      ...options
    });

    logger.info(`[JOB_QUEUE] Added job ${jobName} to queue ${queueName}`, { jobId: job.id });
    return job.id;
  }

  /**
   * Execute job immediately (fallback when Redis is disabled)
   * @param {string} jobName - Job name
   * @param {Object} data - Job data
   * @returns {Promise<string>} Job ID (fake)
   */
  async executeJobImmediately(jobName, data) {
    logger.info(`[JOB_QUEUE] Executing job ${jobName} immediately (Redis disabled)`);
    
    // Import job processors
    const processors = require('./jobProcessors');
    const processor = processors[jobName];
    
    if (!processor) {
      throw new Error(`No processor found for job ${jobName}`);
    }
    
    try {
      await processor(data);
      return 'immediate-execution';
    } catch (error) {
      logger.error(`[JOB_QUEUE] Immediate execution failed for ${jobName}`, { 
        error: error?.message || error?.toString() || 'Unknown execution error',
        code: error?.code,
        stack: error?.stack
      });
      throw error;
    }
  }

  /**
   * Create a worker for a queue
   * @param {string} queueName - Queue name
   * @param {Function} processor - Job processor function
   * @returns {Worker} BullMQ worker instance
   */
  createWorker(queueName, processor) {
    if (!this.enabled) {
      logger.warn(`[JOB_QUEUE] Worker for ${queueName} requested but Redis is disabled`);
      return null;
    }

    if (this.workers.has(queueName)) {
      return this.workers.get(queueName);
    }

    let worker;
    try {
      worker = new Worker(queueName, processor, {
        connection: this.connection,
        concurrency: parseInt(process.env.JOB_QUEUE_CONCURRENCY) || 5
      });
    } catch (error) {
      logger.error(`[JOB_QUEUE] Failed to create worker for queue ${queueName}`, {
        error: error?.message || error?.toString() || 'Unknown error',
        code: error?.code,
        stack: error?.stack
      });
      return null;
    }

    worker.on('completed', (job) => {
      logger.info(`[JOB_QUEUE] Job ${job.id} completed in queue ${queueName}`, {
        jobName: job.name,
        duration: Date.now() - job.timestamp
      });
    });

    worker.on('failed', (job, err) => {
      logger.error(`[JOB_QUEUE] Job ${job.id} failed in queue ${queueName}`, {
        jobName: job.name,
        error: err?.message || err?.toString() || 'Unknown job error',
        code: err?.code,
        stack: err?.stack
      });
    });

    worker.on('error', (err) => {
      logger.error(`[JOB_QUEUE] Worker error in queue ${queueName}`, { 
        error: err?.message || err?.toString() || 'Unknown worker error',
        code: err?.code,
        errno: err?.errno,
        syscall: err?.syscall,
        stack: err?.stack
      });
    });

    this.workers.set(queueName, worker);
    logger.info(`[JOB_QUEUE] Created worker for queue: ${queueName}`);
    return worker;
  }

  /**
   * Get queue statistics
   * @param {string} queueName - Queue name
   * @returns {Promise<Object>} Queue statistics
   */
  async getQueueStats(queueName) {
    if (!this.enabled) {
      return { enabled: false };
    }

    const queue = this.getQueue(queueName);
    if (!queue) {
      return { error: 'Queue not found' };
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    return {
      enabled: true,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  }

  /**
   * Test Redis connection
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.enabled) {
      return false;
    }
    
    try {
      const testQueue = this.getQueue('_connection_test');
      // Try to add a test job (will fail if Redis is not available)
      await testQueue.add('test', { test: true }, { removeOnComplete: true, removeOnFail: true });
      await testQueue.close();
      logger.info('[JOB_QUEUE] Redis connection test successful');
      return true;
    } catch (error) {
      logger.error('[JOB_QUEUE] Redis connection test failed', {
        error: error?.message || error?.toString() || 'Unknown error',
        code: error?.code
      });
      return false;
    }
  }

  /**
   * Close all queues and workers
   */
  async close() {
    logger.info('[JOB_QUEUE] Closing all queues and workers');
    
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.info(`[JOB_QUEUE] Closed worker: ${name}`);
    }
    
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info(`[JOB_QUEUE] Closed queue: ${name}`);
    }
    
    this.workers.clear();
    this.queues.clear();
  }
}

// Singleton instance
const jobQueueService = new JobQueueService();

module.exports = jobQueueService;
