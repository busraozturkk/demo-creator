#!/usr/bin/env node
/**
 * Standalone Project Creation Script
 *
 * Creates projects from CSV files in an existing account.
 *
 * Usage:
 *   npm run script:projects -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files in the same directory as the main projects CSV:
 *   - projects.csv
 *   - milestones.csv (optional)
 *   - work-packages.csv (optional)
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
      projects: config.csvPath,
      milestones: path.join(csvDir, 'milestones.csv'),
      workPackages: path.join(csvDir, 'work-packages.csv')
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      projects: fs.existsSync(csvFiles.projects),
      milestones: fs.existsSync(csvFiles.milestones),
      workPackages: fs.existsSync(csvFiles.workPackages)
    };

    if (!filesExist.projects) {
      throw new Error(`Projects CSV not found: ${csvFiles.projects}`);
    }

    console.log(`  ✓ projects.csv: ${filesExist.projects ? 'Found' : 'Missing'}`);
    console.log(`  ✓ milestones.csv: ${filesExist.milestones ? 'Found' : 'Missing (optional)'}`);
    console.log(`  ✓ work-packages.csv: ${filesExist.workPackages ? 'Found' : 'Missing (optional)'}`);

    // Step 1: Load Employee Mappings (needed for project assignments)
    logInfo('\n=== Step 1: Loading Employee Data ===');
    const { CsvLoader } = await import('../../src/utils/csv-loader');
    const { CACHE_PATHS } = await import('../../src/utils/constants');

    if (!fs.existsSync(CACHE_PATHS.EMPLOYEE_MAPPINGS)) {
      logWarning('Employee mappings not found in cache. Projects may not be assigned to employees.');
      logWarning('Please run the create-users script first if you want to assign employees to projects.');
    } else {
      logInfo('Employee mappings loaded from cache');
    }

    // Step 2: Create Projects
    logInfo('\n=== Step 2: Creating Projects ===');
    const { ProjectsOperation } = await import('../../src/operations/project-management/projects');
    const projectsOp = new ProjectsOperation(context.apiClient);

    await projectsOp.createProjects(csvFiles.projects);
    logSuccess('Projects created successfully');

    // Step 3: Move Projects to Workflow Status
    logInfo('\n=== Step 3: Moving Projects to Workflow Status ===');
    const { ProjectStatusOperation } = await import('../../src/operations/project-management/project-status');
    const projectStatusOp = new ProjectStatusOperation(context.apiClient, projectsOp);

    await projectStatusOp.moveProjectsToStatus();
    logSuccess('Projects moved to workflow status successfully');

    // Step 4: Create Milestones (if milestones.csv exists)
    let milestonesOp;
    if (filesExist.milestones) {
      logInfo('\n=== Step 4: Creating Milestones ===');
      const { MilestonesOperation } = await import('../../src/operations/project-management/milestones');
      milestonesOp = new MilestonesOperation(context.apiClient, projectsOp);
      await milestonesOp.createMilestones(csvFiles.milestones);
      logSuccess('Milestones created successfully');
    } else {
      logWarning('Skipping milestones (milestones.csv not found)');
    }

    // Step 5: Create Work Packages (if work-packages.csv exists)
    if (filesExist.workPackages && milestonesOp) {
      logInfo('\n=== Step 5: Creating Work Packages ===');
      const { WorkPackagesOperation } = await import('../../src/operations/project-management/work-packages');
      const workPackagesOp = new WorkPackagesOperation(context.apiClient, projectsOp, milestonesOp);
      await workPackagesOp.createWorkPackages(csvFiles.workPackages);
      logSuccess('Work packages created successfully');
    } else if (filesExist.workPackages && !milestonesOp) {
      logWarning('Skipping work packages (milestones not created)');
    } else {
      logWarning('Skipping work packages (work-packages.csv not found)');
    }

    logSuccess('\n🎉 Project creation completed successfully!');

    // Print summary
    const projectMappings = projectsOp.getProjectMappings();
    console.log(`\nTotal projects created: ${projectMappings?.length || 0}`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
