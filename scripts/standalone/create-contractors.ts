#!/usr/bin/env node
/**
 * Standalone Contractor Creation Script
 *
 * Creates contractors (external partners) from CSV files.
 *
 * Usage:
 *   npm run script:contractors -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files:
 *   - contractors.csv
 *
 * Optional: If you want to assign contractors to projects, run create-projects first.
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
    const csvFiles = {
      contractors: config.csvPath
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      contractors: fs.existsSync(csvFiles.contractors)
    };

    if (!filesExist.contractors) {
      throw new Error(`Contractors CSV not found: ${csvFiles.contractors}`);
    }

    console.log(`  ✓ contractors.csv: ${filesExist.contractors ? 'Found' : 'Missing'}`);

    // Step 1: Check for Project Mappings (optional, for assignments)
    logInfo('\n=== Step 1: Checking Project Data ===');
    const { CACHE_PATHS } = await import('../../src/utils/constants');

    let projectMappingsData = null;
    if (fs.existsSync(CACHE_PATHS.PROJECT_MAPPINGS)) {
      logInfo('Project mappings found - contractors can be assigned to projects');
      projectMappingsData = JSON.parse(fs.readFileSync(CACHE_PATHS.PROJECT_MAPPINGS, 'utf-8'));
    } else {
      logWarning('Project mappings not found - contractors will be created but not assigned');
      logWarning('Run create-projects script first if you want to assign contractors to projects');
    }

    // Step 2: Create Contractors
    logInfo('\n=== Step 2: Creating Contractors ===');
    const { ContractorsOperation } = await import('../../src/operations/ims/contractors');
    const contractorsOp = new ContractorsOperation(context.imsCustomersApiClient);

    await contractorsOp.createContractors(csvFiles.contractors);
    logSuccess('Contractors created successfully');

    // Step 3: Assign Contractors to Projects (if projects exist)
    if (projectMappingsData && projectMappingsData.length > 0) {
      logInfo('\n=== Step 3: Assigning Contractors to Projects ===');

      // Create mock project operation
      const mockProjectsOp = {
        getProjectMappings: () => projectMappingsData
      };

      await contractorsOp.assignContractorsToProjects(mockProjectsOp as any);
      logSuccess('Contractors assigned to projects successfully');
    } else {
      logWarning('Skipping contractor-to-project assignments (no projects found)');
    }

    logSuccess('\n🎉 Contractor creation completed successfully!');

    // Print summary
    const contractorMappings = contractorsOp.getContractorMappings();
    console.log(`\nTotal contractors created: ${contractorMappings?.length || 0}`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
