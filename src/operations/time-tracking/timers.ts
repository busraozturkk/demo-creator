import { ApiClient } from '../../api-client';
import * as fs from 'fs';
import * as path from 'path';

interface PctMilestone {
  id: number;
  title: string;
  level: number;
  position: number;
  is_done: number;
  children: any[];
}

interface PctTreeNode {
  id: number;
  title: string;
  children: PctMilestone[];
}

interface PctTreeResponse {
  data: PctTreeNode[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    total: number;
  };
}

interface TimerActivity {
  id: number;
  type: string;
}

interface CreateTimerPayload {
  started_at: string;
  finished_at: string;
  startTimer: boolean;
  activities: TimerActivity[];
  user_id: number;
  skip_legal_requirements: boolean;
  device_type: string;
  device_name: string;
  device_os: string;
  device_os_version: string;
  device_browser_name: string;
}

interface MilestoneTimerMapping {
  project_title: string;
  milestone_id: number;
  milestone_title: string;
  timer_created: boolean;
}

export class TimersOperation {
  private apiClient: ApiClient;
  private mainApiClient?: ApiClient; // For PCT API requests

  constructor(apiClient: ApiClient, mainApiClient?: ApiClient) {
    this.apiClient = apiClient;
    this.mainApiClient = mainApiClient;
  }

  /**
   * Fetches PCT tree data for a specific project
   * @param projectTitle - The title of the project to fetch milestones for
   */
  async fetchPctTree(projectTitle: string): Promise<PctMilestone[]> {
    console.log(`Fetching PCT tree for project: ${projectTitle}`);

    try {
      const response = await this.apiClient.executeRequest<PctTreeResponse>(
        'GET',
        `/api/pct-tree?title=${encodeURIComponent(projectTitle)}&limit=200&is_project_assigned=1&page=1`
      );

      if (!response.data || response.data.length === 0) {
        console.log(`No PCT tree data found for project: ${projectTitle}`);
        return [];
      }

      const projectNode = response.data[0];
      console.log(`Found project (ID: ${projectNode.id}) with ${projectNode.children.length} milestones`);

      projectNode.children.forEach((milestone, index) => {
        console.log(`  [${index + 1}] ${milestone.title} (ID: ${milestone.id})`);
      });

      return projectNode.children;
    } catch (error) {
      console.error(`Failed to fetch PCT tree: ${error}`);
      return [];
    }
  }

  /**
   * Creates a timer for a specific milestone
   * @param milestoneId - The ID of the milestone
   * @param milestoneTitle - The title of the milestone (for logging)
   * @param userId - The user ID to create the timer for
   * @param startedAt - Timer start date (YYYY-MM-DD HH:mm:ss)
   * @param finishedAt - Timer end date (YYYY-MM-DD HH:mm:ss)
   * @param categoryId - Optional timer category ID (default: 272)
   */
  async createTimer(
    milestoneId: number,
    milestoneTitle: string,
    userId: number,
    startedAt: string,
    finishedAt: string,
    categoryId: number = 272
  ): Promise<boolean> {
    console.log(`Creating timer for milestone: ${milestoneTitle} (ID: ${milestoneId})`);
    console.log(`  Period: ${startedAt} - ${finishedAt}`);

    const payload: CreateTimerPayload = {
      started_at: startedAt,
      finished_at: finishedAt,
      startTimer: false,
      activities: [
        {
          id: categoryId,
          type: 'App\\Models\\TimerCategory',
        },
        {
          id: milestoneId,
          type: 'App\\Models\\PctMilestone',
        },
      ],
      user_id: userId,
      skip_legal_requirements: true,
      device_type: 'desktop',
      device_name: 'Apple Mac',
      device_os: 'Mac',
      device_os_version: '10.15',
      device_browser_name: 'Chrome',
    };

    try {
      await this.apiClient.executeRequest('POST', '/api/timers', payload);
      console.log(`Timer created successfully\n`);
      return true;
    } catch (error) {
      console.error(`Failed to create timer: ${error}\n`);
      return false;
    }
  }

