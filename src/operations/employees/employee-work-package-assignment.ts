import { ApiClient } from '../../api-client';
import { BaseOperation } from '../utilities/base-operation';
import * as fs from 'fs';
import * as path from 'path';

interface WorkPackageEmployeeAssignment {
  work_package_title: string;
  task_id: number;
  assigned_employees: Array<{
    user_id: number;
    employee_name: string;
    pm: number;
  }>;
}

interface TaskYearPmAssignment {
  id: number;
  task_id: number;
  year: number;
  amount: number;
  unit: 'pm';
  project_short_title: string;
  work_package_title: string;
}

interface UserPartnershipPm {
  user_id: number;
  partnership_id: number;
  year: number;
  amount: number;
  unit: string;
  employee_name?: string;
}

interface EmployeeMapping {
  id: number;
  user_id?: number;
  first_name: string;
  last_name: string;
  [key: string]: any;
}

interface EmployeePmBudget {
  user_id: number;
  employee_name: string;
  partnership_id: number;
  year: number;
  totalPm: number;
  remainingPm: number;
}

interface WorkPackagePmNeed {
  taskYearPmId: number;
  task_id: number;
  work_package_title: string;
  year: number;
  totalPm: number;
  remainingPm: number;
  assignedEmployees: Array<{
    user_id: number;
    employee_name: string;
    pm: number;
  }>;
}

export class EmployeeWorkPackageAssignmentOperation extends BaseOperation {
  private apiClient: ApiClient;
  private taskYearPmAssignments: TaskYearPmAssignment[] = [];
  private userPartnershipPms: UserPartnershipPm[] = [];
  private employeeMappings: EmployeeMapping[] = [];
  private wpEmployeeAssignments: WorkPackageEmployeeAssignment[] = [];

  constructor(apiClient: ApiClient) {
    super();
    this.apiClient = apiClient;
  }

