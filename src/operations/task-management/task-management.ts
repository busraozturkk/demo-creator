import { ApiClient } from '../../api-client';
import { AuthService } from '../../auth';
import { BaseOperation } from '../utilities/base-operation';
import * as fs from 'fs';
import * as path from 'path';

interface ProjectMapping {
  id: number;
  partnership_id?: number;
  short_title: string;
  title: string;
  started_at?: string;
  finished_at?: string;
}

interface FolderMapping {
  id: number;
  project_short_title: string;
  name: string;
}

interface BoardMapping {
  id: number;
  folder_id: number;
  project_short_title: string | undefined;
  milestone_title: string;
  name: string;
}

interface TaskData {
  work_package_title: string;
  task_title: string;
  task_description: string;
  task_type: string;
}

interface WorkPackageEmployeeAssignment {
  work_package_title: string;
  task_id: number;
  assigned_employees: Array<{
    user_id: number;
    employee_name: string;
    pm: number;
  }>;
}

/**
 * Our custom 3 statuses for project boards.
 * NOTE: API uses 0-based positions (0, 1, 2)
 */
const TASK_STATUSES = [
  { title: 'TO DO',        position: 0, color: '#CCCCCC', type: 'todo',      timer_action: '' },
  { title: 'IN PROGRESS',  position: 1, color: '#FECC45', type: 'active',    timer_action: '' },
  { title: 'DONE',         position: 2, color: '#8AA657', type: 'completed', timer_action: '' },
];

const TASK_TYPES = [
  { title: 'Task',          icon: 'WhiteFlagIcon', color: '#8E6BAC' },
  { title: 'Bug',           icon: 'BugIcon',       color: '#D50000' },
  { title: 'Feature',       icon: 'StarEmptyIcon', color: '#F6BF26' },
  { title: 'Documentation', icon: 'DocIcon',       color: '#8AA657' },
];

/**
 * Timer categories for time tracking (activity types for grouping time entries)
 */
const TIMER_CATEGORIES = [
  { title: 'Development',    icon: 'ItHIcon',      color: '#38a09d' },
  { title: 'Research',       icon: 'CheckingHIcon',    color: '#F6BF26' },
  { title: 'Documentation',  icon: 'ClusterDocsHIcon',       color: '#8AA657' },
  { title: 'Testing',        icon: 'BugHIcon',     color: '#EA787F' },
  { title: 'Meeting',        icon: 'UserMultiHIcon',     color: '#8E6BAC' },
];

export class TaskManagementOperation extends BaseOperation {
  private taskMgmtApiClient: ApiClient;
  private folderMappings: FolderMapping[] = [];
  private boardMappings: BoardMapping[] = [];
  private taskTypeIds: number[] = [];
  private priorityIds: number[] = [];
  private allowedActivityTypes: string[] = [];

  constructor(authService: AuthService) {
    super();
    // Task Management has its own backend
    this.taskMgmtApiClient = new ApiClient(
        authService,
        'https://task-management-backend.innoscripta.com'
    );
  }

  // --------------------------------------------------------------------------
  // Retry & paging helpers
  // --------------------------------------------------------------------------

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch boards with paging and retry until a readiness condition is met.
   * - expectedMilestoneCount: how many milestone boards we expect (from cache)
   * - readinessRatio: consider ready when we see ≥ expected * ratio
   */
  private async fetchBoardsWithRetry(options?: {
    retries?: number;
    baseDelayMs?: number;
    jitterMs?: number;
    expectedMilestoneCount?: number;
    readinessRatio?: number;   // 0..1
    maxPages?: number;
  }): Promise<any[]> {
    const {
      retries = 10,
      baseDelayMs = 1500,
      jitterMs = 400,
      expectedMilestoneCount = 0,
      readinessRatio = 0.9,
      maxPages = 10,
    } = options || {};

    let lastError: any = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const all: any[] = [];

        // Naive paging (?page=1..maxPages). If the API ignores page param, the first result still works.
        for (let page = 1; page <= maxPages; page++) {
          const res: any = await this.taskMgmtApiClient.executeRequest(
              'GET',
              '/api/boards',
              { include: 'pinned', page: page.toString() }
          );
          const chunk = res?.data || res || [];
          if (Array.isArray(chunk)) {
            all.push(...chunk);
            if (chunk.length === 0) break; // empty page → stop
          } else {
            if (page === 1) all.push(chunk);
            break;
          }
        }

        const milestoneBoards = all.filter((b: any) => (b.external_type || b.type) === 'Milestone');
        const ready = expectedMilestoneCount === 0
            ? milestoneBoards.length > 0
            : milestoneBoards.length >= Math.ceil(expectedMilestoneCount * readinessRatio);

        console.log(
            `[Boards Retry] attempt ${attempt}/${retries} → total=${all.length}, milestones=${milestoneBoards.length}, expected≈${expectedMilestoneCount}, ready=${ready}`
        );

        if (ready) return all;
      } catch (err: any) {
        lastError = err;
        console.log(`[Boards Retry] attempt ${attempt}/${retries} failed: ${err?.message || err}`);
      }

