import dotenv from 'dotenv';

dotenv.config();

interface AuthConfig {
  loginUrl: string;
  email: string;
  password: string;
}

interface ApiConfig {
  baseUrl: string;
  hrBaseUrl: string;
  taskManagementBaseUrl: string;
  imsCustomersBaseUrl: string;
}

interface Config {
  auth: AuthConfig;
  api: ApiConfig;
}

const DEFAULT_API_URLS = {
  baseUrl: 'https://api.innoscripta.com',
  hrBaseUrl: 'https://innos-hr-backend.innoscripta.com',
  taskManagementBaseUrl: 'https://task-management-backend.innoscripta.com',
  imsCustomersBaseUrl: 'https://ims-customers.innoscripta.com',
} as const;

/**
 * Validate legacy config (for backward compatibility)
 * This function checks for old-style environment variables (LOGIN_URL, EMAIL, PASSWORD)
 */
function validateLegacyConfig(): Config | null {
  // Check if old-style variables exist
  if (process.env.LOGIN_URL && process.env.EMAIL && process.env.PASSWORD) {
    return {
      auth: {
        loginUrl: process.env.LOGIN_URL,
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
      },
      api: {
        baseUrl: process.env.API_BASE_URL || DEFAULT_API_URLS.baseUrl,
        hrBaseUrl: process.env.HR_API_BASE_URL || DEFAULT_API_URLS.hrBaseUrl,
        taskManagementBaseUrl: process.env.TASK_MANAGEMENT_API_BASE_URL || DEFAULT_API_URLS.taskManagementBaseUrl,
        imsCustomersBaseUrl: process.env.IMS_CUSTOMERS_API_BASE_URL || DEFAULT_API_URLS.imsCustomersBaseUrl,
      },
    };
  }
  return null;
}

/**
 * Validate new environment-based config
 * This checks for TESTING_* or PROD_* variables and defaults to testing
 */
function validateEnvironmentConfig(): Config {
  // Check which environment variables are available
  const hasTestingCreds = process.env.TESTING_EMAIL && process.env.TESTING_PASSWORD;
  const hasProdCreds = process.env.PROD_EMAIL && process.env.PROD_PASSWORD;

  if (!hasTestingCreds && !hasProdCreds) {
    throw new Error(
      'Missing environment credentials.\n' +
      'Please provide either:\n' +
      '  - TESTING_EMAIL and TESTING_PASSWORD, or\n' +
      '  - PROD_EMAIL and PROD_PASSWORD\n' +
      'in your .env file. See .env.example for reference.'
    );
  }

  // Default to testing environment
  const envPrefix = hasTestingCreds ? 'TESTING' : 'PROD';
  const loginUrl = process.env[`${envPrefix}_LOGIN_URL`] ||
    (envPrefix === 'TESTING'
      ? 'https://api-testing.innoscripta.com/auth/login'
      : DEFAULT_API_URLS.baseUrl + '/auth/login');

  return {
    auth: {
      loginUrl,
      email: process.env[`${envPrefix}_EMAIL`]!,
      password: process.env[`${envPrefix}_PASSWORD`]!,
    },
    api: {
      baseUrl: process.env[`${envPrefix}_API_BASE_URL`] ||
        (envPrefix === 'TESTING' ? 'https://api-testing.innoscripta.com' : DEFAULT_API_URLS.baseUrl),
      hrBaseUrl: process.env[`${envPrefix}_HR_API_BASE_URL`] ||
        (envPrefix === 'TESTING' ? 'https://innos-hr-backend-testing.innoscripta.com' : DEFAULT_API_URLS.hrBaseUrl),
      taskManagementBaseUrl: process.env[`${envPrefix}_TASK_MANAGEMENT_API_BASE_URL`] ||
        (envPrefix === 'TESTING' ? 'https://task-management-backend-testing.innoscripta.com' : DEFAULT_API_URLS.taskManagementBaseUrl),
      imsCustomersBaseUrl: process.env[`${envPrefix}_IMS_CUSTOMERS_API_BASE_URL`] ||
        (envPrefix === 'TESTING' ? 'https://ims-customers-testing.innoscripta.com' : DEFAULT_API_URLS.imsCustomersBaseUrl),
    },
  };
}

/**
 * Main config validation - supports both legacy and new environment-based configs
 */
function validateConfig(): Config {
  // Try legacy config first (backward compatibility)
  const legacyConfig = validateLegacyConfig();
  if (legacyConfig) {
    console.warn(
      '⚠️  Using legacy environment variables (LOGIN_URL, EMAIL, PASSWORD).\n' +
      '   Consider migrating to environment-specific variables (TESTING_*, PROD_*).\n' +
      '   See .env.example for the new format.\n'
    );
    return legacyConfig;
  }

  // Use new environment-based config
  return validateEnvironmentConfig();
}

export const config = validateConfig();