  /**
   * Creates timers for all milestones in a project
   * @param projectTitle - The title of the project
   * @param userId - The user ID to create timers for
   * @param startedAt - Timer start date (YYYY-MM-DD HH:mm:ss)
   * @param finishedAt - Timer end date (YYYY-MM-DD HH:mm:ss)
   * @param categoryId - Optional timer category ID (default: 272)
   */
  async createTimersForProject(
    projectTitle: string,
    userId: number,
    startedAt: string,
    finishedAt: string,
    categoryId: number = 272
  ): Promise<MilestoneTimerMapping[]> {
    console.log(`\nCreating timers for project: ${projectTitle}`);
    console.log(`User ID: ${userId}`);
    console.log(`Period: ${startedAt} - ${finishedAt}\n`);

    // Fetch milestones
    const milestones = await this.fetchPctTree(projectTitle);

    if (milestones.length === 0) {
      console.log(`No milestones found for project: ${projectTitle}\n`);
      return [];
    }

    console.log(`\nCreating timers for ${milestones.length} milestones...\n`);

    // Create timers for each milestone
    const mappings: MilestoneTimerMapping[] = [];

    for (let i = 0; i < milestones.length; i++) {
      const milestone = milestones[i];
      console.log(`[${i + 1}/${milestones.length}] ${milestone.title}`);

      const success = await this.createTimer(
        milestone.id,
        milestone.title,
        userId,
        startedAt,
        finishedAt,
        categoryId
      );

      mappings.push({
        project_title: projectTitle,
        milestone_id: milestone.id,
        milestone_title: milestone.title,
        timer_created: success,
      });
    }

    const successCount = mappings.filter(m => m.timer_created).length;
    console.log(`\nCompleted! Created ${successCount}/${milestones.length} timers.`);

    // Save mappings
    this.saveTimerMappings(projectTitle, mappings);

    return mappings;
  }

  /**
   * Creates timers for multiple projects
   * @param projectTitles - Array of project titles
   * @param userId - The user ID to create timers for
   * @param startedAt - Timer start date (YYYY-MM-DD HH:mm:ss)
   * @param finishedAt - Timer end date (YYYY-MM-DD HH:mm:ss)
   * @param categoryId - Optional timer category ID (default: 272)
   */
  async createTimersForProjects(
    projectTitles: string[],
    userId: number,
    startedAt: string,
    finishedAt: string,
    categoryId: number = 272
  ): Promise<Map<string, MilestoneTimerMapping[]>> {
    console.log(`\nCreating timers for ${projectTitles.length} projects`);
    console.log(`Projects: ${projectTitles.join(', ')}\n`);

    const results = new Map<string, MilestoneTimerMapping[]>();

    for (let i = 0; i < projectTitles.length; i++) {
      const projectTitle = projectTitles[i];
      console.log(`\n========== Project ${i + 1}/${projectTitles.length}: ${projectTitle} ==========`);

      const mappings = await this.createTimersForProject(
        projectTitle,
        userId,
        startedAt,
        finishedAt,
        categoryId
      );

      results.set(projectTitle, mappings);
    }

    console.log(`\n========== Summary ==========`);
    results.forEach((mappings, projectTitle) => {
      const successCount = mappings.filter(m => m.timer_created).length;
      console.log(`${projectTitle}: ${successCount}/${mappings.length} timers created`);
    });

    return results;
  }

