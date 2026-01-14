#!/usr/bin/env node
/**
 * Standalone User/Employee Creation Script
 *
 * Creates employees from CSV files in an existing account.
 *
 * Usage:
 *   npm run script:users -- --email <email> --password <password> --csv <path>
 *
 * Required CSV files in the same directory as the main employees CSV:
 *   - employees.csv
 *   - employee-details.csv (optional)
 *   - employee-contracts.csv (optional)
 *   - employee-salaries.csv (optional)
 *   - offices.csv (required for office locations)
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
      employees: config.csvPath,
      employeeDetails: path.join(csvDir, 'employee-details.csv'),
      employeeContracts: path.join(csvDir, 'employee-contracts.csv'),
      employeeSalaries: path.join(csvDir, 'employee-salaries.csv'),
      offices: path.join(csvDir, 'offices.csv')
    };

    // Check which CSV files exist
    logInfo('Checking CSV files...');
    const filesExist = {
      employees: fs.existsSync(csvFiles.employees),
      employeeDetails: fs.existsSync(csvFiles.employeeDetails),
      employeeContracts: fs.existsSync(csvFiles.employeeContracts),
      employeeSalaries: fs.existsSync(csvFiles.employeeSalaries),
      offices: fs.existsSync(csvFiles.offices)
    };

    if (!filesExist.employees) {
      throw new Error(`Employees CSV not found: ${csvFiles.employees}`);
    }

    console.log(`  ✓ employees.csv: ${filesExist.employees ? 'Found' : 'Missing'}`);
    console.log(`  ✓ employee-details.csv: ${filesExist.employeeDetails ? 'Found' : 'Missing (optional)'}`);
    console.log(`  ✓ employee-contracts.csv: ${filesExist.employeeContracts ? 'Found' : 'Missing (optional)'}`);
    console.log(`  ✓ employee-salaries.csv: ${filesExist.employeeSalaries ? 'Found' : 'Missing (optional)'}`);
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

    // Step 2: Load HR Reference Data (genders, departments, occupations, etc.)
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

    // Step 3: Create Offices (if offices.csv exists)
    let officesOp;
    if (filesExist.offices) {
      logInfo('\n=== Step 3: Creating Offices ===');
      const { OfficesOperation } = await import('../../src/operations/hr/hr-settings/offices');
      officesOp = new OfficesOperation(context.hrApiClient, locationIdsOp);
      await officesOp.createOffices(csvFiles.offices);
      logSuccess('Offices created successfully');
    } else {
      logWarning('Skipping offices creation (offices.csv not found)');
      // Create a dummy OfficesOperation with empty mappings
      const { OfficesOperation } = await import('../../src/operations/hr/hr-settings/offices');
      officesOp = new OfficesOperation(context.hrApiClient, locationIdsOp);
    }

    // Step 4: Create Employees
    logInfo('\n=== Step 4: Creating Employees ===');
    const { EmployeesOperation } = await import('../../src/operations/hr/employees/employees');
    const employeesOp = new EmployeesOperation(
      context.hrApiClient,
      hrReferenceDataOp,
      officesOp,
      context.apiClient
    );

    await employeesOp.createEmployees(csvFiles.employees);
    logSuccess('Employees created successfully');

    // Step 5: Update Employee Details (if employee-details.csv exists)
    if (filesExist.employeeDetails) {
      logInfo('\n=== Step 5: Updating Employee Details ===');
      await employeesOp.updateEmployeeDetails(csvFiles.employeeDetails);
      logSuccess('Employee details updated successfully');
    } else {
      logWarning('Skipping employee details (employee-details.csv not found)');
    }

    // Step 6: Create Employee Contracts (if employee-contracts.csv exists)
    if (filesExist.employeeContracts) {
      logInfo('\n=== Step 6: Creating Employee Contracts ===');
      const { EmployeeContractOperation } = await import('../../src/operations/hr/employees/employee-contracts');
      const contractsOp = new EmployeeContractOperation(
        context.hrApiClient,
        context.taskManagementApiClient,
        employeesOp
      );
      await contractsOp.createContracts(csvFiles.employeeContracts);
      logSuccess('Employee contracts created successfully');
    } else {
      logWarning('Skipping employee contracts (employee-contracts.csv not found)');
    }

    // Step 7: Create Employee Salaries (if employee-salaries.csv exists)
    if (filesExist.employeeSalaries) {
      logInfo('\n=== Step 7: Creating Employee Salaries ===');
      const { EmployeeSalaryPrefillOperation } = await import('../../src/operations/hr/employees/employee-salary-prefill');
      const salariesOp = new EmployeeSalaryPrefillOperation(context.hrApiClient, employeesOp);
      await salariesOp.createSalaries(csvFiles.employeeSalaries);
      logSuccess('Employee salaries created successfully');
    } else {
      logWarning('Skipping employee salaries (employee-salaries.csv not found)');
    }

    // Step 8: Create Days Off allocations
    logInfo('\n=== Step 8: Creating Days Off Allocations ===');
    const { EmployeeDaysOffOperation } = await import('../../src/operations/hr/employees/employee-days-off');
    const daysOffOp = new EmployeeDaysOffOperation(context.hrApiClient, employeesOp);

    // Create default days off (24 vacation days per year as per demo creator)
    await daysOffOp.createDaysOff();
    logSuccess('Days off allocations created successfully');

    logSuccess('\n🎉 User/Employee creation completed successfully!');

    // Print summary
    const employeeMappings = employeesOp.getEmployeeMappings();
    console.log(`\nTotal employees created: ${employeeMappings?.length || 0}`);

  } catch (error) {
    handleError(error);
  }
}

// Run the script
main();