  /**
   * Assign employees to work packages with PM amounts
   *
   * Strategy:
   * 1. Load task-year-pm assignments (work packages needing PM)
   * 2. Load user-partnership-pms (employees with PM budgets per project-year)
   * 3. For each project-year combination:
   *    - Get all work packages needing PM
   *    - Get all employees with PM budget
   *    - Randomly assign employees to work packages until all PM needs are met
   */
  async assignEmployeesToWorkPackages(
    projectMappings: Array<{id: number; short_title: string}>,
    organizationId?: number
  ): Promise<void> {
    console.log('Loading data for employee-work package assignment\n');

    // Load employee mappings first (needed for loadUserPartnershipPms)
    this.loadEmployeeMappings();
    console.log(`Loaded ${this.employeeMappings.length} employee mappings`);

    // Load task-year-pm assignments
    this.loadTaskYearPmAssignments();
    if (this.taskYearPmAssignments.length === 0) {
      console.log('No task-year-pm assignments found. Skipping.\n');
      return;
    }
    console.log(`Loaded ${this.taskYearPmAssignments.length} task-year-pm assignments`);

    // Load user-partnership-pms (needs employee mappings for enrichment)
    await this.loadUserPartnershipPms(organizationId);
    if (this.userPartnershipPms.length === 0) {
      console.log('No user-partnership-pms found. Skipping.\n');
      return;
    }
    console.log(`Loaded ${this.userPartnershipPms.length} user-partnership-pm records\n`);

    let totalAssignments = 0;
    let errors = 0;

    // Group by project-year
    const projectYears = new Map<string, {
      project_id: number;
      partnership_id: number;
      project_short_title: string;
      year: number;
    }>();

    for (const assignment of this.taskYearPmAssignments) {
      const project = projectMappings.find(p => p.short_title === assignment.project_short_title);
      if (!project) continue;

      const key = `${project.id}_${assignment.year}`;
      if (!projectYears.has(key)) {
        projectYears.set(key, {
          project_id: project.id,
          partnership_id: (project as any).partnership_id,
          project_short_title: assignment.project_short_title,
          year: assignment.year
        });
      }
    }

    console.log(`Processing ${projectYears.size} project-year combinations\n`);

    // Process each project-year combination
    for (const [key, projectYear] of projectYears) {
      console.log(`[Project: ${projectYear.project_short_title}, Year: ${projectYear.year}]`);

      // Get work packages needing PM for this project-year
      const workPackageNeeds: WorkPackagePmNeed[] = this.taskYearPmAssignments
        .filter(a =>
          a.project_short_title === projectYear.project_short_title &&
          a.year === projectYear.year
        )
        .map(a => ({
          taskYearPmId: a.id,
          task_id: a.task_id,
          work_package_title: a.work_package_title,
          year: a.year,
          totalPm: a.amount,
          remainingPm: a.amount,
          assignedEmployees: []
        }));

      // Get employees with PM budget for this project-year
      const employeeBudgets: EmployeePmBudget[] = this.userPartnershipPms
        .filter(pm => pm.partnership_id === projectYear.partnership_id && pm.year === projectYear.year)
        .map(pm => {
          const pmAmount = pm.unit === 'hour' ? pm.amount / 173.333333 : pm.amount;
          return {
            user_id: pm.user_id,
            employee_name: pm.employee_name || `User ${pm.user_id}`,
            partnership_id: pm.partnership_id,
            year: pm.year,
            totalPm: pmAmount,
            remainingPm: pmAmount
          };
        });

      if (workPackageNeeds.length === 0) {
        console.log('  No work packages found\n');
        continue;
      }

      if (employeeBudgets.length === 0) {
        console.log('  No employees with PM budget found\n');
        continue;
      }

      console.log(`  Work packages: ${workPackageNeeds.length}, Employees: ${employeeBudgets.length}`);
      console.log(`  Total WP PM needed: ${workPackageNeeds.reduce((sum, wp) => sum + wp.totalPm, 0).toFixed(2)}`);
      console.log(`  Total Employee PM available: ${employeeBudgets.reduce((sum, e) => sum + e.totalPm, 0).toFixed(2)}\n`);

      // Random assignment algorithm
      let iterations = 0;
      const maxIterations = 1000;

      while (iterations < maxIterations) {
        iterations++;

        // Find work package with remaining PM need
        const wpNeedingPm = workPackageNeeds.find(wp => wp.remainingPm > 0.01);
        if (!wpNeedingPm) break; // All work packages filled

        // Find employee with remaining PM budget
        const employeesWithBudget = employeeBudgets.filter(e => e.remainingPm > 0.01);
        if (employeesWithBudget.length === 0) {
          console.log(`  Warning: Work packages still need PM but no employee budget left`);
          break;
        }

        // Randomly select an employee
        const randomEmployee = employeesWithBudget[Math.floor(Math.random() * employeesWithBudget.length)];

        // Determine how much PM to assign (min of employee budget and WP need)
        // Add some randomness (50%-100% of available amount)
        const maxAssignable = Math.min(randomEmployee.remainingPm, wpNeedingPm.remainingPm);
        const randomFactor = 0.5 + Math.random() * 0.5; // 50-100%
        const assignedPm = Math.min(maxAssignable * randomFactor, maxAssignable);

        // Update budgets
        randomEmployee.remainingPm -= assignedPm;
        wpNeedingPm.remainingPm -= assignedPm;
        wpNeedingPm.assignedEmployees.push({
          user_id: randomEmployee.user_id,
          employee_name: randomEmployee.employee_name,
          pm: assignedPm
        });
      }

      // Now create the actual assignments
      const customHeaders = organizationId ? { 'partner-id': organizationId.toString() } : undefined;

      for (const wp of workPackageNeeds) {
        if (wp.assignedEmployees.length === 0) continue;

        console.log(`  ${wp.work_package_title} (${wp.totalPm.toFixed(2)} PM):`);

        // First, enable R&D employee assignment for this work package task
        try {
          if (organizationId) {
            const payload = {
              id: wp.task_id,
              partners: [organizationId]
            };
            console.log(`    Enabling R&D for task ${wp.task_id} with payload:`, JSON.stringify(payload));

            await this.apiClient.executeRequest(
              'PUT',
              `/pct/api/tasks/${wp.task_id}`,
              payload,
              customHeaders
            );
            console.log(`    ✓ Enabled R&D employee assignment for work package`);
          }
        } catch (error: any) {
          console.error(`    ✗ Failed to enable R&D assignment: ${error.message}`);
          if (error.statusCode) {
            console.error(`       Status: ${error.statusCode}`);
          }
          if (error.responseBody) {
            try {
              const errorData = JSON.parse(error.responseBody);
              console.error(`       Response: ${JSON.stringify(errorData)}`);
            } catch {
              console.error(`       Response: ${error.responseBody.substring(0, 200)}`);
            }
          }
        }

        for (const assignment of wp.assignedEmployees) {
          try {
            // Attach employee to work package task
            await this.apiClient.executeRequest(
              'POST',
              `/pct/api/tasks/${wp.task_id}/users/${assignment.user_id}/attach`,
              {
                taskId: wp.task_id,
                userId: assignment.user_id,
                attach: true
              },
              customHeaders
            );

            // Assign PM to employee for this work package
            await this.apiClient.executeRequest(
              'POST',
              '/pct/api/user-task-year-pms',
              {
                unit: 'pm',
                year: wp.year,
                amount: Math.round(assignment.pm * 100) / 100,
                task_id: wp.task_id,
                user_id: assignment.user_id,
                partner_id: organizationId
              },
              customHeaders
            );

            console.log(`    - ${assignment.employee_name}: ${assignment.pm.toFixed(2)} PM`);
            totalAssignments++;
          } catch (error: any) {
            // Log detailed error for 422 responses
            if (error.statusCode === 422) {
              console.error(`    ✗ Failed to assign ${assignment.employee_name}: ${error.message}`);
              if (error.responseBody) {
                try {
                  const errorData = JSON.parse(error.responseBody);
                  console.error(`       Details: ${JSON.stringify(errorData)}`);
                } catch {
                  console.error(`       Response: ${error.responseBody.substring(0, 200)}`);
                }
              }
            } else {
              console.error(`    ✗ Failed to assign ${assignment.employee_name}: ${error.message}`);
            }
            errors++;
          }
        }

        // Save assignment for task management
        this.wpEmployeeAssignments.push({
          work_package_title: wp.work_package_title,
          task_id: wp.task_id,
          assigned_employees: wp.assignedEmployees
        });
      }

      console.log('');
    }

    // Save assignments to cache for task management
    this.saveToCache('./data/cache/wp-employee-assignments.json', this.wpEmployeeAssignments);
    console.log(`\nSaved ${this.wpEmployeeAssignments.length} work package employee assignments to cache`);

    console.log(`\nEmployee-work package assignment completed:`);
    console.log(`  - Total assignments: ${totalAssignments}`);
    console.log(`  - Errors: ${errors}`);
  }

