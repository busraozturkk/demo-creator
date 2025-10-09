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
 * Canonical 3 statuses. NOTE: positions are 1-based to avoid UI edge-cases.
 */
const TASK_STATUSES = [
  { title: 'TO DO',        position: 1, color: '#CCCCCC', type: 'todo',      timer_action: '' },
  { title: 'IN PROGRESS',  position: 2, color: '#FECC45', type: 'active',    timer_action: '' },
  { title: 'DONE',         position: 3, color: '#8AA657', type: 'completed', timer_action: '' },
];

const TASK_TYPES = [
  { title: 'Task',          icon: 'WhiteFlagIcon', color: '#8E6BAC' },
  { title: 'Bug',           icon: 'BugIcon',       color: '#D50000' },
  { title: 'Feature',       icon: 'StarEmptyIcon', color: '#F6BF26' },
  { title: 'Documentation', icon: 'DocIcon',       color: '#8AA657' },
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
   * Ensure the canonical three statuses exist on a board with correct attributes.
   * - POST with (title, position, board_id, color, type) when missing
   * - PUT to normalize existing ones (title, color, type, timer_action, position)
   * - Positions are 1,2,3 (1-based) to avoid UI quirks
   * - Retries reads after writes to beat eventual consistency
   */
  private async ensureThreeStatuses(boardId: number): Promise<void> {
    const desired = TASK_STATUSES;

    // Read existing
    let existing: any[] = [];
    try {
      existing = await this.fetchStatusesWithRetry(boardId, 5, 800);
    } catch (e: any) {
      console.log(`[ensureThreeStatuses] Initial read failed for board ${boardId}: ${e?.message || e}`);
    }

    const byTitle = new Map<string, any>();
    const byType = new Map<string, any>();
    for (const s of existing) {
      if (s?.title) byTitle.set(s.title.toUpperCase(), s);
      if (s?.type)  byType.set(s.type, s);
    }

    // Create missing with full payload
    for (const d of desired) {
      const key = d.title.toUpperCase();
      const already = byTitle.get(key) || byType.get(d.type);
      if (!already) {
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
          console.log(`      ✓ Created ${d.title} (ID: ${createdId})`);
        } catch (err: any) {
          console.log(`      ✗ Create failed for ${d.title} on board ${boardId}: ${err?.message || err}`);
        }
      } else {
        console.log(`    • ${d.title} already exists on board ${boardId}`);
      }
    }

    // Re-read (retry) after writes
    try {
      existing = await this.fetchStatusesWithRetry(boardId, 6, 900);
    } catch (e: any) {
      console.log(`[ensureThreeStatuses] Post-create read failed for board ${boardId}: ${e?.message || e}`);
      existing = [];
    }

    // Normalize attributes and positions
    const targetByTitle = new Map<string, typeof desired[number]>();
    desired.forEach(d => targetByTitle.set(d.title.toUpperCase(), d));

    const updates: Array<{ id: number; payload: any }> = [];
    for (const s of existing) {
      const want = targetByTitle.get((s.title || '').toUpperCase());
      if (!want) continue;

      const needUpdate =
          s.title !== want.title ||
          s.position !== want.position ||
          s.color !== want.color ||
          s.type !== want.type ||
          (s.timer_action || '') !== (want.timer_action || '');

      if (needUpdate) {
        updates.push({
          id: s.id,
          payload: {
            title: want.title,
            color: want.color,
            type: want.type,
            timer_action: want.timer_action,
            position: want.position,
            board_id: boardId,
          },
        });
      }
    }

    for (const u of updates.sort((a, b) => a.payload.position - b.payload.position)) {
      try {
        console.log(`      → Normalizing status ${u.id} on board ${boardId} → ${u.payload.title} (#${u.payload.position})`);
        await this.taskMgmtApiClient.executeRequest('PUT', `/api/statuses/${u.id}`, u.payload);
        console.log(`        ✓ Normalized ${u.payload.title}`);
      } catch (err: any) {
        console.log(`        ✗ Failed to normalize status ${u.id}: ${err?.message || err}`);
      }
    }

    // Final assert (log)
    try {
      const finalList = await this.fetchStatusesWithRetry(boardId, 3, 600);
      const finalPretty = finalList
          .map((s: any) => `${s.position}:${s.title}[${s.type}]`)
          .sort()
          .join(', ');
      console.log(`    ⇢ Board ${boardId} statuses now: ${finalPretty}`);
    } catch { /* no-op */ }
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
      console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length}\n`);

      console.log('Board details:');
      milestoneBoards.forEach((b: any) =>
          console.log(`  - "${b.title || b.name}" (ID: ${b.id}, Type: ${b.external_type || b.type}, External ID: ${b.external_id}, Folder: ${b.folder_id})`)
      );
      console.log('');

      for (const board of milestoneBoards) {
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

        this.boardMappings.push({
          id: board.id,
          folder_id: board.folder_id,
          project_short_title: matchingMilestone.project_short_title,
          milestone_title: matchingMilestone.milestone_title,
          name: title
        });

        console.log(`\nProcessing Board: "${title}" (ID: ${board.id})`);
        totalBoards++;

        try {
          await this.ensureThreeStatuses(board.id);
          totalStatusesEnsured += 3;
          console.log(`  ✓ Statuses ensured for board ${board.id}`);
        } catch (stErr: any) {
          console.log(`  ✗ Failed to ensure statuses for board ${board.id}: ${stErr.message}`);
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

      for (const board of milestoneBoards) {
        const title = board.title || board.name;

        const matchingMilestone =
            milestoneMappings.find(m => m.task_id?.toString() === (board.external_id ?? '').toString())
            || milestoneMappings.find(m => title?.replace(/^\d+\.\s*/, '') === m.milestone_title);

        if (!matchingMilestone) {
          console.log(`  ⊗ Could not map milestone for "${title}" (ID: ${board.id}), skipping cache entry`);
          continue;
        }

        this.boardMappings.push({
          id: board.id,
          folder_id: board.folder_id,
          project_short_title: matchingMilestone.project_short_title,
          milestone_title: matchingMilestone.milestone_title,
          name: title
        });

        totalBoards++;

        try {
          await this.ensureThreeStatuses(board.id);
          totalStatusesEnsured += 3;
        } catch (e: any) {
          console.log(`    ✗ Failed to ensure statuses for board ${board.id}: ${e.message}`);
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

    for (const wp of workPackageIntervals) {
      try {
        const board = this.boardMappings.find(b => b.project_short_title === wp.project_short_title && b.milestone_title === wp.milestone_title);
        if (!board) {
          console.log(`  Warning: Board not found for ${wp.project_short_title} / ${wp.milestone_title} → ${wp.work_package_title}`);
          continue;
        }

        // Ensure TO DO status id for this board (read from cache map)
        let statusId = boardTodoStatus.get(board.id);
        if (!statusId) {
          try {
            // Only ensure statuses once per board (already done in setupTaskManagementForMilestones)
            const statuses = await this.fetchStatusesWithRetry(board.id);
            const todo = statuses.find((s: any) => s.title === 'TO DO' || s.type === 'todo');
            if (todo?.id) {
              statusId = todo.id;
              if (statusId != null) {
                boardTodoStatus.set(board.id, statusId);
              }
            }
          } catch (e: any) {
            console.log(`  Warning: Failed to fetch statuses for board ${board.id}: ${e.message}`);
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
                { title: t.task_title, position: totalTasks, board_id: board.id, status_id: statusId }
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
                // Statuses already ensured at board setup, just fetch them
                const statuses = await this.fetchStatusesWithRetry(board.id);
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
   * Ensures statuses before creating/moving tasks.
   */
  async createTasksForMilestones(csvPath?: string, projectMappings?: ProjectMapping[]): Promise<void> {
    console.log('\n=== Creating Tasks for Milestones (No Work Packages) ===\n');

    const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json');
    if (!milestoneMappings || milestoneMappings.length === 0) {
      console.log('No milestone mappings found. Skipping task creation.\n');
      return;
    }
    console.log(`Found ${milestoneMappings.length} milestones\n`);

    const tasksData = this.loadTasksFromCSV(csvPath);
    if (tasksData.length === 0) {
      console.log('No task data found in CSV. Skipping task creation.\n');
      return;
    }
    console.log(`Loaded ${tasksData.length} tasks from CSV\n`);

    if (this.taskTypeIds.length === 0) console.log('Warning: No task types created.\n');
    if (this.priorityIds.length === 0) console.log('Warning: No priorities found.\n');

    let totalTasks = 0, errors = 0;
    const boardTodoStatus = new Map<number, number>();

    // Make sure all milestone boards are present and have statuses
    await this.setupTaskManagementForMilestones(projectMappings || []);

    // Distribute tasks evenly across milestones
    const tasksPerMilestone = Math.ceil(tasksData.length / milestoneMappings.length);

    for (let i = 0; i < milestoneMappings.length; i++) {
      const ms = milestoneMappings[i];

      try {
        const board = this.boardMappings.find(b => b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title);
        if (!board) { console.log(`  Warning: Board not found for ${ms.project_short_title} / ${ms.milestone_title}`); continue; }

        let statusId = boardTodoStatus.get(board.id);
        if (!statusId) {
          try {
            // Only fetch statuses (already ensured in setupTaskManagementForMilestones)
            const statuses = await this.fetchStatusesWithRetry(board.id);
            const todo = statuses.find((s: any) => s.title === 'TO DO' || s.type === 'todo');
            if (todo?.id) { statusId = todo.id; boardTodoStatus.set(board.id, statusId); }
          } catch (e: any) {
            console.log(`  Warning: Failed to fetch statuses for board ${board.id}: ${e.message}`);
          }
        }
        if (!statusId) { console.log(`  Warning: No TO DO status on board ${board.id}`); continue; }

        const start = i * tasksPerMilestone;
        const end   = Math.min(start + tasksPerMilestone, tasksData.length);
        const msTasks = tasksData.slice(start, end);
        if (msTasks.length === 0) continue;

        console.log(`  ${ms.project_short_title} → ${ms.milestone_title} (${msTasks.length} tasks)`);

        for (const t of msTasks) {
          try {
            const createdAt = this.randomDateInPeriod(ms.started_at, ms.finished_at);
            const deadline  = this.randomDateInPeriod(createdAt, ms.finished_at);

            const createRes: any = await this.taskMgmtApiClient.executeRequest(
                'POST', '/api/tasks',
                { title: t.task_title, position: totalTasks, board_id: board.id, status_id: statusId }
            );
            const taskId = createRes?.data?.id || createRes?.id;

            try {
              const updatePayload: any = {
                title: t.task_title,
                description: `<div style="font-size: 11pt; font-family: Raleway, sans-serif;" data-node-font-size="11pt" data-node-font-family="Raleway, sans-serif">${t.task_description}</div>`,
                deadline,
                fields: ['description','task_type','responsibles','watchers','sprint_point','urgency','tags','deadline'],
                checklistSections: []
              };
              if (this.taskTypeIds.length > 0) updatePayload.task_type_id = this.taskTypeIds[Math.floor(Math.random()*this.taskTypeIds.length)];
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
                // Statuses already ensured at board setup, just fetch them
                const statuses = await this.fetchStatusesWithRetry(board.id);
                const target = statuses.find((s: any) => s.type === targetType);
                if (target) {
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
                    assignees: [],
                    watchers: [],
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
                                  f === 'urgency' && updatePayload.priority_id ? updatePayload.priority_id : ''
                    })),
                    checklistSections: [],
                    positionIndex: { destinationIndex: 0, sourceIndex: 0 },
                    source_status_id: target.id,
                    assignee_ids: [],
                    watcher_ids: []
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
        console.log(`  ✗ Failed to process milestone ${ms.milestone_title}: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n\n=== Task Creation Summary (Milestones) ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
  }
}
