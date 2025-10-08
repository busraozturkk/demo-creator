/**
 * Application constants and magic values
 */

// Default role ID for users
export const DEFAULT_USER_ROLE_ID = '4afc3210-9686-4fba-9a10-4cd21d5d2535';

// Module IDs
export const MODULE_IDS = {
  HR: '3',
} as const;

// HTTP Headers
export const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  acceptLanguage: 'en-US,en;q=0.9',
  contentType: 'application/json',
  origin: 'https://clusterix.io',
  referer: 'https://clusterix.io/',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
} as const;

// Content types
export const CONTENT_TYPES = {
  JSON: 'application/json',
  FORM_URLENCODED: 'application/x-www-form-urlencoded',
  MULTIPART_FORM_DATA: 'multipart/form-data',
} as const;

// Form boundary for multipart uploads
export const MULTIPART_BOUNDARY = '----WebKitFormBoundaryjh5W5bFk4QoAnAr6';

// External model type for employee assignments
export const EXTERNAL_MODEL_TYPES = {
  EMPLOYEE: 'App\\Models\\Employee\\Employee',
} as const;

// Cache paths
export const CACHE_PATHS = {
  DIRECTORY: './data/cache',
  EMPLOYEE_MAPPINGS: './data/cache/employee-mappings.json',
  DEPARTMENT_MAPPINGS: './data/cache/department-mappings.json',
  OFFICE_MAPPINGS: './data/cache/office-mappings.json',
  LOCATION_IDS: './data/cache/location-ids.json',
  REFERENCE_DATA: './data/cache/reference-data.json',
  HR_REFERENCE_DATA: './data/cache/hr-reference-data.json',
  DAY_OFF_TYPES: './data/cache/day-off-types.json',
  ORGANIZATION_ID: './data/cache/organization-id.json',
} as const;

// Default values
export const DEFAULTS = {
  DAYS_OFF_NUMBER: '24',
  DATA_GROUP: 'data-en',
  IBAN_BANK_CODE_DE: '37040044', // Commerzbank
  IBAN_BANK_CODE_GB: 'WEST',
  IBAN_SORT_CODE_GB: '123456',
} as const;