  /**
   * Load task-year-pm assignments from cache
   */
  private loadTaskYearPmAssignments(): void {
    const cacheFile = path.join('./data/cache', 'task-year-pm-assignments.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      this.taskYearPmAssignments = JSON.parse(data);
    }
  }

  /**
   * Load user-partnership-pms from cache first, then API if not available
   */
  private async loadUserPartnershipPms(organizationId?: number): Promise<void> {
    try {
      // Try loading from cache first (faster and more reliable)
      const cacheFile = path.join('./data/cache', 'user-partnership-pms.json');
      if (fs.existsSync(cacheFile)) {
        const data = fs.readFileSync(cacheFile, 'utf-8');
        this.userPartnershipPms = JSON.parse(data);
        console.log(`Loaded ${this.userPartnershipPms.length} user-partnership-pms from cache`);
        return;
      }

      // If not in cache, fetch from API
      const customHeaders = organizationId ? { 'partner-id': organizationId.toString() } : undefined;

      const response: any = await this.apiClient.executeRequest(
        'GET',
        '/pct/api/user-partnership-pms',
        {
          'per_page': '0'
        },
        customHeaders
      );

      const pms = response.data || response || [];

      // Enrich with employee names
      for (const pm of pms) {
        const employee = this.employeeMappings.find(e => e.user_id === pm.user_id);
        if (employee) {
          pm.employee_name = `${employee.first_name} ${employee.last_name}`;
        }
      }

      this.userPartnershipPms = pms;
      console.log(`Loaded ${this.userPartnershipPms.length} user-partnership-pms from API`);
    } catch (error: any) {
      console.error(`Failed to load user-partnership-pms: ${error.message}`);
      this.userPartnershipPms = [];
    }
  }

  /**
   * Load employee mappings from cache
   */
  private loadEmployeeMappings(): void {
    const cacheFile = path.join('./data/cache', 'employee-mappings.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      this.employeeMappings = JSON.parse(data);
    }
  }
}