      if (attempt < retries) {
        const delay = baseDelayMs * attempt + Math.floor(Math.random() * jitterMs);
        console.log(`[Boards Retry] Waiting ${delay}ms before next attempt...`);
        await this.sleep(delay);
      }
    }

    if (lastError) {
      throw new Error(`Failed to fetch boards after ${retries} attempts: ${lastError.message || lastError}`);
    }
    throw new Error(`Boards not ready after ${retries} attempts (not enough Milestone boards visible)`);
  }

  /**
   * Fetch statuses for a board with a few retries (useful right after creation).
   */
  private async fetchStatusesWithRetry(boardId: number, retries = 5, delayMs = 800) {
    let lastError: any = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res: any = await this.taskMgmtApiClient.executeRequest(
            'GET',
            '/api/statuses',
            { board_id: boardId.toString() }
        );
        const statuses = res?.data || res || [];
        if (Array.isArray(statuses) && statuses.length > 0) return statuses;
      } catch (err: any) {
        lastError = err;
      }
      if (attempt < retries) {
        console.log(`[Statuses Retry] Board ${boardId} attempt ${attempt}/${retries} → waiting ${delayMs}ms...`);
        await this.sleep(delayMs);
      }
    }
    if (lastError) {
      throw new Error(`Failed to fetch statuses for board ${boardId} after ${retries} attempts: ${lastError.message || lastError}`);
    }
    return [];
  }

  /**
   * Replace all statuses on a board with our canonical 3 statuses.
   * - DELETE all existing statuses
   * - POST our 3 statuses (TO DO, IN PROGRESS, DONE)
   * - Positions are 0-based (0, 1, 2) as per API expectation
   */
  private async ensureThreeStatuses(boardId: number): Promise<void> {
    const desired = TASK_STATUSES;

    // Step 1: Read all existing statuses
    let existing: any[] = [];
    try {
      existing = await this.fetchStatusesWithRetry(boardId, 5, 800);
      console.log(`    Found ${existing.length} existing statuses on board ${boardId}`);
    } catch (e: any) {
      console.log(`[ensureThreeStatuses] Initial read failed for board ${boardId}: ${e?.message || e}`);
    }

    // Step 2: Delete all existing statuses
    for (const s of existing) {
      try {
        console.log(`    → Deleting status: ${s.title} (ID: ${s.id}) from board ${boardId}`);
        await this.taskMgmtApiClient.executeRequest('DELETE', `/api/statuses/${s.id}`);
        console.log(`      ✓ Deleted ${s.title}`);
      } catch (err: any) {
        console.log(`      ✗ Delete failed for ${s.title}: ${err?.message || err}`);
      }
    }

    // Small delay after deletions
    await this.sleep(500);

    // Step 3: Create our 3 canonical statuses
    for (const d of desired) {
      try {
        console.log(`    → Creating status: ${d.title} on board ${boardId}`);
        const createRes: any = await this.taskMgmtApiClient.executeRequest(
            'POST',
            '/api/statuses',
            {
              title: d.title,
              position: d.position,
              board_id: boardId,
              color: d.color,
              type: d.type,
              timer_action: d.timer_action,
            }
        );
        const createdId = createRes?.data?.id || createRes?.id;
        console.log(`      ✓ Created ${d.title} (ID: ${createdId}, position: ${d.position})`);
      } catch (err: any) {
        console.log(`      ✗ Create failed for ${d.title} on board ${boardId}: ${err?.message || err}`);
      }
    }

    // Step 4: Verify final state
    try {
      await this.sleep(500); // Give API time to update
      const finalList = await this.fetchStatusesWithRetry(boardId, 3, 600);
      const finalPretty = finalList
          .map((s: any) => `${s.position}:${s.title}[${s.type}]`)
          .sort((a, b) => {
            const posA = parseInt(a.split(':')[0]);
            const posB = parseInt(b.split(':')[0]);
            return posA - posB;
          })
          .join(', ');
      console.log(`    ⇢ Board ${boardId} final statuses (${finalList.length}): ${finalPretty}`);
    } catch { /* no-op */ }
  }

  // --------------------------------------------------------------------------
  // User Consent
  // --------------------------------------------------------------------------

  async approveUserConsent(): Promise<void> {
    console.log('\n=== Approving Task Management User Consent ===\n');

    try {
      await this.taskMgmtApiClient.executeRequest(
        'POST',
        '/api/user-consents',
        { consent_type: 'device_information_consent' }
      );
      console.log('✓ User consent approved for task management\n');
    } catch (error: any) {
      console.log(`Failed to approve user consent: ${error.message}\n`);
    }
  }

  // --------------------------------------------------------------------------
  // Reference data
  // --------------------------------------------------------------------------

  async createTaskTypes(): Promise<void> {
    console.log('\n=== Creating Task Types ===\n');

    let created = 0;
    let errors = 0;

    for (const taskType of TASK_TYPES) {
      try {
        const response: any = await this.taskMgmtApiClient.executeRequest(
            'POST',
            '/api/task-types',
            { title: taskType.title, icon: taskType.icon, color: taskType.color }
        );
        const taskTypeId = response.data?.id || response.id;
        if (taskTypeId) this.taskTypeIds.push(taskTypeId);
        console.log(`  ✓ Created: ${taskType.title} (ID: ${taskTypeId})`);
        created++;
      } catch (error: any) {
        console.log(`  ✗ Failed to create ${taskType.title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\nCreated ${created} task types (errors: ${errors})\n`);
  }

  async createTimerCategories(roleMappings?: Array<{ id: string, title: string }>): Promise<void> {
    console.log('\n=== Creating Timer Categories (Activity Types) ===\n');

    let created = 0;
    let errors = 0;

    // Get all board IDs for the timer categories
    const boardIds: number[] = this.boardMappings.map(b => b.id);
    console.log(`Will assign timer categories to ${boardIds.length} boards\n`);

    // Get all role IDs
    const roleIds: number[] = roleMappings ? roleMappings.map(r => parseInt(r.id)) : [];
    console.log(`Will assign timer categories to ${roleIds.length} roles\n`);

    for (const category of TIMER_CATEGORIES) {
      try {
        const payload: any = {
          title: category.title,
          icon: category.icon,
          color: category.color,
          user_ids: [],           // Empty - applies to all users
          role_ids: roleIds,      // All roles in the organization
          board_ids: boardIds,    // All milestone boards
          excluded_user_ids: []   // No exclusions
        };

        const response: any = await this.taskMgmtApiClient.executeRequest(
            'POST',
            '/api/timer-categories',
            payload
        );
        const categoryId = response.data?.id || response.id;
        console.log(`  ✓ Created: ${category.title} (ID: ${categoryId})`);
        created++;
      } catch (error: any) {
        console.log(`  ✗ Failed to create ${category.title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\nCreated ${created} timer categories (errors: ${errors})\n`);
  }

  async fetchPriorities(): Promise<void> {
    console.log('\n=== Fetching Priorities ===\n');
    try {
      const response: any = await this.taskMgmtApiClient.executeRequest('GET', '/api/priorities');
      const priorities = response.data || response || [];
      for (const p of priorities) this.priorityIds.push(p.id);
      console.log(`Found ${this.priorityIds.length} priorities\n`);
    } catch (error: any) {
      console.log(`Failed to fetch priorities: ${error.message}\n`);
    }
  }

  async fetchAllowedActivityTypes(): Promise<void> {
    console.log('\n=== Fetching Allowed Activity Types ===\n');
    try {
      const response: any = await this.taskMgmtApiClient.executeRequest('GET', '/api/allowed-activity-types');
      const activityTypes = response.data || response || [];
      for (const a of activityTypes) this.allowedActivityTypes.push(a.value || a);
      console.log(`Found ${this.allowedActivityTypes.length} allowed activity types: ${this.allowedActivityTypes.join(', ')}\n`);
    } catch (error: any) {
      console.log(`Failed to fetch allowed activity types: ${error.message}\n`);
    }
  }

  async createActivityTypeRestrictions(roleMappings: Array<{ id: string, title: string }>): Promise<void> {
    console.log('\n=== Creating Activity Type Restrictions ===\n');

    if (!roleMappings || roleMappings.length === 0) {
      console.log('No roles found. Skipping activity type restrictions.\n');
      return;
    }

    const activityTypesForSFF = ['task', 'timerCategory', 'pctTask'];
    let created = 0, errors = 0;

    for (const role of roleMappings) {
      try {
        console.log(`  Creating restriction for role: ${role.title} (ID: ${role.id})`);
        await this.taskMgmtApiClient.executeRequest(
            'POST',
            '/api/activity-type-restrictions',
            { role_id: role.id, allowed_activity_types: activityTypesForSFF }
        );
        console.log(`    ✓ Added activity types: ${activityTypesForSFF.join(', ')}`);
        created++;
      } catch (error: any) {
        console.log(`    ✗ Failed to create restriction for role ${role.title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\n=== Activity Type Restrictions Summary ===\n  - Restrictions created: ${created}\n  - Errors: ${errors}\n`);
  }

  // --------------------------------------------------------------------------
  // Core: Boards & Statuses (NO folder creation/reassignment)
  // --------------------------------------------------------------------------

  /**
   * Fetch milestone boards, ensure statuses on ALL of them, and cache mappings.
   * - No folder creation; existing board.folder_id is used as-is.
   * - Milestone mapping via external_id (task_id) first; fallback to title strip ("X. " prefix).
   */
  async setupTaskManagementForMilestones(projectMappings: ProjectMapping[]): Promise<void> {
    console.log('\n=== Setting up Task Management for Milestones ===\n');

    if (!projectMappings || projectMappings.length === 0) {
      console.log('No projects found. Skipping task management setup.\n');
      return;
    }

    const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json');
    if (!milestoneMappings || milestoneMappings.length === 0) {
      console.log('No milestone mappings found. Skipping task management setup.\n');
      return;
    }
    console.log(`Found ${milestoneMappings.length} milestones\n`);

    let totalBoards = 0;
    let totalStatusesEnsured = 0;
    let errors = 0;

    console.log('Fetching boards from Task Management with retry & paging...\n');
    try {
      const boards = await this.fetchBoardsWithRetry({
        expectedMilestoneCount: milestoneMappings.length,
        readinessRatio: 0.9,
        retries: 10,
        baseDelayMs: 1500,
        jitterMs: 400,
        maxPages: 10,
      });

      const milestoneBoards = boards.filter((b: any) => (b.external_type || b.type) === 'Milestone');

      // Remove duplicates by board ID (API pagination bug returns same boards multiple times)
      const uniqueBoards = Array.from(
        new Map(milestoneBoards.map((b: any) => [b.id, b])).values()
      );

      console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length} | Unique: ${uniqueBoards.length}\n`);

      console.log('Board details (unique):');
      uniqueBoards.forEach((b: any) =>
          console.log(`  - "${b.title || b.name}" (ID: ${b.id}, Type: ${b.external_type || b.type}, External ID: ${b.external_id}, Folder: ${b.folder_id})`)
      );
      console.log('');

      // First, map all boards without adding statuses
      // Track which milestones already have a board mapped (use only one board per milestone)
      const mappedMilestones = new Set<string>();

      for (const board of uniqueBoards) {
        const title = board.title || board.name;

        const matchingMilestone =
            milestoneMappings.find(m => m.task_id?.toString() === (board.external_id ?? '').toString())
            || milestoneMappings.find(m => {
              const normalized = title?.replace(/^\d+\.\s*/, '');
              return m.milestone_title === normalized;
            });

        if (!matchingMilestone) {
          console.log(`  ⊗ Could not match milestone for board "${title}" (ID: ${board.id}), skipping`);
          continue;
        }

        // Create a unique key for this milestone
        const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;

        // Skip if we already have a board for this milestone
        if (mappedMilestones.has(milestoneKey)) {
          console.log(`  ⊗ Skipping duplicate board "${title}" (ID: ${board.id}) - milestone already mapped`);
          continue;
        }

        this.boardMappings.push({
          id: board.id,
          folder_id: board.folder_id,
          project_short_title: matchingMilestone.project_short_title,
          milestone_title: matchingMilestone.milestone_title,
          name: title
        });

        mappedMilestones.add(milestoneKey);
        console.log(`\nMapped Board: "${title}" (ID: ${board.id})`);
        totalBoards++;
      }

      // Wait a bit for boards to be fully ready, then add statuses
      console.log(`\n⏳ Waiting 3 seconds for boards to be fully ready (allowing API to finish default setup)...\n`);
      await this.sleep(3000);

      console.log('Now adding statuses to boards...\n');
      for (const boardMapping of this.boardMappings) {
        try {
          console.log(`Processing Board: "${boardMapping.name}" (ID: ${boardMapping.id})`);
          await this.ensureThreeStatuses(boardMapping.id);
          totalStatusesEnsured += 3;
          console.log(`  ✓ Statuses ensured for board ${boardMapping.id}`);
        } catch (stErr: any) {
          console.log(`  ✗ Failed to ensure statuses for board ${boardMapping.id}: ${stErr.message}`);
          errors++;
        }
      }

    } catch (error: any) {
      console.log(`Failed to fetch boards: ${error.message}\n`);
      return;
    }

    console.log(`\n=== Task Management Setup Summary ===`);
    console.log(`  - Milestone boards processed: ${totalBoards}`);
    console.log(`  - Status sets ensured: ${totalStatusesEnsured / 3}`);
    console.log(`  - Errors: ${errors}\n`);

    // Cache board mappings
    this.saveBoardMappings();
  }

  /**
   * Fetch & cache milestone boards only (no folder creation, no reassignment),
   * and ensure their statuses are present.
   */
  async fetchAndCacheTaskManagementStructure(projectMappings: ProjectMapping[]): Promise<void> {
    console.log('\n=== Fetching & Caching Task Management Structure (No folder creation) ===\n');

    if (!projectMappings || projectMappings.length === 0) {
      console.log('No project-management found. Skipping.\n');
      return;
    }

    const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json') || [];
    console.log(`Milestone mappings: ${milestoneMappings.length}\n`);

    let totalBoards = 0;
    let totalStatusesEnsured = 0;
    let errors = 0;

    try {
      const boards = await this.fetchBoardsWithRetry({
        expectedMilestoneCount: milestoneMappings.length,
        readinessRatio: 0.9,
        retries: 10,
        baseDelayMs: 1500,
        jitterMs: 400,
        maxPages: 10,
      });

      const milestoneBoards = boards.filter((b: any) => (b.external_type || b.type) === 'Milestone');
      console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length}\n`);

      // First, map all boards without adding statuses
      // Track which milestones already have a board mapped (use only one board per milestone)
      const mappedMilestones = new Set<string>();

      for (const board of milestoneBoards) {
        const title = board.title || board.name;

        const matchingMilestone =
            milestoneMappings.find(m => m.task_id?.toString() === (board.external_id ?? '').toString())
            || milestoneMappings.find(m => title?.replace(/^\d+\.\s*/, '') === m.milestone_title);

        if (!matchingMilestone) {
          console.log(`  ⊗ Could not map milestone for "${title}" (ID: ${board.id}), skipping cache entry`);
          continue;
        }

        // Create a unique key for this milestone
        const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;

        // Skip if we already have a board for this milestone
        if (mappedMilestones.has(milestoneKey)) {
          console.log(`  ⊗ Skipping duplicate board "${title}" (ID: ${board.id}) - milestone already mapped`);
          continue;
        }

        this.boardMappings.push({
          id: board.id,
          folder_id: board.folder_id,
          project_short_title: matchingMilestone.project_short_title,
          milestone_title: matchingMilestone.milestone_title,
          name: title
        });

        mappedMilestones.add(milestoneKey);
        totalBoards++;
      }

      // Wait a bit for boards to be fully ready, then add statuses
      console.log(`\n⏳ Waiting 2 seconds for boards to be fully ready...\n`);
      await this.sleep(2000);

      console.log('Now adding statuses to boards...\n');
      for (const boardMapping of this.boardMappings) {
        try {
          await this.ensureThreeStatuses(boardMapping.id);
          totalStatusesEnsured += 3;
        } catch (e: any) {
          console.log(`    ✗ Failed to ensure statuses for board ${boardMapping.id}: ${e.message}`);
          errors++;
        }
      }

    } catch (err: any) {
      console.log(`Failed to fetch boards: ${err.message}\n`);
      return;
    }

    console.log(`\n=== Structure Summary ===`);
    console.log(`  - Milestone boards cached: ${totalBoards}`);
    console.log(`  - Status sets ensured: ${totalStatusesEnsured / 3}`);
    console.log(`  - Errors: ${errors}\n`);

    this.saveBoardMappings();
  }

  private saveFolderMappings(): void {
    this.saveToCache('./data/cache/task-folder-mappings.json', this.folderMappings);
    console.log(`Saved ${this.folderMappings.length} folder mappings to cache`);
  }

  private saveBoardMappings(): void {
    this.saveToCache('./data/cache/task-board-mappings.json', this.boardMappings);
    console.log(`Saved ${this.boardMappings.length} board mappings to cache\n`);
  }

  // --------------------------------------------------------------------------
  // CSV + utils
  // --------------------------------------------------------------------------

  private loadTasksFromCSV(csvPath?: string): TaskData[] {
    const defaultPath = './data/sff-data-en/tasks.csv';
    const filePath = csvPath || defaultPath;

    if (!fs.existsSync(filePath)) {
      console.log(`Task CSV file not found: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const tasks: TaskData[] = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const fields: string[] = [];
      let current = '';
      let quoted = false;

      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') {
          if (quoted && line[j + 1] === '"') { current += '"'; j++; }
          else { quoted = !quoted; }
        } else if (ch === ',' && !quoted) {
          fields.push(current); current = '';
        } else {
          current += ch;
        }
      }
      fields.push(current);

      if (fields.length >= 4) {
        tasks.push({
          work_package_title: fields[0].trim(),
          task_title: fields[1].trim(),
          task_description: fields[2].trim(),
          task_type: fields[3].trim(),
        });
      }
    }
    return tasks;
  }

  private randomDateInPeriod(startDate: string, endDate: string): string {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
    const d = new Date(randomTime);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // --------------------------------------------------------------------------
  // Tasks (work-package and milestone flows)
  // --------------------------------------------------------------------------

  /**
   * Create tasks linked to work packages. Assumes milestone boards exist and are status-ready.
   */
  async createTasksForWorkPackages(csvPath?: string): Promise<void> {
    console.log('\n=== Creating Tasks for Work Packages ===\n');

    const workPackageIntervals = this.loadFromCache<any[]>('./data/cache/work-package-intervals.json');
    if (!workPackageIntervals || workPackageIntervals.length === 0) {
      console.log('No work package intervals found. Skipping task creation.\n');
      return;
    }
    console.log(`Found ${workPackageIntervals.length} work packages\n`);

    const tasksData = this.loadTasksFromCSV(csvPath);
    if (tasksData.length === 0) {
      console.log('No task data found in CSV. Skipping task creation.\n');
      return;
    }
    console.log(`Loaded ${tasksData.length} tasks from CSV\n`);

    const wpEmployeeAssignments = this.loadFromCache<WorkPackageEmployeeAssignment[]>('./data/cache/wp-employee-assignments.json') || [];
    console.log(`Loaded ${wpEmployeeAssignments.length} work package employee assignments from cache\n`);

    const tasksByWP = new Map<string, TaskData[]>();
    for (const t of tasksData) {
      const arr = tasksByWP.get(t.work_package_title) || [];
      arr.push(t);
      tasksByWP.set(t.work_package_title, arr);
    }

    const empsByWP = new Map<string, WorkPackageEmployeeAssignment['assigned_employees']>();
    for (const a of wpEmployeeAssignments) empsByWP.set(a.work_package_title, a.assigned_employees);

    if (this.taskTypeIds.length === 0) console.log('Warning: No task types created.\n');
    if (this.priorityIds.length === 0) console.log('Warning: No priorities found.\n');

    let totalTasks = 0, errors = 0;
    const boardTodoStatus = new Map<number, number>();
    const boardStatusCache = new Map<number, any[]>(); // Cache all statuses per board

    for (const wp of workPackageIntervals) {
      try {
        const board = this.boardMappings.find(b => b.project_short_title === wp.project_short_title && b.milestone_title === wp.milestone_title);
        if (!board) {
          console.log(`  Warning: Board not found for ${wp.project_short_title} / ${wp.milestone_title} → ${wp.work_package_title}`);
          continue;
        }

        // Fetch and cache all statuses for this board once
        let statuses = boardStatusCache.get(board.id);
        if (!statuses) {
          try {
            statuses = await this.fetchStatusesWithRetry(board.id);
            boardStatusCache.set(board.id, statuses);
          } catch (e: any) {
            console.log(`  Warning: Failed to fetch statuses for board ${board.id}: ${e.message}`);
            continue;
          }
        }

        // Ensure TO DO status id for this board (read from cache map)
        let statusId = boardTodoStatus.get(board.id);
        if (!statusId) {
          const todo = statuses.find((s: any) => s.title === 'TO DO' || s.type === 'todo');
          if (todo?.id) {
            statusId = todo.id;
            boardTodoStatus.set(board.id, statusId!);
          }
        }
        if (!statusId) { console.log(`  Warning: No TO DO status on board ${board.id}`); continue; }

        const wpTasks = tasksByWP.get(wp.work_package_title) || [];
        if (wpTasks.length === 0) {
          console.log(`  Warning: No tasks for WP ${wp.work_package_title}`);
          continue;
        }

        console.log(`  ${wp.project_short_title} → ${wp.milestone_title} → ${wp.work_package_title} (${wpTasks.length} tasks)`);

        const assigned = empsByWP.get(wp.work_package_title) || [];

        for (const t of wpTasks) {
          try {
            const createdAt = this.randomDateInPeriod(wp.started_at, wp.finished_at);
            const deadline  = this.randomDateInPeriod(createdAt, wp.finished_at);

            const createRes: any = await this.taskMgmtApiClient.executeRequest(
                'POST', '/api/tasks',
                { title: t.task_title, position: totalTasks, board_id: board.id, status_id: statusId! }
            );
            const taskId = createRes?.data?.id || createRes?.id;

            try {
              const updatePayload: any = {
                title: t.task_title,
                description: `<div style="font-size: 11pt; font-family: Raleway, sans-serif;" data-node-font-size="11pt" data-node-font-family="Raleway, sans-serif">${t.task_description}</div>`,
                deadline,
                fields: ['pct_task','description','task_type','responsibles','watchers','sprint_point','urgency','tags','deadline'],
                checklistSections: []
              };
              if (this.taskTypeIds.length > 0) updatePayload.task_type_id = this.taskTypeIds[Math.floor(Math.random()*this.taskTypeIds.length)];
              if (this.priorityIds.length > 0)  updatePayload.priority_id  = this.priorityIds[Math.floor(Math.random()*this.priorityIds.length)];
              if (wp.task_id) updatePayload.pct_task_id = wp.task_id;

              await this.taskMgmtApiClient.executeRequest('PUT', `/api/tasks/${taskId}`, updatePayload);

              // Decide target status based on dates, then move if needed
              const now = new Date();
              const dd  = new Date(deadline);
              const cd  = new Date(createdAt);

              let targetType: 'todo'|'active'|'completed' = 'todo';
              let completedAt: string | null = null;

              if (dd < now) {
                targetType = 'completed';
                completedAt = this.randomDateInPeriod(createdAt, deadline);
              } else if (cd < now && dd > now) {
                targetType = Math.random() > 0.5 ? 'completed' : 'active';
                if (targetType === 'completed') completedAt = this.randomDateInPeriod(createdAt, now.toISOString().split('T')[0]);
              }

              if (targetType !== 'todo') {
                // Use cached statuses instead of fetching again
                const target = statuses.find((s: any) => s.type === targetType);
                if (target) {
                  const assignees: any[] = [], watchers: any[] = [], assigneeIds: number[] = [], watcherIds: number[] = [];
                  for (const emp of assigned) {
                    const e = {
                      id: emp.user_id,
                      organization_id: createRes.organization_id,
                      email: `user${emp.user_id}@example.com`,
                      first_name: emp.employee_name.split(' ')[0] || emp.employee_name,
                      last_name: emp.employee_name.split(' ').slice(1).join(' ') || '',
                      is_active: 1
                    };
                    assignees.push(e); watchers.push(e);
                    assigneeIds.push(emp.user_id); watcherIds.push(emp.user_id);
                  }

                  const statusUpdate: any = {
                    id: taskId,
                    organization_id: createRes.organization_id,
                    board_id: board.id,
                    status_id: target.id,
                    title: t.task_title,
                    fields: updatePayload.fields,
                    is_checklist: 0,
                    position: totalTasks,
                    sprint_position: 1,
                    time_estimation_unit: 'hour',
                    total_sprint_points: 0,
                    task_size: 'small',
                    estimated_sprint_points: 2,
                    estimated_time: 4,
                    assignees, watchers,
                    status: target,
                    created_at: createdAt,
                    encoded_id: createRes.encoded_id || '',
                    is_public: false,
                    customer_id: null,
                    user_task_track_times: [],
                    user_task_costs: [],
                    user_hourly_salaries: [],
                    sectionsDetail: updatePayload.fields.map((f: string, i: number) => ({
                      id: f, type: f, order: i + 1,
                      dropMeta: { destination: { droppableId: 'all-sections', index: i }, type: 'SECTION' },
                      value:
                          f === 'description' ? updatePayload.description :
                              f === 'task_type' && updatePayload.task_type_id ? updatePayload.task_type_id :
                                  f === 'urgency' && updatePayload.priority_id ? updatePayload.priority_id :
                                      f === 'responsibles' ? assignees :
                                          f === 'watchers' ? watchers : ''
                    })),
                    checklistSections: [],
                    positionIndex: { destinationIndex: 0, sourceIndex: 0 },
                    source_status_id: target.id,
                    assignee_ids: assigneeIds,
                    watcher_ids: watcherIds
                  };
                  if (completedAt) statusUpdate.completed_at = completedAt;

                  await this.taskMgmtApiClient.executeRequest('PUT', `/api/tasks/${taskId}`, statusUpdate);
                }
              }

            } catch (updErr: any) {
              console.log(`    ✗ Failed to update task details: ${updErr.message}`);
            }

            totalTasks++;
          } catch (createErr: any) {
            console.log(`    ✗ Failed to create task "${t.task_title}": ${createErr.message}`);
            errors++;
          }
        }

      } catch (err: any) {
        console.log(`  ✗ Failed to process WP ${wp.work_package_title}: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n\n=== Task Creation Summary ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
  }

  /**
   * Create tasks directly in milestone boards (no work-packages).
   * Creates 10 generic tasks per milestone instead of using CSV data.
   */
  async createTasksForMilestones(csvPath?: string, projectMappings?: ProjectMapping[]): Promise<void> {
    console.log('\n=== Creating Tasks for Milestones (No Work Packages) ===\n');

    const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json');
    if (!milestoneMappings || milestoneMappings.length === 0) {
      console.log('No milestone mappings found. Skipping task creation.\n');
      return;
    }
    console.log(`Found ${milestoneMappings.length} milestones\n`);

    // Determine language from csvPath (if provided)
    const isGerman = csvPath?.includes('data-de') || csvPath?.includes('sff-data-de');

    // Generic task templates for milestone mode (10 tasks per milestone)
    const GENERIC_TASKS_EN = [
      { title: 'Research and Requirements Analysis', description: 'Conduct comprehensive research and gather requirements for this milestone', type: 'Task' },
      { title: 'Technical Design and Architecture', description: 'Design the technical architecture and create detailed design documents', type: 'Documentation' },
      { title: 'Core Implementation Phase 1', description: 'Implement the core functionality for the first phase of this milestone', type: 'Feature' },
      { title: 'Core Implementation Phase 2', description: 'Complete the core implementation and refine functionality', type: 'Feature' },
      { title: 'Unit Testing and Quality Assurance', description: 'Write and execute unit tests to ensure code quality', type: 'Task' },
      { title: 'Integration Testing', description: 'Perform integration testing with dependent systems', type: 'Task' },
      { title: 'Bug Fixes and Refinements', description: 'Address identified bugs and refine the implementation', type: 'Bug' },
      { title: 'Performance Optimization', description: 'Optimize performance and improve system efficiency', type: 'Task' },
      { title: 'Documentation and Knowledge Transfer', description: 'Create comprehensive documentation and conduct knowledge transfer sessions', type: 'Documentation' },
      { title: 'Final Review and Deployment Preparation', description: 'Conduct final review and prepare for deployment to production', type: 'Task' }
    ];

    const GENERIC_TASKS_DE = [
      { title: 'Recherche und Anforderungsanalyse', description: 'Umfassende Recherche durchführen und Anforderungen für diesen Meilenstein sammeln', type: 'Task' },
      { title: 'Technisches Design und Architektur', description: 'Technische Architektur entwerfen und detaillierte Designdokumente erstellen', type: 'Documentation' },
      { title: 'Kernimplementierung Phase 1', description: 'Kernfunktionalität für die erste Phase dieses Meilensteins implementieren', type: 'Feature' },
      { title: 'Kernimplementierung Phase 2', description: 'Kernimplementierung abschließen und Funktionalität verfeinern', type: 'Feature' },
      { title: 'Unit-Tests und Qualitätssicherung', description: 'Unit-Tests schreiben und ausführen, um Code-Qualität sicherzustellen', type: 'Task' },
      { title: 'Integrationstests', description: 'Integrationstests mit abhängigen Systemen durchführen', type: 'Task' },
      { title: 'Fehlerbehebungen und Verfeinerungen', description: 'Identifizierte Fehler beheben und Implementierung verfeinern', type: 'Bug' },
      { title: 'Leistungsoptimierung', description: 'Leistung optimieren und Systemeffizienz verbessern', type: 'Task' },
      { title: 'Dokumentation und Wissenstransfer', description: 'Umfassende Dokumentation erstellen und Wissenstransfer-Sitzungen durchführen', type: 'Documentation' },
      { title: 'Abschließende Prüfung und Deployment-Vorbereitung', description: 'Abschließende Prüfung durchführen und Deployment in Produktion vorbereiten', type: 'Task' }
    ];

    const GENERIC_TASKS = isGerman ? GENERIC_TASKS_DE : GENERIC_TASKS_EN;
    console.log(`Will create ${GENERIC_TASKS.length} tasks per milestone (Language: ${isGerman ? 'DE' : 'EN'})\n`);

    if (this.taskTypeIds.length === 0) console.log('Warning: No task types created.\n');
    if (this.priorityIds.length === 0) console.log('Warning: No priorities found.\n');

    let totalTasks = 0, errors = 0;
    const boardTodoStatus = new Map<number, number>();
    const boardStatusCache = new Map<number, any[]>(); // Cache all statuses per board

    // Load board mappings from cache (already set up in setupTaskManagementForMilestones)
    const cachedBoards = this.loadFromCache<BoardMapping[]>('./data/cache/task-board-mappings.json') || [];
    this.boardMappings = cachedBoards;
    console.log(`Loaded ${this.boardMappings.length} board mappings from cache\n`);

    // Load partnership employees for assignment (these are the employees working on the project)
    const partnershipEmployees = this.loadFromCache<any[]>('./data/cache/user-partnership-pms.json') || [];
    console.log(`Loaded ${partnershipEmployees.length} partnership employee assignments\n`);

    // Get unique employees from partnership (remove duplicates by user_id)
    const uniqueEmployees = Array.from(
      new Map(partnershipEmployees.map(e => [e.user_id, e])).values()
    );
    console.log(`Found ${uniqueEmployees.length} unique employees to assign to tasks\n`);

    for (let i = 0; i < milestoneMappings.length; i++) {
      const ms = milestoneMappings[i];

      try {
        console.log(`\n[Milestone ${i + 1}/${milestoneMappings.length}] Looking for board: project="${ms.project_short_title}", milestone="${ms.milestone_title}"`);
        const board = this.boardMappings.find(b => b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title);
        if (!board) {
          console.log(`  ✗ Warning: Board not found for ${ms.project_short_title} / ${ms.milestone_title}`);
          console.log(`  Available boards: ${JSON.stringify(this.boardMappings.map(b => ({ id: b.id, project: b.project_short_title, milestone: b.milestone_title })))}`);
          continue;
        }
        console.log(`  ✓ Found board ID: ${board.id} (${board.name})`);

        // Fetch and cache all statuses for this board once
        let statuses = boardStatusCache.get(board.id);
        if (!statuses) {
          try {
            statuses = await this.fetchStatusesWithRetry(board.id);
            boardStatusCache.set(board.id, statuses);
            console.log(`  ✓ Cached ${statuses.length} statuses for board ${board.id}`);
          } catch (e: any) {
            console.log(`  Warning: Failed to fetch statuses for board ${board.id}: ${e.message}`);
            continue;
          }
        }

        let statusId = boardTodoStatus.get(board.id);
        if (!statusId) {
          const todo = statuses.find((s: any) => s.title === 'TO DO' || s.type === 'todo');
          if (todo?.id) {
            statusId = todo.id;
            boardTodoStatus.set(board.id, statusId!);
          }
        }
        if (!statusId) { console.log(`  Warning: No TO DO status on board ${board.id}`); continue; }

        console.log(`  ${ms.project_short_title} → ${ms.milestone_title} (${GENERIC_TASKS.length} tasks)`);

        for (let taskIdx = 0; taskIdx < GENERIC_TASKS.length; taskIdx++) {
          const t = GENERIC_TASKS[taskIdx];
          try {
            const createdAt = this.randomDateInPeriod(ms.started_at, ms.finished_at);
            const deadline  = this.randomDateInPeriod(createdAt, ms.finished_at);

            const createRes: any = await this.taskMgmtApiClient.executeRequest(
                'POST', '/api/tasks',
                { title: t.title, position: totalTasks, board_id: board.id, status_id: statusId! }
            );
            const taskId = createRes?.data?.id || createRes?.id;

            // Small delay to avoid rate limiting (20ms)
            await this.sleep(20);

            try {
              const updatePayload: any = {
                title: t.title,
                description: `<div style="font-size: 11pt; font-family: Raleway, sans-serif;" data-node-font-size="11pt" data-node-font-family="Raleway, sans-serif">${t.description}</div>`,
                deadline,
                fields: ['description','task_type','responsibles','watchers','sprint_point','urgency','tags','deadline'],
                checklistSections: []
              };

              // Map task type from GENERIC_TASKS to task_type_id
              if (this.taskTypeIds.length > 0) {
                const typeIndex = TASK_TYPES.findIndex(tt => tt.title === t.type);
                if (typeIndex >= 0 && typeIndex < this.taskTypeIds.length) {
                  updatePayload.task_type_id = this.taskTypeIds[typeIndex];
                } else {
                  updatePayload.task_type_id = this.taskTypeIds[Math.floor(Math.random() * this.taskTypeIds.length)];
                }
              }
              if (this.priorityIds.length > 0)  updatePayload.priority_id  = this.priorityIds[Math.floor(Math.random()*this.priorityIds.length)];

              await this.taskMgmtApiClient.executeRequest('PUT', `/api/tasks/${taskId}`, updatePayload);

              const now = new Date();
              const dd  = new Date(deadline);
              const cd  = new Date(createdAt);

              let targetType: 'todo'|'active'|'completed' = 'todo';
              let completedAt: string | null = null;

              if (dd < now) { targetType = 'completed'; completedAt = this.randomDateInPeriod(createdAt, deadline); }
              else if (cd < now && dd > now) {
                targetType = Math.random() > 0.5 ? 'completed' : 'active';
                if (targetType === 'completed') completedAt = this.randomDateInPeriod(createdAt, now.toISOString().split('T')[0]);
              }

              if (targetType !== 'todo') {
                // Use cached statuses instead of fetching again
                const target = statuses.find((s: any) => s.type === targetType);
                if (target) {
                  // Prepare assignees and watchers from partnership employees
                  const assignees: any[] = [], watchers: any[] = [], assigneeIds: number[] = [], watcherIds: number[] = [];
                  for (const emp of uniqueEmployees) {
                    const e = {
                      id: emp.user_id,
                      organization_id: createRes.organization_id,
                      email: `user${emp.user_id}@example.com`,
                      first_name: emp.employee_name.split(' ')[0] || emp.employee_name,
                      last_name: emp.employee_name.split(' ').slice(1).join(' ') || '',
                      is_active: 1
                    };
                    assignees.push(e);
                    watchers.push(e);
                    assigneeIds.push(emp.user_id);
                    watcherIds.push(emp.user_id);
                  }

                  const statusUpdate: any = {
                    id: taskId,
                    organization_id: createRes.organization_id,
                    board_id: board.id,
                    status_id: target.id,
                    title: t.title,
                    fields: updatePayload.fields,
                    is_checklist: 0,
                    position: totalTasks,
                    sprint_position: 1,
                    time_estimation_unit: 'hour',
                    total_sprint_points: 0,
                    task_size: 'small',
                    estimated_sprint_points: 2,
                    estimated_time: 4,
                    assignees,
                    watchers,
                    status: target,
                    created_at: createdAt,
                    encoded_id: createRes.encoded_id || '',
                    is_public: false,
                    customer_id: null,
                    user_task_track_times: [],
                    user_task_costs: [],
                    user_hourly_salaries: [],
                    sectionsDetail: updatePayload.fields.map((f: string, idx: number) => ({
                      id: f, type: f, order: idx + 1,
                      dropMeta: { destination: { droppableId: 'all-sections', index: idx }, type: 'SECTION' },
                      value:
                          f === 'description' ? updatePayload.description :
                              f === 'task_type' && updatePayload.task_type_id ? updatePayload.task_type_id :
                                  f === 'urgency' && updatePayload.priority_id ? updatePayload.priority_id :
                                      f === 'responsibles' ? assignees :
                                          f === 'watchers' ? watchers : ''
                    })),
                    checklistSections: [],
                    positionIndex: { destinationIndex: 0, sourceIndex: 0 },
                    source_status_id: target.id,
                    assignee_ids: assigneeIds,
                    watcher_ids: watcherIds
                  };
                  if (completedAt) statusUpdate.completed_at = completedAt;

                  await this.taskMgmtApiClient.executeRequest('PUT', `/api/tasks/${taskId}`, statusUpdate);
                }
              }

            } catch (updErr: any) {
              console.log(`    ✗ Failed to update task details: ${updErr.message}`);
            }

            totalTasks++;
          } catch (createErr: any) {
            console.log(`    ✗ Failed to create task "${t.title}": ${createErr.message}`);
            errors++;
          }
        }

      } catch (err: any) {
        console.log(`  ✗ Failed to process milestone ${ms.milestone_title}: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n\n=== Task Creation Summary (Milestones) ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
  }
}
