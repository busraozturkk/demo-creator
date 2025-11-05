import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface ProjectMapping {
  short_title: string;
  title: string;
  id: number;
  work_plan_id?: number;
  partnership_id?: number;
  started_at?: string;
  finished_at?: string;
}

export interface MilestoneMapping {
  project_short_title: string;
  project_title?: string;  // Full project title for PCT tree queries
  milestone_title: string;
  task_id: number;
  work_plan_id: number;
  started_at?: string;
  finished_at?: string;
}

interface MilestoneData {
  project_short_title: string;
  milestone_title: string;
}

export class MilestonesOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async createMilestones(csvPath: string, projectMappings: ProjectMapping[]): Promise<MilestoneMapping[]> {
    console.log(`Loading milestones from: ${csvPath}`);
    const milestonesData = this.loadMilestones(csvPath);
    console.log(`Loaded ${milestonesData.length} milestones\n`);

    const allMappings: MilestoneMapping[] = [];

    for (const project of projectMappings) {
      if (!project.work_plan_id) {
        console.log(`Warning: Skipping ${project.short_title}: No work-plan ID\n`);
        continue;
      }

      console.log(`[Project: ${project.short_title}]`);

      // Get milestones for this project
      const milestones = milestonesData
        .filter(m => m.project_short_title === project.short_title)
        .map(m => m.milestone_title);

      if (milestones.length === 0) {
        console.log(`  Warning: No milestones found in CSV\n`);
        continue;
      }

      console.log(`  Creating ${milestones.length} milestones`);

      for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i];
        try {
          // Create milestone (task with level 0)
          const createResponse = await this.apiClient.executeRequest('POST', '/pct/api/tasks', {
            work_plan_id: project.work_plan_id,
            work_plan_position: i + 1,
            disableInvalidate: false,
          });

          const taskId = createResponse.data.id;

          // Update milestone with title
          await this.apiClient.executeRequest('PUT', `/pct/api/tasks/${taskId}`, {
            id: taskId,
            title: milestone,
          });

          console.log(`  Created: ${milestone}`);

          allMappings.push({
            project_short_title: project.short_title,
            project_title: project.title,  // Add full title for PCT tree queries
            milestone_title: milestone,
            task_id: taskId,
            work_plan_id: project.work_plan_id,
          });
        } catch (error) {
          console.error(`  Error: Failed to create milestone: ${error}`);
        }
      }

      console.log('');
    }

    console.log(`Completed! Created ${allMappings.length} milestones total.`);

    // Fetch period information for all milestones
    console.log('\nFetching period information for milestones...');
    await this.fetchMilestonePeriods(allMappings);

    // Save to cache
    this.saveMilestoneMappings(allMappings);

    return allMappings;
  }

  /**
   * Fetch period (started_at, finished_at) for all milestones
   */
  private async fetchMilestonePeriods(mappings: MilestoneMapping[]): Promise<void> {
    for (const mapping of mappings) {
      try {
        const response: any = await this.apiClient.executeRequest(
          'GET',
          `/pct/api/tasks/${mapping.task_id}`
        );

        const task = response.data || response;
        if (task.started_at && task.finished_at) {
          mapping.started_at = task.started_at;
          mapping.finished_at = task.finished_at;
          console.log(`  ${mapping.milestone_title}: ${task.started_at} - ${task.finished_at}`);
        } else {
          console.log(`  Warning: ${mapping.milestone_title} has no period information`);
        }
      } catch (error: any) {
        console.error(`  Error fetching period for ${mapping.milestone_title}: ${error.message}`);
      }
    }
  }

  /**
   * Enable R&D assignment for milestones
   * This allows milestones to be used for R&D tracking
   */
  async enableRAndDForMilestones(
    milestoneMappings: MilestoneMapping[],
    projectMappings: ProjectMapping[],
    organizationId: number
  ): Promise<void> {
    console.log('\n=== Enabling R&D Assignment for Milestones ===\n');
    console.log(`Total milestones to process: ${milestoneMappings.length}`);
    console.log(`Total projects available: ${projectMappings.length}`);
    console.log(`Using organization ID: ${organizationId}`);

    let enabled = 0;
    let errors = 0;

    for (const milestone of milestoneMappings) {
      try {
        console.log(`\n  Processing milestone: ${milestone.milestone_title} (Task ID: ${milestone.task_id})`);

        // Find the project for this milestone
        const project = projectMappings.find(p => p.short_title === milestone.project_short_title);
        if (!project) {
          console.log(`  ✗ Project not found for milestone: ${milestone.milestone_title}`);
          console.log(`    Looking for project: ${milestone.project_short_title}`);
          console.log(`    Available projects: ${projectMappings.map(p => p.short_title).join(', ')}`);
          errors++;
          continue;
        }

        console.log(`  Found project: ${project.short_title} (ID: ${project.id})`);
        console.log(`  Sending request: PUT /pct/api/tasks/${milestone.task_id}`);
        console.log(`  Payload: { id: ${milestone.task_id}, partners: [${organizationId}] }`);

        // Enable R&D assignment by setting partners (use organizationId)
        const response = await this.apiClient.executeRequest(
          'PUT',
          `/pct/api/tasks/${milestone.task_id}`,
          {
            id: milestone.task_id,
            partners: [organizationId]
          }
        );

        console.log(`  Response received:`, JSON.stringify(response).substring(0, 200));
        console.log(`  ✓ Enabled R&D for: ${milestone.milestone_title} (Organization ID: ${organizationId})`);
        enabled++;
      } catch (error: any) {
        console.log(`  ✗ Failed to enable R&D for ${milestone.milestone_title}: ${error.message}`);
        console.log(`  Error details:`, error);
        errors++;
      }
    }

    console.log(`\nR&D Assignment Summary:`);
    console.log(`  - Milestones enabled: ${enabled}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  /**
   * Get the first day of the month for a given date
   */
  private getFirstDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  /**
   * Get the last day of the month for a given date
   */
  private getLastDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  /**
   * Set periods for milestones using project dates
   * Distributes project timeline across milestones evenly
   * Start dates are set to the first day of the month
   * End dates are set to the last day of the month
   */
  async setMilestonePeriods(
    milestoneMappings: MilestoneMapping[],
    projectMappings: ProjectMapping[]
  ): Promise<void> {
    console.log('\n=== Setting Periods for Milestones ===\n');

    let created = 0;
    let errors = 0;

    // Group milestones by project
    const milestonesByProject = new Map<string, MilestoneMapping[]>();
    for (const milestone of milestoneMappings) {
      const existing = milestonesByProject.get(milestone.project_short_title) || [];
      existing.push(milestone);
      milestonesByProject.set(milestone.project_short_title, existing);
    }

    // Process each project's milestones
    for (const [projectShortTitle, projectMilestones] of milestonesByProject) {
      const project = projectMappings.find(p => p.short_title === projectShortTitle);
      if (!project || !project.started_at || !project.finished_at) {
        console.log(`  ✗ Project dates not found for: ${projectShortTitle}`);
        errors += projectMilestones.length;
        continue;
      }

      // Calculate period duration for each milestone
      const projectStart = new Date(project.started_at);
      const projectEnd = new Date(project.finished_at);
      const totalDuration = projectEnd.getTime() - projectStart.getTime();
      const milestoneDuration = totalDuration / projectMilestones.length;

      console.log(`  Project: ${projectShortTitle} (${projectMilestones.length} milestones)`);
      console.log(`  Total period: ${project.started_at} - ${project.finished_at}`);

      // Assign periods to each milestone
      for (let i = 0; i < projectMilestones.length; i++) {
        const milestone = projectMilestones[i];
        try {
          // Calculate start and end dates for this milestone
          const milestoneStart = new Date(projectStart.getTime() + (i * milestoneDuration));
          const milestoneEnd = new Date(projectStart.getTime() + ((i + 1) * milestoneDuration));

          // Adjust to first day of month for start, last day of month for end
          const adjustedStart = this.getFirstDayOfMonth(milestoneStart);
          const adjustedEnd = this.getLastDayOfMonth(milestoneEnd);

          // Format dates as YYYY-MM-DD
          const startedAt = adjustedStart.toISOString().split('T')[0];
          const finishedAt = adjustedEnd.toISOString().split('T')[0];

          // Create task-interval
          const response: any = await this.apiClient.executeRequest(
            'POST',
            '/pct/api/task-intervals',
            {
              task_id: milestone.task_id,
              started_at: startedAt,
              finished_at: finishedAt
            }
          );

          const intervalId = response.data?.id || response.id;

          // Update the mapping with period info
          milestone.started_at = startedAt;
          milestone.finished_at = finishedAt;

          console.log(`    ✓ ${milestone.milestone_title}: ${startedAt} - ${finishedAt} (ID: ${intervalId})`);
          created++;
        } catch (error: any) {
          console.log(`    ✗ Failed to set period for ${milestone.milestone_title}: ${error.message}`);
          errors++;
        }
      }

      console.log('');
    }

    console.log(`Period Setting Summary:`);
    console.log(`  - Periods created: ${created}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  /**
   * Assign employees to milestones with PM allocations
   * Distributes employees across milestones for R&D tracking
   * Owner user is assigned to EVERY milestone
   */
  async assignEmployeesToMilestones(
    milestoneMappings: MilestoneMapping[],
    organizationId: number,
    ownerUserId?: number
  ): Promise<void> {
    console.log('\n=== Assigning Employees to Milestones ===\n');

    // Load employee mappings from cache
    const employeeMappingsPath = './data/cache/employee-mappings.json';
    if (!fs.existsSync(employeeMappingsPath)) {
      console.log('  ✗ Employee mappings not found. Skipping employee assignments.\n');
      return;
    }

    const employeeMappings = JSON.parse(fs.readFileSync(employeeMappingsPath, 'utf-8'));

    // Separate owner and project employees
    const ownerEmployee = ownerUserId
      ? employeeMappings.find((emp: any) => emp.user_id === ownerUserId)
      : employeeMappings.find((emp: any) => emp.participate_in_projects === false);

    // Filter employees who participate in projects (exclude owner)
    const projectEmployees = employeeMappings.filter((emp: any) =>
      emp.participate_in_projects !== false && emp.user_id && emp.user_id !== ownerEmployee?.user_id
    );

    if (projectEmployees.length === 0 && !ownerEmployee) {
      console.log('  ✗ No employees found. Skipping assignments.\n');
      return;
    }

    console.log(`Total milestones: ${milestoneMappings.length}`);
    console.log(`Owner employee: ${ownerEmployee ? `${ownerEmployee.first_name} ${ownerEmployee.last_name} (ID: ${ownerEmployee.user_id})` : 'Not found'}`);
    console.log(`Available project employees: ${projectEmployees.length}`);

    let assigned = 0;
    let errors = 0;

    // Prepare custom headers with partner-id
    const customHeaders = { 'partner-id': organizationId.toString() };

    // Assign employees to milestones (distribute evenly)
    for (let i = 0; i < milestoneMappings.length; i++) {
      const milestone = milestoneMappings[i];

      // Get year from milestone period
      const year = milestone.started_at ? new Date(milestone.started_at).getFullYear() : 2024;

      console.log(`\n  Milestone: ${milestone.milestone_title} (Task ID: ${milestone.task_id})`);

      // ALWAYS assign owner to every milestone first
      if (ownerEmployee?.user_id) {
        const ownerPmAmount = 2; // Owner gets 2 PM per milestone
        try {
          await this.apiClient.executeRequest(
            'POST',
            '/pct/api/user-task-year-pms',
            {
              unit: 'pm',
              year: year,
              amount: ownerPmAmount,
              task_id: milestone.task_id,
              user_id: ownerEmployee.user_id,
              partner_id: organizationId
            },
            customHeaders
          );

          console.log(`    ✓ [OWNER] ${ownerEmployee.first_name} ${ownerEmployee.last_name}: ${ownerPmAmount} PM (${year})`);
          assigned++;
        } catch (error: any) {
          console.log(`    ✗ Failed to assign owner ${ownerEmployee.first_name} ${ownerEmployee.last_name}: ${error.message}`);
          errors++;
        }
      }

      // Then assign 2-3 project employees per milestone (cycling through available employees)
      if (projectEmployees.length > 0) {
        const employeesPerMilestone = 2 + (i % 2); // Alternates between 2 and 3
        console.log(`  Assigning ${employeesPerMilestone} additional project employees...`);

        for (let j = 0; j < employeesPerMilestone; j++) {
          const employeeIndex = (i * 2 + j) % projectEmployees.length;
          const employee = projectEmployees[employeeIndex];

          // Assign 2 PMs per employee
          const pmAmount = 2;

          try {
            await this.apiClient.executeRequest(
              'POST',
              '/pct/api/user-task-year-pms',
              {
                unit: 'pm',
                year: year,
                amount: pmAmount,
                task_id: milestone.task_id,
                user_id: employee.user_id,
                partner_id: organizationId
              },
              customHeaders
            );

            console.log(`    ✓ ${employee.first_name} ${employee.last_name}: ${pmAmount} PM (${year})`);
            assigned++;
          } catch (error: any) {
            console.log(`    ✗ Failed to assign ${employee.first_name} ${employee.last_name}: ${error.message}`);
            errors++;
          }
        }
      }
    }

    console.log(`\nEmployee Assignment Summary:`);
    console.log(`  - Assignments created: ${assigned}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  /**
   * Save milestone mappings to cache
   */
  private saveMilestoneMappings(mappings: MilestoneMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'milestone-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`\nSaved ${mappings.length} milestone mappings to: ${cacheFile}`);
  }

  private loadMilestones(csvPath: string): MilestoneData[] {
    const absolutePath = path.resolve(csvPath);
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      project_short_title: record.project_short_title,
      milestone_title: record.milestone_title,
    }));
  }
}
