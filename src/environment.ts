import dotenv from 'dotenv';

dotenv.config();

export type Environment = 'testing' | 'production';

export interface EnvironmentConfig {
  name: Environment;
  loginUrl: string;
  apiBaseUrl: string;
  hrApiBaseUrl: string;
  taskManagementApiBaseUrl: string;
  imsCustomersApiBaseUrl: string;
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Environment configurations
 */
const ENVIRONMENTS: Record<Environment, Omit<EnvironmentConfig, 'name'>> = {
  testing: {
    loginUrl: process.env.TESTING_LOGIN_URL || 'https://api-testing.innoscripta.com/auth/login',
    apiBaseUrl: process.env.TESTING_API_BASE_URL || 'https://api-testing.innoscripta.com',
    hrApiBaseUrl: process.env.TESTING_HR_API_BASE_URL || 'https://innos-hr-backend-testing.innoscripta.com',
    taskManagementApiBaseUrl: process.env.TESTING_TASK_MANAGEMENT_API_BASE_URL || 'https://task-management-backend-testing.innoscripta.com',
    imsCustomersApiBaseUrl: process.env.TESTING_IMS_CUSTOMERS_API_BASE_URL || 'https://ims-customers-testing.innoscripta.com',
  },
  production: {
    loginUrl: process.env.PROD_LOGIN_URL || 'https://api.innoscripta.com/auth/login',
    apiBaseUrl: process.env.PROD_API_BASE_URL || 'https://api.innoscripta.com',
    hrApiBaseUrl: process.env.PROD_HR_API_BASE_URL || 'https://innos-hr-backend.innoscripta.com',
    taskManagementApiBaseUrl: process.env.PROD_TASK_MANAGEMENT_API_BASE_URL || 'https://task-management-backend.innoscripta.com',
    imsCustomersApiBaseUrl: process.env.PROD_IMS_CUSTOMERS_API_BASE_URL || 'https://ims-customers.innoscripta.com',
  },
};

/**
 * Get environment configuration
 */
export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
  return {
    name: env,
    ...ENVIRONMENTS[env],
  };
}

/**
 * Get credentials for a specific environment
 */
export function getCredentials(env: Environment): Credentials {
  const envPrefix = env === 'testing' ? 'TESTING' : 'PROD';

  const email = process.env[`${envPrefix}_EMAIL`];
  const password = process.env[`${envPrefix}_PASSWORD`];

  if (!email || !password) {
    throw new Error(
      `Missing credentials for ${env} environment.\n` +
      `Please set ${envPrefix}_EMAIL and ${envPrefix}_PASSWORD in your .env file.`
    );
  }

  return { email, password };
}

/**
 * Validate environment string
 */
export function isValidEnvironment(env: string): env is Environment {
  return env === 'testing' || env === 'production';
}

/**
 * Get environment from string with fallback
 */
export function parseEnvironment(envString?: string): Environment {
  if (!envString) {
    return 'testing'; // Default to testing
  }

  const normalized = envString.toLowerCase().trim();

  if (isValidEnvironment(normalized)) {
    return normalized;
  }

  // Try to match partial strings
  if (normalized.includes('prod')) {
    return 'production';
  }

  if (normalized.includes('test')) {
    return 'testing';
  }

  console.warn(`Invalid environment "${envString}", defaulting to testing`);
  return 'testing';
}

/**
 * Environment manager class
 */
export class EnvironmentManager {
  private currentEnvironment: Environment;
  private config: EnvironmentConfig;
  private credentials: Credentials;

  constructor(env?: Environment) {
    this.currentEnvironment = env || 'testing';
    this.config = getEnvironmentConfig(this.currentEnvironment);
    this.credentials = getCredentials(this.currentEnvironment);
  }

  getEnvironment(): Environment {
    return this.currentEnvironment;
  }

  getConfig(): EnvironmentConfig {
    return this.config;
  }

  getCredentials(): Credentials {
    return this.credentials;
  }

  switchEnvironment(env: Environment): void {
    this.currentEnvironment = env;
    this.config = getEnvironmentConfig(env);
    this.credentials = getCredentials(env);
  }

  getDisplayName(): string {
    return this.currentEnvironment === 'testing' ? 'Testing' : 'Production';
  }
}