  private saveTimerMappings(projectTitle: string, mappings: MilestoneTimerMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Sanitize project title for filename
    const sanitizedTitle = projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const cacheFile = path.join(cacheDir, `timer-mappings-${sanitizedTitle}.json`);

    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved timer mappings to: ${cacheFile}`);
  }

  getTimerMappings(projectTitle: string): MilestoneTimerMapping[] | null {
    const sanitizedTitle = projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const cacheFile = path.join('./data/cache', `timer-mappings-${sanitizedTitle}.json`);

    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }

  /**
   * Creates timers ONLY for the owner user based on their PM allocations in milestones
   * This is the main method to be used after tasks are created
   * @param milestoneMappings - Array of milestone mappings from cache
   * @param ownerUserId - The owner user ID (only this user will get timers)
   * @param partnerId - Organization/partner ID
   * @param defaultTimerCategoryId - Timer category ID (activity type) to use
   */
  async createTimersForOwnerUser(options: {
    milestoneMappings: any[];
    ownerUserId: number;
    partnerId: string;
    defaultTimerCategoryId?: number;
    timezone?: string;
  }): Promise<void> {
    const {
      milestoneMappings,
      ownerUserId,
      partnerId,
      defaultTimerCategoryId,
      timezone = 'Europe/Istanbul',
    } = options;

    console.log('\n=== Creating Timers for Owner User ===\n');
    console.log(`Processing ${milestoneMappings.length} milestones`);
    console.log(`Owner User ID: ${ownerUserId}`);
    console.log(`Partner ID: ${partnerId}\n`);

    if (!this.mainApiClient) {
      console.error('Main API client not provided. Cannot fetch PM assignments.');
      return;
    }

    // Set partner ID for requests
    this.apiClient.setPartnerId(partnerId);
    this.mainApiClient.setPartnerId(partnerId);

    let totalTimersCreated = 0;
    let errors = 0;

    // Helper: Get business days between two dates
    const getBusinessDays = (startISO: string, endISO: string): string[] => {
      const days: string[] = [];
      const start = new Date(startISO);
      const end = new Date(endISO);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
        if (dow !== 0 && dow !== 6) {
          days.push(d.toISOString().slice(0, 10));
        }
      }
      return days;
    };

    // Process each milestone
    for (let i = 0; i < milestoneMappings.length; i++) {
      const ms = milestoneMappings[i];
      console.log(`\n[${i + 1}/${milestoneMappings.length}] Processing: ${ms.project_short_title} → ${ms.milestone_title}`);
      console.log(`  Period: ${ms.started_at} to ${ms.finished_at}`);

      try {
        // Get business days for this milestone period
        const milestoneDays = getBusinessDays(ms.started_at, ms.finished_at);
        if (milestoneDays.length === 0) {
          console.log(`  ⊗ No business days in period, skipping`);
          continue;
        }
        console.log(`  Business days: ${milestoneDays.length}`);

        // Fetch PM assignments for this milestone - only for owner user
        let ownerPmAllocation: any = null;
        try {
          const response: any = await this.mainApiClient.executeRequest(
            'GET',
            '/pct/api/user-task-year-pms',
            {
              'filter[task_id]': ms.task_id?.toString() ?? '',
              'filter[user_id]': ownerUserId.toString(),
              'per_page': '0'
            }
          );
          const userPmAllocations = response?.data || response || [];
          ownerPmAllocation = Array.isArray(userPmAllocations) && userPmAllocations.length > 0
            ? userPmAllocations[0]
            : null;
        } catch (err: any) {
          console.log(`  ⊗ Could not fetch PM allocations: ${err?.message || err}`);
          continue;
        }

        if (!ownerPmAllocation) {
          console.log(`  ⊗ No PM allocation found for owner user in this milestone`);
          continue;
        }

        const pmAmount = ownerPmAllocation.amount || 0; // PM in decimal (e.g., 0.5 = 50%)

        if (pmAmount <= 0) {
          console.log(`  ⊗ Owner has no PM allocated (PM: ${pmAmount})`);
          continue;
        }

        // Calculate total hours: PM * 173.33 hours/month (average work hours)
        const totalHours = pmAmount * 173.333333;

        // Distribute hours evenly across business days
        const hoursPerDay = totalHours / milestoneDays.length;

        console.log(`  Owner PM allocation: ${pmAmount.toFixed(2)} → ${totalHours.toFixed(0)}h total, ${hoursPerDay.toFixed(2)}h/day`);

        // Resolve milestone ID from PCT tree
        const projectTitleForQuery = ms.project_title || ms.project_short_title;
        console.log(`  Querying PCT tree with: "${projectTitleForQuery}"`);

        const milestones = await this.fetchPctTree(projectTitleForQuery);

        if (milestones.length === 0) {
          console.log(`  ⊗ No milestones found in PCT tree for project "${projectTitleForQuery}"`);
          console.log(`  ⊗ Attempting fallback: using task_id ${ms.task_id} as PCT milestone ID`);

          // Fallback: use task_id directly as PCT milestone ID
          const pctMilestoneId = ms.task_id;
          console.log(`  Using task_id as PCT Milestone ID: ${pctMilestoneId}`);

          // Create timers with this ID
          for (const dayISO of milestoneDays) {
            try {
              await this.createTimerForDay({
                dayISO,
                hours: hoursPerDay,
                userId: ownerUserId,
                pctMilestoneId,
                timerCategoryId: defaultTimerCategoryId,
                timezone,
              });
              totalTimersCreated++;
            } catch (err: any) {
              console.log(`    ! Failed to create timer for ${dayISO}: ${err?.message || err}`);
              errors++;
            }
          }
          continue;
        }

        const matchedMilestone = milestones.find(m => m.title === ms.milestone_title || m.id === ms.task_id);

        if (!matchedMilestone) {
          console.log(`  ⊗ Could not match milestone "${ms.milestone_title}" in PCT tree`);
          console.log(`  Available milestones: ${milestones.map(m => m.title).join(', ')}`);
          console.log(`  ⊗ Attempting fallback: using task_id ${ms.task_id} as PCT milestone ID`);

          // Fallback: use task_id directly
          const pctMilestoneId = ms.task_id;
          console.log(`  Using task_id as PCT Milestone ID: ${pctMilestoneId}`);

          // Create timers with this ID
          for (const dayISO of milestoneDays) {
            try {
              await this.createTimerForDay({
                dayISO,
                hours: hoursPerDay,
                userId: ownerUserId,
                pctMilestoneId,
                timerCategoryId: defaultTimerCategoryId,
                timezone,
              });
              totalTimersCreated++;
            } catch (err: any) {
              console.log(`    ! Failed to create timer for ${dayISO}: ${err?.message || err}`);
              errors++;
            }
          }
          continue;
        }

        const pctMilestoneId = matchedMilestone.id;
        console.log(`  ✓ Matched PCT Milestone ID: ${pctMilestoneId}`);

        // Create timer for each business day
        for (const dayISO of milestoneDays) {
          try {
            await this.createTimerForDay({
              dayISO,
              hours: hoursPerDay,
              userId: ownerUserId,
              pctMilestoneId,
              timerCategoryId: defaultTimerCategoryId,
              timezone,
            });
            totalTimersCreated++;
          } catch (err: any) {
            console.log(`    ! Failed to create timer for ${dayISO}: ${err?.message || err}`);
            errors++;
          }
        }

      } catch (msErr: any) {
        console.log(`  ! Failed to process milestone: ${msErr?.message || msErr}`);
        errors++;
      }
    }

    console.log(`\n=== Timer Creation Summary ===`);
    console.log(`  Total timers created: ${totalTimersCreated}`);
    console.log(`  Errors: ${errors}\n`);
  }

  /**
   * Enables time tracking mode for a user
   * @param userId - The user ID to enable time tracking for
   * @param partnerId - Organization/partner ID
   */
  async enableTimeTrackingForUser(userId: number, partnerId: string): Promise<void> {
    console.log(`\nEnabling time tracking for user ${userId}...`);

    if (!this.mainApiClient) {
      console.error('Main API client not provided. Cannot update user settings.');
      return;
    }

    // Set partner ID for request
    this.mainApiClient.setPartnerId(partnerId);

    try {
      await this.mainApiClient.executeRequest(
        'PATCH',
        `/pct/api/users/${userId}/settings`,
        { time_entry_mode: 1 }
      );
      console.log(`✓ Time tracking enabled for user ${userId}\n`);
    } catch (error: any) {
      console.error(`Failed to enable time tracking: ${error.message}\n`);
      throw error;
    }
  }

  /**
   * Creates a timer entry for a specific day
   * Private helper method used by createTimersForMilestoneAssignees
   */
  private async createTimerForDay(options: {
    dayISO: string;
    hours: number;
    userId: number;
    pctMilestoneId: number;
    timerCategoryId?: number;
    timezone?: string;
  }): Promise<void> {
    const {
      dayISO,
      hours,
      userId,
      pctMilestoneId,
      timerCategoryId,
      timezone = 'Europe/Istanbul',
    } = options;

    // Start at 09:00, calculate end time based on hours
    const start = new Date(`${dayISO}T09:00:00`);
    const totalMinutes = Math.max(1, Math.round(hours * 60));
    const end = new Date(start.getTime() + totalMinutes * 60000);

    const started_at = `${dayISO} 09:00:00`;
    const finished_at = `${dayISO} ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:00`;

    // Build activities array: TimerCategory first (if provided), then PctMilestone
    const activities: Array<{ id: number; type: string }> = [];
    if (typeof timerCategoryId === 'number') {
      activities.push({ id: timerCategoryId, type: 'App\\Models\\TimerCategory' });
    }
    activities.push({ id: pctMilestoneId, type: 'App\\Models\\PctMilestone' });

    const payload = {
      started_at,
      finished_at,
      startTimer: false,
      activities,
      user_id: userId,
      skip_legal_requirements: true,
      device_type: 'desktop',
      device_name: 'Apple Mac',
      device_os: 'Mac',
      device_os_version: '10.15',
      device_browser_name: 'Chrome',
    };

    await this.apiClient.executeRequest(
      'POST',
      '/api/timers',
      payload,
      {
        timezone,
        origin: 'https://clusterix.io',
        referer: 'https://clusterix.io/',
      }
    );
  }
}
