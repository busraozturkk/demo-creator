#!/usr/bin/env node
/**
 * Standalone Task Creation Script
 *
 * Creates tasks and task management setup from CSV files.
 *
 * Usage:
 *   npm run script:tasks -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files in the same directory as the main tasks CSV:
 *   - tasks.csv
 *
 * Prerequisites:
 *   - Projects must already exist (run create-projects script first)
 *   - Employees must already exist (run create-users script first)
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
      tasks: config.csvPath
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      tasks: fs.existsSync(csvFiles.tasks)
    };

    if (!filesExist.tasks) {
      throw new Error(`Tasks CSV not found: ${csvFiles.tasks}`);
    }

    console.log(`  ✓ tasks.csv: ${filesExist.tasks ? 'Found' : 'Missing'}`);

    // Step 1: Load Project Mappings (needed for task assignments)
    logInfo('\n=== Step 1: Loading Project Data ===');
    const { CACHE_PATHS } = await import('../../src/utils/constants');

    if (!fs.existsSync(CACHE_PATHS.PROJECT_MAPPINGS)) {
      logWarning('Project mappings not found in cache.');
      logWarning('Tasks require project data for assignments.');
      logWarning('Please run the create-projects script first.');
      throw new Error('Project data is required for tasks');
    }

    logInfo('Project mappings loaded from cache');

    // Load project mappings for later operations
    const projectMappingsData = JSON.parse(fs.readFileSync(CACHE_PATHS.PROJECT_MAPPINGS, 'utf-8'));

    // Step 2: Load Employee Mappings (needed for task assignments)
    if (!fs.existsSync(CACHE_PATHS.EMPLOYEE_MAPPINGS)) {
      logWarning('Employee mappings not found in cache.');
      logWarning('Please run the create-users script first if you want to assign tasks to employees.');
    } else {
      logInfo('Employee mappings loaded from cache');
    }

    // Step 3: Approve User Consent for Task Management API
    logInfo('\n=== Step 2: Approving User Consent for Task Management ===');
    try {
      await context.authService.approveUserConsent(context.partnerId);
      logSuccess('User consent approved');
    } catch (error: any) {
      logWarning(`User consent approval failed (may already be approved): ${error.message}`);
    }

    // Step 4: Create Task Management Setup
    logInfo('\n=== Step 3: Setting Up Task Management ===');
    const { TaskManagementOperation } = await import('../../src/operations/task-management/task-management');

    // Create mock project operation
    const mockProjectsOp = {
      getProjectMappings: () => projectMappingsData
    };

    const taskManagementOp = new TaskManagementOperation(
      context.apiClient,
      context.taskManagementApiClient,
      mockProjectsOp as any
    );

    await taskManagementOp.setupTaskManagement(csvFiles.tasks, context.language);
    logSuccess('Task management setup completed successfully');

    logSuccess('\n🎉 Task creation completed successfully!');

    // Print summary
    console.log(`\nTasks created for ${projectMappingsData.length} projects`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
