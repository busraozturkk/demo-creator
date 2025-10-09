import Bull from 'bull';
import Redis from 'ioredis';

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

// Create Redis client for Bull
const createRedisClient = () => new Redis(redisConfig);

// Create the demo creation queue
export const demoQueue = new Bull('demo-creation', {
  createClient: (type) => {
    switch (type) {
      case 'client':
        return createRedisClient();
      case 'subscriber':
        return createRedisClient();
      case 'bclient':
        return createRedisClient();
      default:
        return createRedisClient();
    }
  },
  defaultJobOptions: {
    attempts: 1, // Don't retry failed jobs automatically
    removeOnComplete: false, // Keep completed jobs for history
    removeOnFail: false, // Keep failed jobs for debugging
  },
});

// Job data interface
export interface DemoJobData {
  dataGroup: string;
  emailDomain: string;
  email?: string;
  password?: string;
  environment: 'testing' | 'production';
  mode: 'bulk' | 'step-by-step';
  companyName?: string;
  selectedProjects?: string[];
  includeWorkPackages?: boolean;
  socketId?: string; // For real-time updates
}

// Job progress interface
export interface DemoJobProgress {
  step: string;
  currentStep: number;
  totalSteps: number;
  percentage: number;
  message: string;
}

export default demoQueue;
