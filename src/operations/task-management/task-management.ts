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
 * Canonical statuses per board (positions are 0-based).
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
 * Timer categories for time tracking.
 */
const TIMER_CATEGORIES = [
    { title: 'Development',    icon: 'ItHIcon',           color: '#38a09d' },
    { title: 'Research',       icon: 'CheckingHIcon',     color: '#F6BF26' },
    { title: 'Documentation',  icon: 'ClusterDocsHIcon',  color: '#8AA657' },
    { title: 'Testing',        icon: 'BugHIcon',          color: '#EA787F' },
    { title: 'Meeting',        icon: 'UserMultiHIcon',    color: '#8E6BAC' },
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
        this.taskMgmtApiClient = new ApiClient(
            authService,
            'https://task-management-backend.innoscripta.com'
        );
    }

    // --------------------------------------------------------------------------
    // Helpers
    // --------------------------------------------------------------------------

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Build filter params (API expects filter[board_id]=...) */
    private filterByBoardId(boardId: number) {
        // Most HTTP clients handle bracketed keys fine. If not, ApiClient must stringify.
        return { 'filter[board_id]': String(boardId) };
    }

    // --------------------------------------------------------------------------
    // Retry & paging
    // --------------------------------------------------------------------------

    /**
     * Fetch boards with paging and retry until readiness.
     */
    private async fetchBoardsWithRetry(options?: {
        retries?: number;
        baseDelayMs?: number;
        jitterMs?: number;
        expectedMilestoneCount?: number;
        readinessRatio?: number;
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

                for (let page = 1; page <= maxPages; page++) {
                    const res: any = await this.taskMgmtApiClient.executeRequest(
                        'GET',
                        '/api/boards',
                        { include: 'pinned', page: page.toString() }
                    );
                    const chunk = res?.data || res || [];
                    if (Array.isArray(chunk)) {
                        all.push(...chunk);
                        if (chunk.length === 0) break;
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
     * Fetch statuses for a board with proper filtering and retries.
     * IMPORTANT: The API expects filter[board_id]=..., not board_id=...
     * We also defensively filter by s.board_id on the client side to avoid misleading results.
     */
    private async fetchStatusesWithRetry(boardId: number, retries = 5, delayMs = 800) {
        let lastError: any = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res: any = await this.taskMgmtApiClient.executeRequest(
                    'GET',
                    '/api/statuses',
                    this.filterByBoardId(boardId)
                );
                const raw = res?.data || res || [];
                const list = Array.isArray(raw) ? raw : [raw];
                const statuses = list.filter((s: any) => Number(s.board_id) === Number(boardId));

                if (statuses.length > 0) return statuses;

                // If empty, wait and retry
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
     * Ensure canonical 3 statuses on the given board WITHOUT deleting anything.
     * - If board has no statuses → create all 3.
     * - If some exist → update their title/position/type/color/timer_action to match desired.
     * - Idempotent: same code safe to run multiple times.
     */
    private async ensureThreeStatuses(boardId: number): Promise<void> {
        const desired = TASK_STATUSES;

        // read current statuses strictly for this board
        let existing: any[] = [];
        try {
            existing = await this.fetchStatusesWithRetry(boardId, 5, 800);
            // defensive filter (should already be filtered)
            existing = (existing || []).filter(s => Number(s.board_id) === Number(boardId));
            console.log(`    Board ${boardId}: existing statuses = ${existing.length}`);
        } catch (e: any) {
            console.log(`[ensureThreeStatuses] read failed for board ${boardId}: ${e?.message || e}`);
            existing = [];
        }

        // map by type and by title for easy lookups
        const byType  = new Map(existing.map(s => [String(s.type).toLowerCase(), s]));
        const byTitle = new Map(existing.map(s => [String(s.title).toUpperCase(), s]));

        // upsert each desired status
        for (const d of desired) {
            const keyType = String(d.type).toLowerCase();
            const keyTitle = String(d.title).toUpperCase();

            // prefer match by type; fallback to title
            const match = byType.get(keyType) || byTitle.get(keyTitle);

            if (!match) {
                // create
                try {
                    const createRes: any = await this.taskMgmtApiClient.executeRequest(
                        'POST',
                        '/api/statuses',
                        {
                            title: d.title,
                            position: d.position,   // 0-based
                            board_id: boardId,
                            color: d.color,
                            type: d.type,
                            timer_action: d.timer_action,
                        }
                    );
                    const createdId = createRes?.data?.id || createRes?.id;
                    console.log(`    created → ${d.title} (id=${createdId}, pos=${d.position})`);
                } catch (err: any) {
                    console.log(`    create failed → ${d.title} on board ${boardId}: ${err?.message || err}`);
                }
            } else {
                // update if any field differs
                const needsUpdate =
                    match.title !== d.title ||
                    Number(match.position) !== Number(d.position) ||
                    String(match.type) !== d.type ||
                    String(match.color) !== d.color ||
                    String(match.timer_action || '') !== String(d.timer_action || '');

                if (needsUpdate) {
                    try {
                        await this.taskMgmtApiClient.executeRequest(
                            'PUT',
                            `/api/statuses/${match.id}`,
                            {
                                title: d.title,
                                position: d.position,
                                color: d.color,
                                type: d.type,
                                timer_action: d.timer_action,
                            }
                        );
                        console.log(`    updated → ${d.title} (id=${match.id}, pos=${d.position})`);
                    } catch (err: any) {
                        console.log(`    update failed → ${d.title} on board ${boardId}: ${err?.message || err}`);
                    }
                } else {
                    console.log(`    ok → ${d.title} (id=${match.id}, pos=${d.position})`);
                }
            }
        }

        // verify
        try {
            await this.sleep(600);
            const finalList = await this.fetchStatusesWithRetry(boardId, 3, 600);
            const finalPretty = (finalList || [])
                .filter(s => Number(s.board_id) === Number(boardId))
                .sort((a: any, b: any) => Number(a.position) - Number(b.position))
                .map((s: any) => `${s.position}:${s.title}[${s.type}]`)
                .join(', ');
            console.log(`    verify → board ${boardId} statuses (${(finalList || []).length} total, this board may show 3): ${finalPretty}`);
        } catch { /* noop */ }
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
            console.log('User consent approved for task management\n');
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
                const taskTypeId = response?.data?.id || response?.id;
                if (taskTypeId) this.taskTypeIds.push(taskTypeId);
                console.log(`  Created: ${taskType.title} (ID: ${taskTypeId})`);
                created++;
            } catch (error: any) {
                console.log(`  Failed to create ${taskType.title}: ${error.message}`);
                errors++;
            }
            await this.sleep(50); // minor throttle
        }

        console.log(`\nCreated ${created} task types (errors: ${errors})\n`);
    }

    async createTimerCategories(roleMappings?: Array<{ id: string, title: string }>): Promise<void> {
        console.log('\n=== Creating Timer Categories (Activity Types) ===\n');

        let created = 0;
        let errors = 0;

        const boardIds: number[] = this.boardMappings.map(b => b.id);
        console.log(`Will assign timer categories to ${boardIds.length} boards\n`);

        const roleIds: number[] = roleMappings ? roleMappings.map(r => parseInt(r.id, 10)) : [];
        console.log(`Will assign timer categories to ${roleIds.length} roles\n`);

        for (const category of TIMER_CATEGORIES) {
            try {
                const payload: any = {
                    title: category.title,
                    icon: category.icon,
                    color: category.color,
                    user_ids: [],
                    role_ids: roleIds,
                    board_ids: boardIds,
                    excluded_user_ids: []
                };

                const response: any = await this.taskMgmtApiClient.executeRequest(
                    'POST',
                    '/api/timer-categories',
                    payload
                );
                const categoryId = response?.data?.id || response?.id;
                console.log(`  Created: ${category.title} (ID: ${categoryId})`);
                created++;
            } catch (error: any) {
                console.log(`  Failed to create ${category.title}: ${error.message}`);
                errors++;
            }
            await this.sleep(50);
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
                console.log(`    Added activity types: ${activityTypesForSFF.join(', ')}`);
                created++;
            } catch (error: any) {
                console.log(`    Failed to create restriction for role ${role.title}: ${error.message}`);
                errors++;
            }
            await this.sleep(30);
        }

        console.log(`\n=== Activity Type Restrictions Summary ===\n  - Restrictions created: ${created}\n  - Errors: ${errors}\n`);
    }

    // --------------------------------------------------------------------------
    // Core: Boards & Statuses (no folder creation/reassignment here)
    // --------------------------------------------------------------------------

    /**
     * Fetch milestone boards, map them once per milestone, then ensure statuses on all.
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

            // Deduplicate by board id
            const uniqueBoards = Array.from(new Map(milestoneBoards.map((b: any) => [b.id, b])).values());
            console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length} | Unique: ${uniqueBoards.length}\n`);

            console.log('Board details (unique):');
            uniqueBoards.forEach((b: any) =>
                console.log(`  - "${b.title || b.name}" (ID: ${b.id}, Type: ${b.external_type || b.type}, External ID: ${b.external_id}, Folder: ${b.folder_id})`)
            );
            console.log('');

            const mappedMilestones = new Set<string>();

            for (const board of uniqueBoards) {
                const title = board.title || board.name;

                const matchingMilestone =
                    milestoneMappings.find(m => m.task_id?.toString() === (board.external_id ?? '').toString()) ||
                    milestoneMappings.find(m => {
                        const normalized = title?.replace(/^\d+\.\s*/, '');
                        return m.milestone_title === normalized;
                    });

                if (!matchingMilestone) {
                    console.log(`  Skipping: could not match milestone for board "${title}" (ID: ${board.id})`);
                    continue;
                }

                const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;
                if (mappedMilestones.has(milestoneKey)) {
                    console.log(`  Skipping duplicate board "${title}" (ID: ${board.id})`);
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
                console.log(`Mapped Board: "${title}" (ID: ${board.id})`);
                totalBoards++;
            }

            console.log(`\nWaiting 3000ms for boards to be fully ready...\n`);
            await this.sleep(3000);

            console.log('Ensuring statuses on each mapped board...\n');
            for (const boardMapping of this.boardMappings) {
                try {
                    await this.ensureThreeStatuses(boardMapping.id);
                    totalStatusesEnsured += 3;
                    await this.sleep(50);
                } catch (stErr: any) {
                    console.log(`  Failed to ensure statuses for board ${boardMapping.id}: ${stErr.message}`);
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

        this.saveBoardMappings();
    }

    /**
     * Fetch & cache milestone boards only and ensure their statuses.
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

            const mappedMilestones = new Set<string>();

            for (const board of milestoneBoards) {
                const title = board.title || board.name;
                const matchingMilestone =
                    milestoneMappings.find(m => m.task_id?.toString() === (board.external_id ?? '').toString()) ||
                    milestoneMappings.find(m => title?.replace(/^\d+\.\s*/, '') === m.milestone_title);

                if (!matchingMilestone) {
                    console.log(`  Skipping cache entry for "${title}" (ID: ${board.id}) – no milestone match`);
                    continue;
                }

                const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;
                if (mappedMilestones.has(milestoneKey)) {
                    console.log(`  Skipping duplicate board "${title}" (ID: ${board.id})`);
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

            console.log(`\nWaiting 2000ms for boards to be fully ready...\n`);
            await this.sleep(2000);

            console.log('Ensuring statuses on cached boards...\n');
            for (const boardMapping of this.boardMappings) {
                try {
                    await this.ensureThreeStatuses(boardMapping.id);
                    totalStatusesEnsured += 3;
                    await this.sleep(50);
                } catch (e: any) {
                    console.log(`    Failed to ensure statuses for board ${boardMapping.id}: ${e.message}`);
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

        // Simple CSV parser supporting quotes and escaped quotes
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
     * Create tasks linked to work packages. Assumes milestone boards exist.
     * Robust to missing statuses: will ensure and refetch if needed.
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
        const boardStatusCache = new Map<number, any[]>(); // Cache statuses per board

        for (const wp of workPackageIntervals) {
            try {
                const board = this.boardMappings.find(b => b.project_short_title === wp.project_short_title && b.milestone_title === wp.milestone_title);
                if (!board) {
                    console.log(`  Warning: Board not found for ${wp.project_short_title} / ${wp.milestone_title} → ${wp.work_package_title}`);
                    continue;
                }

                // Fetch (or refetch) statuses for this board
                let statuses = boardStatusCache.get(board.id);
                if (!statuses || statuses.length === 0) {
                    statuses = await this.fetchStatusesWithRetry(board.id);
                    if (!statuses || statuses.length === 0) {
                        console.log(`  Info: No statuses on board ${board.id}. Ensuring canonical statuses...`);
                        await this.ensureThreeStatuses(board.id);
                        statuses = await this.fetchStatusesWithRetry(board.id);
                    }
                    boardStatusCache.set(board.id, statuses);
                }

                // Ensure TO DO status id
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

                        // Create task at TO DO
                        const createRes: any = await this.taskMgmtApiClient.executeRequest(
                            'POST', '/api/tasks',
                            { title: t.task_title, position: totalTasks, board_id: board.id, status_id: statusId! }
                        );
                        const taskId = createRes?.data?.id || createRes?.id;

                        await this.sleep(30);

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

                            // Decide target status based on dates
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
                            console.log(`    Failed to update task details: ${updErr.message}`);
                        }

                        totalTasks++;
                        await this.sleep(20);
                    } catch (createErr: any) {
                        console.log(`    Failed to create task "${t.task_title}": ${createErr.message}`);
                        errors++;
                        await this.sleep(50);
                    }
                }

            } catch (err: any) {
                console.log(`  Failed to process WP ${wp.work_package_title}: ${err.message}`);
                errors++;
            }
        }

        console.log(`\n\n=== Task Creation Summary ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
    }

    /**
     * Create tasks directly in milestone boards (no work-packages).
     * Creates 10 generic tasks per milestone.
     * Robust to missing statuses: will ensure and refetch if needed.
     */
    async createTasksForMilestones(csvPath?: string, projectMappings?: ProjectMapping[]): Promise<void> {
        console.log('\n=== Creating Tasks for Milestones (No Work Packages) ===\n');

        const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json');
        if (!milestoneMappings || milestoneMappings.length === 0) {
            console.log('No milestone mappings found. Skipping task creation.\n');
            return;
        }
        console.log(`Found ${milestoneMappings.length} milestones\n`);

        const isGerman = csvPath?.includes('data-de') || csvPath?.includes('sff-data-de');

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
        const boardStatusCache = new Map<number, any[]>(); // Cache statuses per board

        const cachedBoards = this.loadFromCache<BoardMapping[]>('./data/cache/task-board-mappings.json') || [];
        this.boardMappings = cachedBoards;
        console.log(`Loaded ${this.boardMappings.length} board mappings from cache\n`);

        const partnershipEmployees = this.loadFromCache<any[]>('./data/cache/user-partnership-pms.json') || [];
        console.log(`Loaded ${partnershipEmployees.length} partnership employee assignments\n`);

        const uniqueEmployees = Array.from(new Map(partnershipEmployees.map(e => [e.user_id, e])).values());
        console.log(`Found ${uniqueEmployees.length} unique employees to assign to tasks\n`);

        for (let i = 0; i < milestoneMappings.length; i++) {
            const ms = milestoneMappings[i];

            try {
                console.log(`\n[Milestone ${i + 1}/${milestoneMappings.length}] Looking for board: project="${ms.project_short_title}", milestone="${ms.milestone_title}"`);
                const board = this.boardMappings.find(b => b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title);
                if (!board) {
                    console.log(`  Warning: Board not found for ${ms.project_short_title} / ${ms.milestone_title}`);
                    continue;
                }
                console.log(`  Found board ID: ${board.id} (${board.name})`);

                // Fetch (or refetch) statuses for this board
                let statuses = boardStatusCache.get(board.id);
                if (!statuses || statuses.length === 0) {
                    statuses = await this.fetchStatusesWithRetry(board.id);
                    if (!statuses || statuses.length === 0) {
                        console.log(`  Info: No statuses on board ${board.id}. Ensuring canonical statuses...`);
                        await this.ensureThreeStatuses(board.id);
                        statuses = await this.fetchStatusesWithRetry(board.id);
                    }
                    boardStatusCache.set(board.id, statuses);
                    console.log(`  Cached ${statuses.length} statuses for board ${board.id}`);
                }

                // Ensure TO DO status id
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

                        await this.sleep(25);

                        try {
                            const updatePayload: any = {
                                title: t.title,
                                description: `<div style="font-size: 11pt; font-family: Raleway, sans-serif;" data-node-font-size="11pt" data-node-font-family="Raleway, sans-serif">${t.description}</div>`,
                                deadline,
                                fields: ['description','task_type','responsibles','watchers','sprint_point','urgency','tags','deadline'],
                                checklistSections: []
                            };

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

                            // Move status based on dates
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
                                const target = statuses.find((s: any) => s.type === targetType);
                                if (target) {
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
                            console.log(`    Failed to update task details: ${updErr.message}`);
                        }

                        totalTasks++;
                        await this.sleep(25);
                    } catch (createErr: any) {
                        console.log(`    Failed to create task "${t.title}": ${createErr.message}`);
                        errors++;
                        await this.sleep(50);
                    }
                }

            } catch (err: any) {
                console.log(`  Failed to process milestone ${ms.milestone_title}: ${err.message}`);
                errors++;
            }
        }

        console.log(`\n\n=== Task Creation Summary (Milestones) ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
    }
}
