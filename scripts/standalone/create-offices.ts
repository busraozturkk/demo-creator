#!/usr/bin/env node
/**
 * Standalone Office/Location Creation Script
 *
 * Creates office locations from CSV files.
 *
 * Usage:
 *   npm run script:offices -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files:
 *   - offices.csv
 *
 * Note: It's recommended to run this script before create-users, as employees
 *       need to be assigned to office locations.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  parseArgs,
  initializeContext,
  handleError,
  logSuccess,
  logInfo
} from './base-script';

async function main() {
  try {
    // Parse command line arguments
    const config = parseArgs();

    // Initialize context (login, fetch org ID, create API clients)
    const context = await initializeContext(config);

    // Determine CSV directory
    const csvFiles = {
      offices: config.csvPath
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      offices: fs.existsSync(csvFiles.offices)
    };

    if (!filesExist.offices) {
      throw new Error(`Offices CSV not found: ${csvFiles.offices}`);
    }

    console.log(`  ✓ offices.csv: ${filesExist.offices ? 'Found' : 'Missing'}`);

    // Step 1: Load Location IDs (countries, cities, states)
    logInfo('\n=== Step 1: Loading Location Data ===');
    const { LocationIdsOperation } = await import('../../src/operations/hr/hr-settings/location-ids');
    const locationIdsOp = new LocationIdsOperation(context.apiClient);

    const cachedLocations = locationIdsOp.getLocationData();
    if (!cachedLocations) {
      await locationIdsOp.fetchAndCacheLocationIds();
      logSuccess('Location data cached');
    } else {
      logInfo('Using cached location data');
    }

    // Step 2: Create Offices
    logInfo('\n=== Step 2: Creating Offices ===');
    const { OfficesOperation } = await import('../../src/operations/hr/hr-settings/offices');
    const officesOp = new OfficesOperation(context.hrApiClient, locationIdsOp);

    await officesOp.createOffices(csvFiles.offices);
    logSuccess('Offices created successfully');

    logSuccess('\n🎉 Office creation completed successfully!');

    // Print summary
    const officeMappings = officesOp.getOfficeMappings();
    console.log(`\nTotal offices created: ${officeMappings?.length || 0}`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
