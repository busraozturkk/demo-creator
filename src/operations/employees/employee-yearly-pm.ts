import { ApiClient } from '../../api-client';
import { BaseOperation } from '../utilities/base-operation';
import { EmployeeMapping } from '../../types';

interface EmployeeContract {
  weekly_hours?: number;
  annual_days_off?: number;
  working_days?: number[];
  started_at?: string;
  end_at?: string;
  [key: string]: any;
}

interface EmployeeRndMeta {
  id: number;
  first_name: string;
  last_name: string;
  user_id?: number;
  auth_user_id?: number;
  participate_in_projects?: boolean | number;
  contract?: EmployeeContract | null;
  rnd_details?: {
    rnd_ratio?: number;
    [key: string]: any;
  } | null;
  rnd_meta?: {
    id: number;
    employee_id: number;
    max_yearly_pm: number;
    [key: string]: any;
  } | null;
}

export class EmployeeYearlyPmOperation extends BaseOperation {
  private hrApiClient: ApiClient;
  private createdUserPartnershipPms: any[] = [];

  constructor(hrApiClient: ApiClient) {
    super();
    this.hrApiClient = hrApiClient;
  }

  /**
   * Calculate and update yearly max PM for all employees participating in projects
   */
  async calculateYearlyMaxPm(): Promise<void> {
    console.log('Fetching employees participating in projects\n');

    try {
      // Fetch all employees with contract, rndDetails and rndMeta
      // Try without filter first, then filter in code to avoid 500 error
      console.log('Fetching employees from API...');
      const response: any = await this.hrApiClient.executeRequest(
        'GET',
        '/api/employees',
        {
          'per_page': '0',
          'include': 'contract'
        }
      );
      console.log('Employees fetched successfully');

      let allEmployees: EmployeeRndMeta[] = response.data || response;

      if (!allEmployees || allEmployees.length === 0) {
        console.log('No employees found');
        return;
      }

      // Filter employees that participate in projects (client-side filter to avoid API error)
      const employees = allEmployees.filter((e: any) => e.participate_in_projects === true || e.participate_in_projects === 1);

      if (employees.length === 0) {
        console.log('No employees found participating in projects');
        return;
      }

      console.log(`Found ${employees.length} employees participating in projects (out of ${allEmployees.length} total)\n`);

      let updated = 0;
      let skipped = 0;
      let errors = 0;

    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      const employeeName = `${employee.first_name} ${employee.last_name}`;

      try {
        // Calculate max yearly PM (can be customized based on business logic)
        // For now, using a default value of 12 PM (1 person working full year)
        const maxYearlyPm = this.calculateMaxPm(employee);

        console.log(`[${i + 1}/${employees.length}] Processing: ${employeeName} (ID: ${employee.id})`);

        // Check if rndMeta already exists
        if (employee.rnd_meta) {
          console.log(`   Already has rndMeta (max_yearly_pm: ${employee.rnd_meta.max_yearly_pm}), skipping`);
          skipped++;
          continue;
        }

        // RnD meta data is already part of employee data, no separate endpoint needed
        console.log(`  Max yearly PM calculated: ${maxYearlyPm} (no update needed, data is in employee record)`);
        skipped++;

      } catch (error: any) {
        console.error(`  Failed: ${error.message}`);
        errors++;
      }
      }

      console.log(`\nYearly PM calculation completed:`);
      console.log(`  - Updated: ${updated}`);
      console.log(`  - Skipped: ${skipped}`);
      console.log(`  - Errors: ${errors}`);
    } catch (error: any) {
      console.error(`Yearly PM calculation failed: ${error.message}`);
      if (error.responseBody) {
        console.error('API Response:', error.responseBody.substring(0, 500));
      }
      console.error('Possible reasons:');
      console.error('  - No employees exist in the system');
      console.error('  - API does not support the include parameters');
      console.error('  - Backend RnD meta feature is not enabled');
      // Don't throw - continue with next steps
      console.log('\nContinuing with next steps...\n');
    }
  }

  /**
   * Calculate max yearly PM based on employee contract data for a specific year
   *
   * Formula:
   * Max Capacity PM = ((52 * Weekly Work Hours) - (Public Holidays * Daily Work Hours) - (Annual Off Days * Daily Work Hours))
   *                   / Default PM * (Contract Days / 365) * (R&D Ratio)
   *
   * Where:
   * - Default PM (hours per PM) = (weekly_hours × 52) / 12
   * - Contract Days = days employee is under contract within the year
   * - R&D Ratio = employee.rnd_details.rnd_ratio (0-1)
   */
  private calculateMaxPmForYear(employee: EmployeeRndMeta, year: number): number {
    const contract = employee.contract;
    const rndDetails = employee.rnd_details;

    if (!contract || !contract.weekly_hours) {
      return 10.5; // Default for 40 hours/week
    }

    const weeklyHours = contract.weekly_hours || 40;
    const annualDaysOff = contract.annual_days_off || 24;
    const publicHolidays = 8.5; // Standard public holidays
    const dailyWorkHours = 8;
    const weeksPerYear = 52;
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const daysInYear = isLeapYear ? 366 : 365;

    // Step 1: Calculate total work hours per year
    const totalHoursPerYear = weeklyHours * weeksPerYear;

    // Step 2: Deduct annual leave and public holidays
    const annualLeaveHours = annualDaysOff * dailyWorkHours;
    const publicHolidayHours = publicHolidays * dailyWorkHours;
    const netWorkableHours = totalHoursPerYear - annualLeaveHours - publicHolidayHours;

    // Step 3: Default PM (hours per PM)
    const defaultPmHours = (weeklyHours * weeksPerYear) / 12;

    // Step 4: Base Available PM
    let basePm = netWorkableHours / defaultPmHours;

    // Step 5: Calculate contract ratio for this specific year
    let contractRatio = 1.0;
    if (contract.started_at || contract.end_at) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);

      const contractStart = contract.started_at ? new Date(contract.started_at) : yearStart;
      const contractEnd = contract.end_at ? new Date(contract.end_at) : yearEnd;

      // Only count days within this specific year
      const effectiveStart = contractStart > yearStart ? contractStart : yearStart;
      const effectiveEnd = contractEnd < yearEnd ? contractEnd : yearEnd;

      if (effectiveStart <= effectiveEnd) {
        const contractDays = Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        contractRatio = contractDays / daysInYear;
      } else {
        // Employee not under contract this year
        return 0;
      }
    }

    // Step 6: Get R&D ratio (default 1.0 if not specified)
    const rdRatio = rndDetails?.rnd_ratio || 1.0;

    // Step 7: Final PM = Base PM × Contract ratio × R&D ratio
    let finalPm = basePm * contractRatio * rdRatio;

    // Round to 2 decimal places
    return Math.round(finalPm * 100) / 100;
  }

  /**
   * Calculate max yearly PM based on employee contract data (for current year)
   * This is kept for backward compatibility with calculateYearlyMaxPm()
   */
  private calculateMaxPm(employee: EmployeeRndMeta): number {
    const currentYear = new Date().getFullYear();
    const maxPm = this.calculateMaxPmForYear(employee, currentYear);

    const contract = employee.contract;
    const rndDetails = employee.rnd_details;

    // Log details for debugging
    if (contract) {
      console.log(`   Weekly hours: ${contract.weekly_hours || 40}h, Annual leave: ${contract.annual_days_off || 24} days`);
      if (rndDetails) {
        console.log(`   R&D ratio: ${((rndDetails?.rnd_ratio || 1.0) * 100).toFixed(2)}%`);
      }
      console.log(`   Final PM: ${maxPm}`);
    } else {
      console.log(`   No contract data, using default: ${maxPm} PM`);
    }

    return maxPm;
  }

  /**
   * Update max yearly PM for specific employees
   */
  async updateYearlyMaxPm(employeeMappings: EmployeeMapping[], maxPm: number = 12): Promise<void> {
    console.log(`Updating max yearly PM for ${employeeMappings.length} employees\n`);

    for (let i = 0; i < employeeMappings.length; i++) {
      const employee = employeeMappings[i];
      const employeeName = `${employee.first_name} ${employee.last_name}`;

      try {
        console.log(`[${i + 1}/${employeeMappings.length}] Updating: ${employeeName} (ID: ${employee.id})`);

        await this.hrApiClient.executeRequest(
          'POST',
          `/api/employees/${employee.id}/rnd-meta`,
          {
            max_yearly_pm: maxPm
          }
        );

        console.log(`  Set max_yearly_pm to ${maxPm}`);

      } catch (error: any) {
        console.error(`  Failed: ${error.message}`);
      }
    }

    console.log(`\nCompleted updating yearly max PM for all employees`);
  }

  /**
   * Calculate how many months an employee can work on a project in a specific year
   */
  private calculateAvailableMonths(
    projectStart: Date,
    projectEnd: Date,
    employeeContractStart: Date,
    employeeContractEnd: Date,
    year: number
  ): number {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    // Find overlap: employee working + project active + within year
    const effectiveStart = new Date(Math.max(
      projectStart.getTime(),
      employeeContractStart.getTime(),
      yearStart.getTime()
    ));

    const effectiveEnd = new Date(Math.min(
      projectEnd.getTime(),
      employeeContractEnd.getTime(),
      yearEnd.getTime()
    ));

    if (effectiveStart >= effectiveEnd) {
      return 0;
    }

    const days = Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24));
    return days / 30.44; // Average days per month
  }

  /**
   * Assign employees to projects with year-based PM allocation
   * Strategy: Each project gets 5-6 random employees
   * @param projectMappings Array of project mappings with dates
   * @param apiClient Main API client (for /pct/api endpoint)
   */
  async assignEmployeesToProjects(
    projectMappings: Array<{id: number; partnership_id?: number; started_at?: string; finished_at?: string; short_title?: string}>,
    apiClient: ApiClient,
    organizationId?: number,
    ownerUserId?: number
  ): Promise<void> {
    console.log(`\nAssigning employees to ${projectMappings.length} projects (8-12 employees per project)\n`);

    let employees: any[] = [];
    let allEmployees: EmployeeRndMeta[] = [];

    try {
      // Fetch employees with user_id
      console.log('Fetching employees from API for project assignment...');

      // Try with user include to get user_id
      let response: any;
      try {
        response = await this.hrApiClient.executeRequest(
          'GET',
          '/api/employees',
          {
            'per_page': '0',
            'include': 'contract,user'
          }
        );
      } catch (includeError) {
        // If include=user fails, try without it
        console.log('Failed with include=user, trying without...');
        response = await this.hrApiClient.executeRequest(
          'GET',
          '/api/employees',
          {
            'per_page': '0',
            'include': 'contract'
          }
        );
      }
      console.log('Employees fetched successfully');
      console.log('Response type:', typeof response);
      console.log('Response.data exists:', !!response.data);
      console.log('Response is array:', Array.isArray(response));

      allEmployees = response.data || response;

      console.log('allEmployees type:', typeof allEmployees);
      console.log('allEmployees is array:', Array.isArray(allEmployees));

      if (!allEmployees || allEmployees.length === 0) {
        console.log('No employees found (allEmployees is empty or null)');
        return;
      }

      console.log(`Total employees fetched: ${allEmployees.length}`);

      // Debug: Show first employee to see what fields are available
      if (allEmployees.length > 0) {
        const sample = allEmployees[0];
        console.log('Sample employee full object:');
        console.log(JSON.stringify(sample, null, 2).substring(0, 1000));
        console.log('\nChecking user_id variants:');
        console.log('  user_id:', sample.user_id || 'MISSING');
        console.log('  userId:', (sample as any).userId || 'MISSING');
        console.log('  auth_user_id:', (sample as any).auth_user_id || 'MISSING');
        console.log('  user?.id:', (sample as any).user?.id || 'MISSING');
        console.log('  participate_in_projects:', sample.participate_in_projects || 'MISSING');
      }

      // Filter employees that participate in projects and have auth_user_id
      // Note: API returns auth_user_id, not user_id
      employees = allEmployees.filter((e: any) =>
        (e.participate_in_projects === true || e.participate_in_projects === 1) &&
        e.auth_user_id
      );

      console.log(`Employees with participate_in_projects=true: ${allEmployees.filter((e: any) => e.participate_in_projects === true || e.participate_in_projects === 1).length}`);
      console.log(`Employees with auth_user_id: ${allEmployees.filter((e: any) => e.auth_user_id).length}`);
      console.log(`Employees with both: ${employees.length}`);

      if (employees.length === 0) {
        console.log('\nNo employees found to assign (need participate_in_projects=true and auth_user_id)');
        console.log('Please ensure employees have both fields set.');
        console.log(`Debug: Found ${allEmployees.filter((e: any) => e.participate_in_projects).length} with participate_in_projects`);
        console.log(`Debug: Found ${allEmployees.filter((e: any) => e.auth_user_id).length} with auth_user_id`);
        console.log('Sample employee:', JSON.stringify(allEmployees[0], null, 2).substring(0, 500));
        console.log();
        return;
      }
    } catch (error: any) {
      console.error(`Failed to fetch employees: ${error.message}`);
      if (error.responseBody) {
        console.error('API Response:', error.responseBody.substring(0, 500));
      }
      console.error('This might be because:');
      console.error('  - No employees have participate_in_projects=true');
      console.error('  - Employees don\'t have contracts');
      console.error('  - API endpoint returned 500 error');
      console.error('  - The include parameters (contract,rndDetails,rndMeta) are causing issues');
      console.log('\nSkipping project assignment.\n');
      return;
    }

    console.log(`Found ${employees.length} employees available for assignment (out of ${allEmployees.length} total)`);

    // Debug: Show first employee to verify auth_user_id exists
    if (employees.length > 0) {
      const firstEmp = employees[0];
      console.log(`Sample employee: ${firstEmp.first_name} ${firstEmp.last_name}, auth_user_id: ${(firstEmp as any).auth_user_id || 'MISSING'}\n`);
    }

    // Find owner employee if ownerUserId is provided
    const ownerEmployee = ownerUserId ? employees.find((e: any) => (e.auth_user_id || e.user_id) === ownerUserId) : null;
    if (ownerEmployee) {
      console.log(`Found owner employee: ${ownerEmployee.first_name} ${ownerEmployee.last_name} (User ID: ${ownerUserId})`);
      console.log(`Owner will be assigned to at least 2 projects\n`);
    }

    // Track which projects owner has been assigned to
    const ownerAssignedProjects: number[] = [];

    let totalAssignments = 0;
    let totalPmAllocations = 0;
    let errors = 0;

    // Process each PROJECT (not each employee)
    for (let projIdx = 0; projIdx < projectMappings.length; projIdx++) {
      const project = projectMappings[projIdx];
      const projectTitle = project.short_title || `Project ${project.id}`;
      // Use partnership_id if available, otherwise fall back to id
      const partnershipId = project.partnership_id || project.id;

      console.log(`\n[${projIdx + 1}/${projectMappings.length}] ${projectTitle}`);
      console.log(`  Project ID: ${project.id}, Partnership ID: ${partnershipId}`);

      if (!project.started_at || !project.finished_at) {
        console.log(`  ⚠ No dates, skipping`);
        continue;
      }

      const projectStart = new Date(project.started_at);
      const projectEnd = new Date(project.finished_at);

      // Randomly select 8-12 employees for this project
      const numEmployees = Math.floor(Math.random() * 5) + 8; // 8 to 12 employees
      const shuffledEmployees = [...employees].sort(() => Math.random() - 0.5);
      let selectedEmployees = shuffledEmployees.slice(0, Math.min(numEmployees, employees.length));

      // Ensure owner is included in first 2 projects (minimum requirement)
      if (ownerEmployee && ownerAssignedProjects.length < 2 && !selectedEmployees.includes(ownerEmployee)) {
        // Replace a random employee with owner
        const replaceIndex = Math.floor(Math.random() * selectedEmployees.length);
        selectedEmployees[replaceIndex] = ownerEmployee;
        console.log(`  ✓ Owner employee included in project (ensuring minimum 2 projects)`);
      }

      console.log(`  Assigning ${selectedEmployees.length} employees to this project:\n`);

      // First pass: Attach all employees to the project
      const attachedEmployees: Array<{
        employee: EmployeeRndMeta;
        employeeName: string;
        contract: any;
        employeeStart: Date;
        employeeEnd: Date;
      }> = [];

      for (let empIdx = 0; empIdx < selectedEmployees.length; empIdx++) {
        const employee = selectedEmployees[empIdx] as any;
        const employeeName = `${employee.first_name} ${employee.last_name}`;
        const userId = employee.auth_user_id || employee.user_id;

        if (!userId) {
          console.log(`  [${empIdx + 1}/${selectedEmployees.length}] ⚠ ${employeeName}: No auth_user_id/user_id, skipping`);
          continue;
        }

        const contract = employee.contract;
        if (!contract) {
          console.log(`  [${empIdx + 1}/${selectedEmployees.length}] ⚠ ${employeeName}: No contract, skipping`);
          continue;
        }

        try {
          // Attach user to project using partnership ID
          const requestBody = {
            user_id: userId,
            partnership_id: partnershipId
          };

          console.log(`  DEBUG: Attaching user ${userId} to partnership ${partnershipId} (project ${project.id})`);
          console.log(`  DEBUG: Full URL: ${apiClient.getAppApiUrl()}/pct/api/partnerships/${partnershipId}/users/${userId}/attach`);
          console.log(`  DEBUG: Request body:`, JSON.stringify(requestBody));
          console.log(`  DEBUG: organizationId parameter:`, organizationId);
          if (organizationId) {
            console.log(`  DEBUG: Will send partner-id header: ${organizationId}`);
          }

          // Build custom headers if organizationId is provided
          const customHeaders: Record<string, string> | undefined = organizationId
            ? { 'partner-id': organizationId.toString() }
            : undefined;

          console.log(`  DEBUG: Custom headers:`, JSON.stringify(customHeaders));

          await apiClient.executeRequest(
            'POST',
            `/pct/api/partnerships/${partnershipId}/users/${userId}/attach`,
            requestBody,
            customHeaders
          );
          totalAssignments++;

          const employeeStart = contract.started_at ? new Date(contract.started_at) : new Date('1900-01-01');
          const employeeEnd = contract.end_at ? new Date(contract.end_at) : new Date('2100-12-31');

          attachedEmployees.push({
            employee,
            employeeName,
            contract,
            employeeStart,
            employeeEnd
          });

          // Track owner assignment
          if (ownerEmployee && userId === ownerUserId && !ownerAssignedProjects.includes(project.id)) {
            ownerAssignedProjects.push(project.id);
          }

          console.log(`  [${empIdx + 1}/${selectedEmployees.length}] ✓ ${employeeName}: Attached`);
        } catch (error: any) {
          // Log detailed error info
          console.log(`  [${empIdx + 1}/${selectedEmployees.length}] ✗ ${employeeName}: ${error.message}`);
          if (error.statusCode === 422) {
            console.log(`     422 Error - Response body: ${error.responseBody || 'No response body'}`);
          }
          if (error.responseBody) {
            console.log(`     Response: ${error.responseBody.substring(0, 300)}`);
          }

          // 422 might mean user is already attached, which is ok
          if (error.statusCode === 422) {
            console.log(`     Treating as already attached, continuing...`);
            // Still add to attachedEmployees since they might already be in the project
            const employeeStart = contract.started_at ? new Date(contract.started_at) : new Date('1900-01-01');
            const employeeEnd = contract.end_at ? new Date(contract.end_at) : new Date('2100-12-31');
            attachedEmployees.push({
              employee,
              employeeName,
              contract,
              employeeStart,
              employeeEnd
            });

            // Track owner assignment even if already attached
            if (ownerEmployee && userId === ownerUserId && !ownerAssignedProjects.includes(project.id)) {
              ownerAssignedProjects.push(project.id);
            }
          } else {
            errors++;
          }
        }
      }

      // Determine which years this project spans
      const projectStartYear = projectStart.getFullYear();
      const projectEndYear = projectEnd.getFullYear();

      // Second pass: Allocate PM for each year, respecting max yearly PM
      console.log(`\n  Allocating PM for each year:\n`);

      for (let year = projectStartYear; year <= projectEndYear; year++) {
        console.log(`  Year ${year}:`);

        for (const { employee, employeeName, contract, employeeStart, employeeEnd } of attachedEmployees) {
          try {
            const empUserId = (employee as any).auth_user_id || (employee as any).user_id;
            if (!empUserId) {
              console.log(`    - ${employeeName}: No user_id, skipping`);
              continue;
            }

            // Calculate available months for this year (considering employee contract)
            const availableMonths = this.calculateAvailableMonths(
              projectStart,
              projectEnd,
              employeeStart,
              employeeEnd,
              year
            );

            if (availableMonths <= 0) {
              continue;
            }

            // Get employee's max PM for THIS SPECIFIC YEAR (considering contract dates, R&D ratio)
            const maxYearlyPm = this.calculateMaxPmForYear(employee, year);

            if (maxYearlyPm <= 0) {
              console.log(`    - ${employeeName}: No contract for ${year}, skipping`);
              continue;
            }

            // Build custom headers with partner-id if organizationId is provided
            const getCustomHeaders: Record<string, string> | undefined = organizationId
              ? { 'partner-id': organizationId.toString() }
              : undefined;

            // Fetch existing PM allocations for this employee-year to check remaining capacity
            const existingPms: any = await apiClient.executeRequest(
              'GET',
              '/pct/api/user-partnership-pms',
              {
                'filter[user_id]': empUserId.toString(),
                'filter[year]': year.toString(),
                'per_page': '0'
              },
              getCustomHeaders
            );

            const existingAllocations = existingPms.data || existingPms || [];

            // Calculate total already allocated PM for this year
            let totalAllocatedPm = 0;
            const weeklyHours = contract.weekly_hours || 40;
            const hoursPerPm = (weeklyHours * 52) / 12;

            for (const allocation of existingAllocations) {
              const pmAmount = allocation.unit === 'hour'
                ? allocation.amount / hoursPerPm
                : allocation.amount;
              totalAllocatedPm += pmAmount;
            }

            // Calculate remaining PM capacity
            const remainingPm = maxYearlyPm - totalAllocatedPm;

            if (remainingPm <= 0.01) {
              console.log(`    - ${employeeName}: Max PM reached (${totalAllocatedPm.toFixed(2)}/${maxYearlyPm} PM), skipping`);
              continue;
            }

            // Get how many projects this employee is assigned to (need to fetch all their projects)
            const allEmployeeProjects: any = await apiClient.executeRequest(
              'GET',
              '/pct/api/user-partnership-pms',
              {
                'filter[user_id]': empUserId.toString(),
                'filter[year]': year.toString(),
                'per_page': '0'
              },
              getCustomHeaders
            );

            const employeeProjectsThisYear = allEmployeeProjects.data || allEmployeeProjects || [];
            const uniqueProjects = new Set(employeeProjectsThisYear.map((p: any) => p.partnership_id));
            const totalProjectsCount = uniqueProjects.size + 1; // +1 for current project being assigned

            // Calculate PM allocation based on:
            // 1. Available months in this year (considering employee contract and project duration)
            // 2. Employee's max yearly PM
            // 3. Remaining PM after existing allocations

            // Calculate max PM this employee can work on this project in this year
            // based on the overlap between project dates and employee contract dates
            const projectPmCapacity = (availableMonths / 12) * maxYearlyPm;

            // Divide remaining capacity among projects
            // Add randomness: each project gets between 70-100% of equal share
            const equalShare = Math.min(projectPmCapacity, remainingPm / totalProjectsCount);
            const randomFactor = 0.7 + Math.random() * 0.3; // 70-100%
            let allocatedPm = Math.max(0.1, Math.min(equalShare * randomFactor, remainingPm));

            // Round allocatedPm to 2 decimal places first
            allocatedPm = Math.round(allocatedPm * 100) / 100;

            // Calculate hours and round to 2 decimal places
            const allocatedHours = Math.round(allocatedPm * hoursPerPm * 100) / 100;

            // Build custom headers with partner-id if organizationId is provided
            const pmCustomHeaders: Record<string, string> | undefined = organizationId
              ? { 'partner-id': organizationId.toString() }
              : undefined;

            // Create PM allocation for this year
            const userPmData = {
              user_id: empUserId,
              partnership_id: partnershipId,
              year: year,
              amount: allocatedHours, // Already rounded to 2 decimal places
              unit: 'hour'
            };

            await apiClient.executeRequest(
              'POST',
              '/pct/api/user-partnership-pms',
              userPmData,
              pmCustomHeaders
            );

            // Save to cache for later use
            this.createdUserPartnershipPms.push({
              ...userPmData,
              employee_name: employeeName
            });

            const newTotal = totalAllocatedPm + allocatedPm;
            console.log(`    - ${employeeName}: ${allocatedPm.toFixed(2)} PM (${allocatedHours.toFixed(2)}h) | Total: ${newTotal.toFixed(2)}/${maxYearlyPm} PM`);
            totalPmAllocations++;

          } catch (error: any) {
            console.log(`    ✗ ${employeeName}: ${error.message}`);
            errors++;
          }
        }
      }
    }

    console.log(`\nProject assignment completed:`);
    console.log(`  - Projects processed: ${projectMappings.length}`);
    console.log(`  - Total employee assignments: ${totalAssignments}`);
    console.log(`  - PM allocations created: ${totalPmAllocations}`);
    console.log(`  - Errors: ${errors}`);

    // Save user-partnership-pms to cache for employee-work-package assignment
    if (this.createdUserPartnershipPms.length > 0) {
      this.saveToCache('./data/cache/user-partnership-pms.json', this.createdUserPartnershipPms);
      console.log(`\nSaved ${this.createdUserPartnershipPms.length} user-partnership-pms to cache`);
    }
  }
}
