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
    const connection = {
      host: redisUrl.includes('://') ? new URL(redisUrl).hostname : 'localhost',
      port: redisUrl.includes('://') ? parseInt(new URL(redisUrl).port) || 6379 : 6379,
      password: redisUrl.includes('@') ? redisUrl.split('@')[0].split(':')[2] : undefined
    };

    this.connection = connection;
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
      logger.error(`[JOB_QUEUE] Immediate execution failed for ${jobName}`, { error: error.message });
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

    const worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency: parseInt(process.env.JOB_QUEUE_CONCURRENCY) || 5
    });

    worker.on('completed', (job) => {
      logger.info(`[JOB_QUEUE] Job ${job.id} completed in queue ${queueName}`, {
        jobName: job.name,
        duration: Date.now() - job.timestamp
      });
    });

    worker.on('failed', (job, err) => {
      logger.error(`[JOB_QUEUE] Job ${job.id} failed in queue ${queueName}`, {
        jobName: job.name,
        error: err.message,
        stack: err.stack
      });
    });

    worker.on('error', (err) => {
      logger.error(`[JOB_QUEUE] Worker error in queue ${queueName}`, { error: err.message });
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
