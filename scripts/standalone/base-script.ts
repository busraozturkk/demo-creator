/**
 * Base Script Utilities
 * Shared functionality for all standalone scripts
 */

import { AuthService } from '../../src/auth';
import { ApiClient } from '../../src/api-client';
import { Environment, EnvironmentConfig, getEnvironmentConfig } from '../../src/environment';

export interface ScriptConfig {
  email: string;
  password: string;
  csvPath: string;
  environment: 'testing' | 'production';
  language?: 'en' | 'de';
}

export interface ScriptContext {
  email: string;
  password: string;
  environment: Environment;
  envConfig: EnvironmentConfig;
  bearerToken: string;
  organizationId: string;
  partnerId: string;
  language: string;
  csvPath: string;
  authService: AuthService;
  apiClient: ApiClient;
  hrApiClient: ApiClient;
  taskManagementApiClient: ApiClient;
  imsCustomersApiClient: ApiClient;
}

/**
 * Parse command line arguments
 */
export function parseArgs(): ScriptConfig {
  const args = process.argv.slice(2);

  const config: Partial<ScriptConfig> = {
    environment: 'testing',
    language: 'en'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--email':
      case '-e':
        config.email = args[++i];
        break;
      case '--password':
      case '-p':
        config.password = args[++i];
        break;
      case '--csv':
      case '-c':
        config.csvPath = args[++i];
        break;
      case '--env':
        const env = args[++i];
        if (env !== 'testing' && env !== 'production') {
          throw new Error(`Invalid environment: ${env}. Use 'testing' or 'production'`);
        }
        config.environment = env;
        break;
      case '--language':
      case '-l':
        const lang = args[++i];
        if (lang !== 'en' && lang !== 'de') {
          throw new Error(`Invalid language: ${lang}. Use 'en' or 'de'`);
        }
        config.language = lang;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  // Validate required fields
  if (!config.email || !config.password || !config.csvPath) {
    console.error('Error: Missing required arguments\n');
    printHelp();
    process.exit(1);
  }

  return config as ScriptConfig;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Usage: npm run script:<name> -- --email <email> --password <password> --csv <path> [options]

Required Arguments:
  -e, --email <email>        Account email
  -p, --password <password>  Account password
  -c, --csv <path>          Path to CSV file

Optional Arguments:
  --env <env>               Environment: 'testing' or 'production' (default: testing)
  -l, --language <lang>     Language: 'en' or 'de' (default: en)
  -h, --help                Show this help message

Example:
  npm run script:users -- --email admin@example.com --password secret123 --csv ./data/employees.csv
  npm run script:projects -- -e admin@example.com -p secret123 -c ./data/projects.csv --env production
  `);
}

/**
 * Initialize script context (login, fetch organization ID)
 */
export async function initializeContext(config: ScriptConfig): Promise<ScriptContext> {
  console.log('🔐 Authenticating...');

  const environment = config.environment;
  const envConfig = getEnvironmentConfig(environment);
  const authService = new AuthService(envConfig.loginUrl);

  // Login
  const bearerToken = await authService.login(config.email, config.password);
  console.log('✅ Login successful');

  // Create API clients
  const apiClient = new ApiClient(authService, envConfig.apiBaseUrl);
  const hrApiClient = new ApiClient(authService, envConfig.hrApiBaseUrl);
  const taskManagementApiClient = new ApiClient(authService, envConfig.taskManagementApiBaseUrl);
  const imsCustomersApiClient = new ApiClient(authService, envConfig.imsCustomersApiBaseUrl);

  // Fetch organization ID
  console.log('🏢 Fetching organization ID...');
  const userId = authService.getUserId();
  const userResponse = await apiClient.executeRequest('GET', `/auth/users/${userId}`);

  const userOrganization = userResponse.data?.organization || userResponse.organization;
  if (!userOrganization) {
    throw new Error('User does not have an organization');
  }

  const organizationId = userOrganization.toString();

  // Fetch partner ID (same as organization ID in most cases)
  const orgResponse = await apiClient.executeRequest('GET', '/api/organization');
  const partnerId = (orgResponse.data?.id || orgResponse.id).toString();

  // Set partner ID for all clients
  apiClient.setPartnerId(partnerId);
  hrApiClient.setPartnerId(partnerId);
  taskManagementApiClient.setPartnerId(partnerId);
  imsCustomersApiClient.setPartnerId(partnerId);

  console.log(`✅ Organization ID: ${organizationId}`);
  console.log(`✅ Partner ID: ${partnerId}`);

  return {
    email: config.email,
    password: config.password,
    environment,
    envConfig,
    bearerToken,
    organizationId,
    partnerId,
    language: config.language || 'en',
    csvPath: config.csvPath,
    authService,
    apiClient,
    hrApiClient,
    taskManagementApiClient,
    imsCustomersApiClient
  };
}

/**
 * Handle script errors
 */
export function handleError(error: unknown): void {
  console.error('\n❌ Script failed with error:');

  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  } else {
    console.error(error);
  }

  process.exit(1);
}

/**
 * Log success message
 */
export function logSuccess(message: string): void {
  console.log(`\n✅ ${message}\n`);
}

/**
 * Log info message
 */
export function logInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

/**
 * Log warning message
 */
export function logWarning(message: string): void {
  console.log(`⚠️  ${message}`);
}
