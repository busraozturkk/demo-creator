import { ApiClient } from '../../api-client';
import { BaseOperation } from '../utilities/base-operation';
import * as fs from 'fs';
import * as path from 'path';

interface WorkPackageInterval {
  task_id: number;
  task_interval_id: number;
  project_short_title: string;
  milestone_title: string;
  work_package_title: string;
  started_at: string;
  finished_at: string;
}

interface UserPartnershipPm {
  user_id: number;
  partnership_id: number;
  year: number;
  amount: number;
  unit: string;
}

interface TaskYearPm {
  id?: number;
  task_id: number;
  year: number;
  amount: number;
  unit: 'pm' | 'hour';
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

export class WorkPackagePmAssignmentOperation extends BaseOperation {
  private apiClient: ApiClient;
  private workPackageIntervals: WorkPackageInterval[] = [];
  private taskYearPmAssignments: TaskYearPmAssignment[] = [];

  constructor(apiClient: ApiClient) {
    super();
    this.apiClient = apiClient;
  }

  /**
   * Assign PM to work packages based on project-year total PM
   *
   * Logic:
   * 1. Group user-partnership-pms by project-year
   * 2. Calculate total PM for each project-year
   * 3. Find all work packages for that project-year
   * 4. Distribute total PM proportionally based on work package duration overlap
   * 5. Create task-year-pm records for each work package
   */
  async assignPmToWorkPackages(
    projectMappings: Array<{id: number; partnership_id?: number; short_title: string; started_at?: string; finished_at?: string}>,
    organizationId?: number
  ): Promise<void> {
    console.log('Loading work package intervals from cache\n');
    this.loadWorkPackageIntervals();

    if (this.workPackageIntervals.length === 0) {
      console.log('No work package intervals found. Skipping PM assignment.\n');
      return;
    }

    console.log(`Loaded ${this.workPackageIntervals.length} work package intervals\n`);

    // Fetch all user-partnership-pm records
    console.log('Fetching user-partnership PM allocations\n');
    const userPartnershipPms = await this.fetchUserPartnershipPms(organizationId);

    if (!userPartnershipPms || userPartnershipPms.length === 0) {
      console.log('No user-partnership PM allocations found. Skipping.\n');
      return;
    }

    console.log(`Found ${userPartnershipPms.length} user-partnership PM allocations\n`);

    let totalAssignments = 0;
    let errors = 0;

    // Group by partnership_id and year to get TOTAL PM per project-year
    const pmByProjectYear = new Map<string, {
      partnership_id: number;
      year: number;
      totalPm: number;
    }>();

    for (const pm of userPartnershipPms) {
      const key = `${pm.partnership_id}_${pm.year}`;

      if (!pmByProjectYear.has(key)) {
        pmByProjectYear.set(key, {
          partnership_id: pm.partnership_id,
          year: pm.year,
          totalPm: 0
        });
      }

      const entry = pmByProjectYear.get(key)!;

      // Convert hours to PM if needed (1 PM = 173.333333 hours for 40h/week)
      if (pm.unit === 'hour') {
        entry.totalPm += pm.amount / 173.333333;
      } else {
        entry.totalPm += pm.amount;
      }
    }

    console.log(`Processing ${pmByProjectYear.size} unique project-year combinations\n`);

    // Process each project-year combination
    for (const [key, projectYear] of pmByProjectYear) {
      // Find project by partnership_id
      const project = projectMappings.find(p =>
        (p.partnership_id && p.partnership_id === projectYear.partnership_id) ||
        p.id === projectYear.partnership_id
      );

      if (!project) {
        console.log(`Warning: Partnership ${projectYear.partnership_id} not found in mappings, skipping`);
        continue;
      }

      console.log(`[Project: ${project.short_title}, Year: ${projectYear.year}]`);
      console.log(`  Total PM allocated to project: ${projectYear.totalPm.toFixed(2)} PM`);

      // Find work packages for this project that overlap with this year
      const workPackages = this.workPackageIntervals.filter(wp =>
        wp.project_short_title === project.short_title &&
        this.overlapsWithYear(wp.started_at, wp.finished_at, projectYear.year)
      );

      if (workPackages.length === 0) {
        console.log(`  No work packages found for this year, skipping\n`);
        continue;
      }

      console.log(`  Found ${workPackages.length} work packages overlapping with ${projectYear.year}`);

      // Calculate overlap duration for each work package in this year
      const wpOverlaps = workPackages.map(wp => ({
        ...wp,
        overlapMonths: this.calculateOverlapMonths(wp.started_at, wp.finished_at, projectYear.year)
      }));

      const totalOverlapMonths = wpOverlaps.reduce((sum, wp) => sum + wp.overlapMonths, 0);

      // Distribute PM with randomness to work packages
      console.log(`  Distributing PM to work packages:\n`);

      let remainingPm = projectYear.totalPm;
      const customHeaders = organizationId ? { 'partner-id': organizationId.toString() } : undefined;

      for (let i = 0; i < wpOverlaps.length; i++) {
        const wp = wpOverlaps[i];
        try {
          // Calculate base proportion
          const proportion = wp.overlapMonths / totalOverlapMonths;

          // Add randomness (70-130% of proportional share)
          const randomFactor = 0.7 + Math.random() * 0.6;
          let assignedPm = projectYear.totalPm * proportion * randomFactor;

          // For last work package, assign all remaining PM
          if (i === wpOverlaps.length - 1) {
            assignedPm = remainingPm;
          } else {
            // Ensure we don't exceed work package duration capacity
            const maxPmForDuration = wp.overlapMonths; // Max 1 PM per month
            assignedPm = Math.min(assignedPm, maxPmForDuration, remainingPm);
          }

          // Ensure minimum allocation
          assignedPm = Math.max(0.1, assignedPm);
          remainingPm -= assignedPm;

          // Round to 2 decimal places
          const roundedPm = Math.round(assignedPm * 100) / 100;

          // Create task-year-pm record for this work package
          const response: any = await this.apiClient.executeRequest(
            'POST',
            '/pct/api/task-year-pms',
            {
              task_id: wp.task_id,
              year: projectYear.year,
              amount: roundedPm,
              unit: 'pm'
            },
            customHeaders
          );

          const taskYearPmId = response.data?.id || response.id;

          // Store for later use
          this.taskYearPmAssignments.push({
            id: taskYearPmId,
            task_id: wp.task_id,
            year: projectYear.year,
            amount: roundedPm,
            unit: 'pm',
            project_short_title: project.short_title,
            work_package_title: wp.work_package_title
          });

          console.log(`    - ${wp.work_package_title}: ${roundedPm.toFixed(2)} PM (${wp.overlapMonths.toFixed(1)}mo, remaining: ${remainingPm.toFixed(2)} PM)`);
          totalAssignments++;
        } catch (error: any) {
          console.error(`    ✗ Failed to assign PM to ${wp.work_package_title}: ${error.message}`);
          errors++;
        }
      }

      console.log('');
    }

    console.log(`\nWork package PM assignment completed:`);
    console.log(`  - Total work package assignments: ${totalAssignments}`);
    console.log(`  - Errors: ${errors}`);

    // Save to cache for employee assignment
    this.saveTaskYearPmAssignments();
  }

