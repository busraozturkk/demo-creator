import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { MilestoneMapping } from './milestones';

interface WorkPackageData {
  project_short_title: string;
  milestone_title: string;
  work_package_title: string;
}

interface WorkPackageInterval {
  task_id: number;
  task_interval_id: number;
  project_short_title: string;
  milestone_title: string;
  work_package_title: string;
  started_at: string;
  finished_at: string;
}

export class WorkPackagesOperation {
  private apiClient: ApiClient;
  private intervals: WorkPackageInterval[] = [];

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRandomDurationMonths(): number {
    // Random duration between 2-4 months
    return Math.floor(Math.random() * 3) + 2; // 2, 3, or 4 months
  }

  private addMonths(dateStr: string, months: number): string {
    const date = new Date(dateStr);
    date.setMonth(date.getMonth() + months);
    return date.toISOString().split('T')[0];
  }

  private ensureWithinProjectBounds(startDate: string, endDate: string, projectEndDate: string): { start: string; end: string } {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const projEnd = new Date(projectEndDate);

    // If start is already at or past project end, we can't create a valid interval
    if (start >= projEnd) {
      // Return project end minus 1 month to project end
      const adjustedStart = new Date(projEnd);
      adjustedStart.setMonth(adjustedStart.getMonth() - 1);
      return {
        start: adjustedStart.toISOString().split('T')[0],
        end: projectEndDate
      };
    }

    if (end > projEnd) {
      // If end date exceeds project end, cap it
      return {
        start: startDate,
        end: projectEndDate
      };
    }

    return {
      start: startDate,
      end: endDate
    };
  }

