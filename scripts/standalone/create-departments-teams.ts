#!/usr/bin/env node
/**
 * Standalone Department & Team Creation Script
 *
 * Creates organizational structure (departments and teams) from CSV files.
 *
 * Usage:
 *   npm run script:departments -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files in the same directory as the main departments CSV:
 *   - departments.csv
 *   - teams.csv (optional)
 *   - c-level.csv (optional, for C-level executive assignments)
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  parseArgs,
  initializeContext,
  handleError,
  logSuccess,
  logInfo,
  logWarning
} from './base-script';

async function main() {
  try {
    // Parse command line arguments
    const config = parseArgs();

    // Initialize context (login, fetch org ID, create API clients)
    const context = await initializeContext(config);

    // Determine CSV directory
    const csvDir = path.dirname(config.csvPath);
    const csvFiles = {
      departments: config.csvPath,
      teams: path.join(csvDir, 'teams.csv'),
      cLevel: path.join(csvDir, 'c-level.csv')
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      departments: fs.existsSync(csvFiles.departments),
      teams: fs.existsSync(csvFiles.teams),
      cLevel: fs.existsSync(csvFiles.cLevel)
    };

    if (!filesExist.departments) {
      throw new Error(`Departments CSV not found: ${csvFiles.departments}`);
    }

    console.log(`  ✓ departments.csv: ${filesExist.departments ? 'Found' : 'Missing'}`);
    console.log(`  ✓ teams.csv: ${filesExist.teams ? 'Found' : 'Missing (optional)'}`);
    console.log(`  ✓ c-level.csv: ${filesExist.cLevel ? 'Found' : 'Missing (optional)'}`);

    // Step 1: Load Employee Mappings (needed for leader assignments)
    logInfo('\n=== Step 1: Loading Employee Data ===');
    const { CACHE_PATHS } = await import('../../src/utils/constants');

    if (!fs.existsSync(CACHE_PATHS.EMPLOYEE_MAPPINGS)) {
      logWarning('Employee mappings not found in cache.');
      logWarning('Departments and teams require employee data for leader assignments.');
      logWarning('Please run the create-users script first.');
      throw new Error('Employee data is required for departments and teams');
    }

    logInfo('Employee mappings loaded from cache');

    // Load employee mappings for later operations
    const employeeMappingsData = JSON.parse(fs.readFileSync(CACHE_PATHS.EMPLOYEE_MAPPINGS, 'utf-8'));

    // Step 2: Load HR Reference Data
    logInfo('\n=== Step 2: Loading HR Reference Data ===');
    const { HrReferenceDataOperation } = await import('../../src/operations/hr/hr-settings/hr-reference-data');
    const hrReferenceDataOp = new HrReferenceDataOperation(context.hrApiClient);

    const cachedHrData = hrReferenceDataOp.getCachedData();
    if (!cachedHrData) {
      await hrReferenceDataOp.fetchAndCache();
      logSuccess('HR reference data cached');
    } else {
      logInfo('Using cached HR reference data');
    }

    // Step 3: Create Departments
    logInfo('\n=== Step 3: Creating Departments ===');
    const { DepartmentsOperation } = await import('../../src/operations/hr/hr-settings/departments');

    // Create a mock employees operation for department creation
    const mockEmployeesOp = {
      getEmployeeMappings: () => employeeMappingsData
    };

    const departmentsOp = new DepartmentsOperation(context.hrApiClient, mockEmployeesOp as any);
    await departmentsOp.createDepartments(csvFiles.departments);
    logSuccess('Departments created successfully');

    // Step 4: Create Teams (if teams.csv exists)
    if (filesExist.teams) {
      logInfo('\n=== Step 4: Creating Teams ===');
      const { TeamsOperation } = await import('../../src/operations/hr/hr-settings/teams');
      const teamsOp = new TeamsOperation(context.hrApiClient, mockEmployeesOp as any, departmentsOp);
      await teamsOp.createTeams(csvFiles.teams);
      logSuccess('Teams created successfully');
    } else {
      logWarning('Skipping teams (teams.csv not found)');
    }

    // Step 5: Assign C-Level Executives (if c-level.csv exists)
    if (filesExist.cLevel) {
      logInfo('\n=== Step 5: Assigning C-Level Executives ===');
      const { CLevelOperation } = await import('../../src/operations/hr/employees/c-level');
      const cLevelOp = new CLevelOperation(context.hrApiClient, mockEmployeesOp as any, departmentsOp);
      await cLevelOp.assignCLevel(csvFiles.cLevel);
      logSuccess('C-Level executives assigned successfully');
    } else {
      logWarning('Skipping C-level assignments (c-level.csv not found)');
    }

    logSuccess('\n🎉 Department and team creation completed successfully!');

    // Print summary
    const departmentMappings = departmentsOp.getDepartmentMappings();
    console.log(`\nTotal departments created: ${departmentMappings?.length || 0}`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