  /**
   * Save task-year-pm assignments to cache
   */
  private saveTaskYearPmAssignments(): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'task-year-pm-assignments.json');
    fs.writeFileSync(cacheFile, JSON.stringify(this.taskYearPmAssignments, null, 2));
    console.log(`\nSaved ${this.taskYearPmAssignments.length} task-year-pm assignments to: ${cacheFile}`);
  }

  /**
   * Check if a date range overlaps with a given year
   */
  private overlapsWithYear(startDate: string, endDate: string, year: number): boolean {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    const start = new Date(startDate);
    const end = new Date(endDate);

    return start <= yearEnd && end >= yearStart;
  }

  /**
   * Calculate how many months a work package overlaps with a given year
   */
  private calculateOverlapMonths(startDate: string, endDate: string, year: number): number {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    const start = new Date(startDate);
    const end = new Date(endDate);

    const effectiveStart = new Date(Math.max(start.getTime(), yearStart.getTime()));
    const effectiveEnd = new Date(Math.min(end.getTime(), yearEnd.getTime()));

    if (effectiveStart >= effectiveEnd) {
      return 0;
    }

    const days = Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24));
    return days / 30.44; // Average days per month
  }

  /**
   * Fetch all user-partnership PM allocations
   */
  private async fetchUserPartnershipPms(organizationId?: number): Promise<UserPartnershipPm[]> {
    try {
      const customHeaders = organizationId ? { 'partner-id': organizationId.toString() } : undefined;

      const response: any = await this.apiClient.executeRequest(
        'GET',
        '/pct/api/user-partnership-pms',
        {
          'per_page': '0' // Get all records
        },
        customHeaders
      );

      return response.data || response || [];
    } catch (error: any) {
      console.error(`Failed to fetch user-partnership PMs: ${error.message}`);
      return [];
    }
  }

  /**
   * Load work package intervals from cache
   */
  private loadWorkPackageIntervals(): void {
    const cacheFile = path.join('./data/cache', 'work-package-intervals.json');

    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      this.workPackageIntervals = JSON.parse(data);
    }
  }
}