  async createWorkPackages(
    csvPath: string,
    milestoneMappings: MilestoneMapping[],
    projectsData: Array<{ short_title: string; started_at: string; finished_at: string }>
  ): Promise<void> {
    console.log(`Loading work packages from: ${csvPath}`);
    const workPackagesData = this.loadWorkPackages(csvPath);
    console.log(`Loaded ${workPackagesData.length} work packages\n`);

    let totalCreated = 0;

    // Track milestone start dates (milestones progress chronologically)
    const milestoneCurrentDates = new Map<string, string>();

    // Group milestones by project and count work packages
    const projectMilestones = new Map<string, MilestoneMapping[]>();
    const projectWorkPackageCounts = new Map<string, number>();

    for (const milestone of milestoneMappings) {
      if (!projectMilestones.has(milestone.project_short_title)) {
        projectMilestones.set(milestone.project_short_title, []);
        projectWorkPackageCounts.set(milestone.project_short_title, 0);
      }
      projectMilestones.get(milestone.project_short_title)!.push(milestone);

      // Count work packages for this milestone
      const wpCount = workPackagesData.filter(wp =>
        wp.project_short_title === milestone.project_short_title &&
        wp.milestone_title === milestone.milestone_title
      ).length;

      projectWorkPackageCounts.set(
        milestone.project_short_title,
        projectWorkPackageCounts.get(milestone.project_short_title)! + wpCount
      );
    }

    // Calculate milestone start dates based on work package distribution
    for (const [projectTitle, milestones] of projectMilestones) {
      const project = projectsData.find(p => p.short_title === projectTitle);
      if (!project) continue;

      const projectStart = new Date(project.started_at);
      const projectEnd = new Date(project.finished_at);
      const totalProjectDays = Math.floor((projectEnd.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24));
      const totalWorkPackages = projectWorkPackageCounts.get(projectTitle) || 1;

      // Calculate average days per work package
      const daysPerWorkPackage = totalProjectDays / totalWorkPackages;

      let currentDay = 0;
      for (const milestone of milestones) {
        // Count work packages in this milestone
        const wpCount = workPackagesData.filter(wp =>
          wp.project_short_title === projectTitle &&
          wp.milestone_title === milestone.milestone_title
        ).length;

        const milestoneStart = new Date(projectStart);
        milestoneStart.setDate(milestoneStart.getDate() + Math.floor(currentDay));

        const key = `${projectTitle}::${milestone.milestone_title}`;
        milestoneCurrentDates.set(key, milestoneStart.toISOString().split('T')[0]);

        // Move forward based on work package count
        currentDay += wpCount * daysPerWorkPackage;
      }
    }

    for (const milestone of milestoneMappings) {
      console.log(`[Milestone: ${milestone.milestone_title}]`);

      // Get work packages for this milestone
      const workPackages = workPackagesData
        .filter(wp =>
          wp.project_short_title === milestone.project_short_title &&
          wp.milestone_title === milestone.milestone_title
        )
        .map(wp => wp.work_package_title);

      if (workPackages.length === 0) {
        console.log(`  Warning: No work packages found in CSV\n`);
        continue;
      }

      console.log(`  Creating ${workPackages.length} work packages with time periods`);

      // Get project end date
      const project = projectsData.find(p => p.short_title === milestone.project_short_title);
      if (!project) {
        console.error(`  Error: Project not found: ${milestone.project_short_title}\n`);
        continue;
      }

      // Get milestone start date
      const milestoneKey = `${milestone.project_short_title}::${milestone.milestone_title}`;
      const milestoneStartDate = milestoneCurrentDates.get(milestoneKey) || project.started_at;

      for (let i = 0; i < workPackages.length; i++) {
        const workPackage = workPackages[i];
        try {
          // Create work package (task with parent_id)
          const createResponse = await this.apiClient.executeRequest('POST', '/pct/api/tasks', {
            work_plan_id: milestone.work_plan_id,
            parent_id: milestone.task_id,
            work_plan_position: i + 1,
            disableInvalidate: false,
          });

          const taskId = createResponse.data.id;

          // Update work package with title
          await this.apiClient.executeRequest('PUT', `/pct/api/tasks/${taskId}`, {
            id: taskId,
            title: workPackage,
          });

          // Calculate time period - work packages start around milestone start with slight offset
          const randomDayOffset = Math.floor(Math.random() * 21); // 0-20 days offset from milestone start
          const startDate = new Date(milestoneStartDate);
          startDate.setDate(startDate.getDate() + randomDayOffset);

          // Random duration: 2-4 months
          const durationMonths = this.getRandomDurationMonths();
          const endDateStr = this.addMonths(startDate.toISOString().split('T')[0], durationMonths);

          const bounds = this.ensureWithinProjectBounds(
            startDate.toISOString().split('T')[0],
            endDateStr,
            project.finished_at
          );

          // Validate dates before sending
          if (new Date(bounds.start) >= new Date(bounds.end)) {
            console.error(`  Error: Invalid dates: start=${bounds.start}, end=${bounds.end}, skipping`);
            continue;
          }

          // Create task interval with POST
          const intervalResponse = await this.apiClient.executeRequest('POST', '/pct/api/task-intervals', {
            task_id: taskId,
            started_at: bounds.start,
            finished_at: bounds.end,
          });

          const intervalId = intervalResponse.data.created.id;

          // Add delay to prevent race conditions
          await this.delay(300);

          // Store interval info
          this.intervals.push({
            task_id: taskId,
            task_interval_id: intervalId,
            project_short_title: milestone.project_short_title,
            milestone_title: milestone.milestone_title,
            work_package_title: workPackage,
            started_at: bounds.start,
            finished_at: bounds.end,
          });

          const actualDurationDays = Math.floor((new Date(bounds.end).getTime() - new Date(bounds.start).getTime()) / (1000 * 60 * 60 * 24));
          const actualDurationMonths = (actualDurationDays / 30).toFixed(1);
          console.log(`  ${workPackage} (${bounds.start} - ${bounds.end}, ~${actualDurationMonths} months)`);
          totalCreated++;
        } catch (error) {
          console.error(`  Error: Failed to create work package: ${error}`);
        }
      }

      console.log('');
    }

    console.log(`Completed! Created ${totalCreated} work packages total.`);

    // Save intervals to cache
    this.saveIntervals();
  }

  private loadWorkPackages(csvPath: string): WorkPackageData[] {
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
      work_package_title: record.work_package_title,
    }));
  }

  private saveIntervals(): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'work-package-intervals.json');
    fs.writeFileSync(cacheFile, JSON.stringify(this.intervals, null, 2));
    console.log(`\nSaved ${this.intervals.length} work package intervals to: ${cacheFile}`);
  }
}
