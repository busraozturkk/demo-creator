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
    external_id?: number;
    external_type?: string;
    type?: string;
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
 * Our canonical 3 statuses for project boards (positions are 0-based).
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
    { title: 'Development',    icon: 'ItHIcon',           color: '#38a09d' },
    { title: 'Research',       icon: 'CheckingHIcon',     color: '#F6BF26' },
    { title: 'Documentation',  icon: 'ClusterDocsHIcon',  color: '#8AA657' },
    { title: 'Testing',        icon: 'BugHIcon',          color: '#EA787F' },
    { title: 'Meeting',        icon: 'UserMultiHIcon',    color: '#8E6BAC' },
];

export class TaskManagementOperation extends BaseOperation {
    private taskMgmtApiClient: ApiClient;
    private mainApiClient: ApiClient; // For PCT/main backend endpoints
    private folderMappings: FolderMapping[] = [];
    private boardMappings: BoardMapping[] = [];
    private taskTypeIds: number[] = [];
    private priorityIds: number[] = [];
    private allowedActivityTypes: string[] = [];
    private timerCategoryIds: number[] = []; // keep created timer category ids

    // ---- perf: concurrency limit for fast timer posting ----
    private concurrency = 12; // hızlı ama makul; istersen 20-30 yapılabilir

    constructor(authService: AuthService) {
        super();
        this.taskMgmtApiClient = new ApiClient(
            authService,
            'https://task-management-backend.innoscripta.com'
        );
        this.mainApiClient = new ApiClient(
            authService,
            'https://api.innoscripta.com'
        );
    }

    // --------------------------------------------------------------------------
    // Helpers
    // --------------------------------------------------------------------------
    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // aksan/umlaut normalize + baştaki sıra numarası at
    private normalizeTitle(s?: string): string {
        const t = (s || '').toString().trim().replace(/^\d+\.\s*/, '').toLowerCase();
        return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    private async deleteBoard(boardId: number): Promise<void> {
        try {
            await this.taskMgmtApiClient.executeRequest(
                'DELETE',
                `/api/boards/${boardId}?delete_dependencies=true`
            );
            console.log(`  deleted board ${boardId}`);
        } catch (err: any) {
            const msg = err?.message || String(err);
            if (msg.includes('Unexpected end of JSON input')) {
                console.log(`  delete returned empty body; treating as success for board ${boardId}`);
                return;
            }
            console.log(`  delete failed for board ${boardId}: ${msg}`);
        }
    }

    private saveFolderMappings(): void {
        this.saveToCache('./data/cache/task-folder-mappings.json', this.folderMappings);
        console.log(`Saved ${this.folderMappings.length} folder mappings to cache`);
    }

    private saveBoardMappings(): void {
        this.saveToCache('./data/cache/task-board-mappings.json', this.boardMappings);
        console.log(`Saved ${this.boardMappings.length} board mappings to cache\n`);
    }

    // ---- date/hour helpers ----
    private *iterateBusinessDaysDesc(fromISO: string, daysBack: number): Generator<string> {
        let d = new Date(fromISO + 'T00:00:00');
        let left = daysBack;
        while (left > 0) {
            const dow = d.getDay(); // 0 Sun, 6 Sat
            if (dow !== 0 && dow !== 6) {
                yield d.toISOString().slice(0,10);
                left--;
            }
            d.setDate(d.getDate() - 1);
        }
    }

    private businessDaysBetweenInclusive(startISO: string, endISO: string): string[] {
        const out: string[] = [];
        const s = new Date(startISO + 'T00:00:00');
        const e = new Date(endISO   + 'T00:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0,10));
        }
        return out;
    }

    private splitHoursRandom(totalHours: number, bucketCount: number): number[] {
        if (bucketCount <= 0) return [];
        if (bucketCount === 1) return [totalHours];
        const weights = Array.from({length: bucketCount}, () => Math.random() + 0.01);
        const sum = weights.reduce((a,b)=>a+b,0);
        return weights.map(w => (w/sum)*totalHours);
    }

    // ---- assignment & status checks for time entries ----
    private async isUserAssignedToAnyTaskOnBoard(boardId: number, userId: number): Promise<boolean> {
        try {
            const r: any = await this.taskMgmtApiClient.executeRequest(
                'GET', '/api/tasks', { 'filter[board_id]': String(boardId), 'filter[assignee_id]': String(userId) }
            );
            const arr = r?.data || r || [];
            if (Array.isArray(arr)) return arr.length > 0;
        } catch { /* fall back */ }

        try {
            const all: any = await this.taskMgmtApiClient.executeRequest(
                'GET', '/api/tasks', { 'filter[board_id]': String(boardId), 'include': 'assignees' }
            );
            const tasks = all?.data || all || [];
            return tasks.some((t: any) =>
                (t.assignees || t.responsibles || []).some((u: any) => Number(u?.id || u?.user_id) === userId)
            );
        } catch (e:any) {
            console.log(`  ! assignment check failed for board ${boardId}: ${e?.message || e}`);
            return false;
        }
    }

    private async boardHasActiveOrDoneTasks(boardId: number): Promise<boolean> {
        try {
            const r: any = await this.taskMgmtApiClient.executeRequest(
                'GET', '/api/tasks', { 'filter[board_id]': String(boardId), 'include': 'status' }
            );
            const tasks = r?.data || r || [];
            if (!Array.isArray(tasks)) return !!tasks?.status && ['active','completed'].includes(tasks.status?.type);
            return tasks.some((t: any) => {
                const st = t?.status || t?.current_status;
                const type = st?.type || st?.status_type;
                return type === 'active' || type === 'completed';
            });
        } catch (e:any) {
            console.log(`  ! status scan failed for board ${boardId}: ${e?.message || e}`);
            return false;
        }
    }

    // ---- milestone responsibles helpers ----
    private getMilestoneResponsibleUserIds(ms: any): number[] {
        const tryArrays: any[] = [
            ms?.responsible_user_ids,
            ms?.assigned_user_ids,
            ms?.assignees,
            ms?.employees,
            ms?.responsibles,
            ms?.assigned_employees
        ].filter(Boolean);

        for (const arr of tryArrays) {
            if (Array.isArray(arr)) {
                if (arr.length === 0) continue;
                if (typeof arr[0] === 'number') return arr as number[];
                const ids = (arr as any[]).map(x => Number(x?.user_id ?? x?.id)).filter(Boolean);
                if (ids.length) return ids;
            }
        }
        return [];
    }

    private getMilestoneResponsibles(ms: any): Array<{id:number; name?:string}> {
        const ids = this.getMilestoneResponsibleUserIds(ms);
        return ids.map(id => ({ id, name: undefined }));
    }

    // --------------------------------------------------------------------------
    // pct-tree helpers: project title -> milestone(id) resolution
    // --------------------------------------------------------------------------
    private async fetchPctTreeByProjectTitle(projectTitle: string, partnerId?: string): Promise<any | null> {
        try {
            if (partnerId) this.taskMgmtApiClient.setPartnerId(partnerId);
            const res: any = await this.taskMgmtApiClient.executeRequest(
                'GET',
                '/api/pct-tree',
                { title: projectTitle, limit: '200', is_project_assigned: '1', page: '1' }
            );
            const data = res?.data || res || [];
            if (Array.isArray(data) && data.length > 0) return data[0];
            return null;
        } catch (e:any) {
            console.log(`[pct-tree] fetch failed for "${projectTitle}": ${e?.message || e}`);
            return null;
        }
    }

    private findChildMilestoneIdByTitle(pctTreeRoot: any, milestoneTitle: string): number | null {
        if (!pctTreeRoot?.children || !Array.isArray(pctTreeRoot.children)) return null;
        const norm = this.normalizeTitle(milestoneTitle);
        for (const child of pctTreeRoot.children) {
            const ct = this.normalizeTitle(child?.title);
            if (ct === norm) return Number(child?.id) || null;
        }
        const loose = pctTreeRoot.children.find((c: any) =>
            this.normalizeTitle(c?.title).includes(norm) || norm.includes(this.normalizeTitle(c?.title))
        );
        return loose ? Number(loose.id) || null : null;
    }

    private getProjectTitleFromShort(projectMappings: ProjectMapping[] | undefined, projectShort: string): string | undefined {
        if (!projectMappings?.length) return undefined;
        const hit = projectMappings.find(p => this.normalizeTitle(p.short_title) === this.normalizeTitle(projectShort));
        return hit?.title;
    }

    /**
     * PctMilestone id’yi **yalnızca pct-tree** üzerinden çöz. (Doğru id uzayı)
     * Yedek: board.external_id (sadece external_type === 'Milestone' ise)
     */
    private async resolvePctMilestoneId(
        ms: { project_short_title: string; milestone_title: string; task_id?: number; pct_milestone_id?: number; milestone_id?: number },
        projectMappings?: ProjectMapping[],
        boardForMs?: BoardMapping,
        partnerId?: string
    ): Promise<number | null> {
        // 1) projectMappings → gerçek proje title
        const mappedProjectTitle = this.getProjectTitleFromShort(projectMappings, ms.project_short_title);
        if (mappedProjectTitle) {
            const tree = await this.fetchPctTreeByProjectTitle(mappedProjectTitle, partnerId);
            const byTree = tree ? this.findChildMilestoneIdByTitle(tree, ms.milestone_title) : null;
            if (byTree) {
                console.log(`  [RESOLVE] pct-tree child id via mapped title "${mappedProjectTitle}" → ${byTree}`);
                return byTree;
            }
        }

        // 2) pct-tree’i kısa adla dene (çoğu instance’ta eşleşiyor)
        {
            const tree = await this.fetchPctTreeByProjectTitle(ms.project_short_title, partnerId);
            const byTree = tree ? this.findChildMilestoneIdByTitle(tree, ms.milestone_title) : null;
            if (byTree) {
                console.log(`  [RESOLVE] pct-tree child id via short_title "${ms.project_short_title}" → ${byTree}`);
                return byTree;
            }
        }

        // 3) board external_id Milestone ise (son çare)
        if (boardForMs?.external_id && String(boardForMs?.external_type || boardForMs?.type || '').toLowerCase().includes('milestone')) {
            const ext = Number(boardForMs.external_id);
            if (ext) {
                console.log(`  [RESOLVE] fallback board.external_id (Milestone) → ${ext}`);
                return ext;
            }
        }

        // DİKKAT: PCT main milestone_id / task_id KULLANILMIYOR (yanlış id uzayı → timer null)
        console.log('  [RESOLVE] could not resolve pct-tree child id → null');
        return null;
    }

    // --------------------------------------------------------------------------
    // PCT tree → milestone IDs (legacy util; tutuldu)
    // --------------------------------------------------------------------------
    private async fetchPctMilestoneIdsByProjectTitle(projectTitle: string, partnerId?: string): Promise<number[]> {
        if (partnerId) this.taskMgmtApiClient.setPartnerId(partnerId);

        const res: any = await this.taskMgmtApiClient.executeRequest(
            'GET',
            '/api/pct-tree',
            { title: projectTitle, limit: '200', is_project_assigned: '1', page: '1' }
        );
        const data = res?.data || res || [];
        const children = Array.isArray(data) && data[0]?.children ? data[0].children : [];
        const ids = children.map((c: any) => Number(c?.id)).filter(Boolean);
        console.log(`[pct-tree] "${projectTitle}" → ${ids.length} milestone(s): ${ids.join(', ')}`);
        return ids;
    }

    // --------------------------------------------------------------------------
    // Retry & paging helpers
    // --------------------------------------------------------------------------
    private async fetchBoardsWithRetry(options?: {
        retries?: number;
        baseDelayMs?: number;
        jitterMs?: number;
        expectedMilestoneCount?: number;
        readinessRatio?: number;   // 0..1
        maxPages?: number;
    }): Promise<any[]> {
        const {
            retries = 6,
            baseDelayMs = 900,
            jitterMs = 250,
            expectedMilestoneCount = 0,
            readinessRatio = 0.9,
            maxPages = 8,
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
                await this.sleep(delay);
            }
        }

        if (lastError) {
            throw new Error(`Failed to fetch boards after ${retries} attempts: ${lastError.message || lastError}`);
        }
        throw new Error(`Boards not ready after ${retries} attempts (not enough Milestone boards visible)`);
    }

    private async fetchStatusesWithRetry(boardId: number, retries = 4, delayMs = 600) {
        let lastError: any = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res: any = await this.taskMgmtApiClient.executeRequest(
                    'GET',
                    '/api/statuses',
                    { 'filter[board_id]': boardId.toString() }
                );
                const statuses = res?.data || res || [];
                if (Array.isArray(statuses)) {
                    if (statuses.length > 0) return statuses;
                } else if (statuses) {
                    return [statuses];
                }
            } catch (err: any) {
                lastError = err;
            }
            if (attempt < retries) {
                await this.sleep(delayMs);
            }
        }
        if (lastError) {
            throw new Error(`Failed to fetch statuses for board ${boardId} after ${retries} attempts: ${lastError.message || lastError}`);
        }
        return [];
    }

    private async ensureThreeStatuses(boardId: number): Promise<void> {
        console.log(`  ensuring statuses for board ${boardId}`);

        let existing: any[] = [];
        try {
            existing = await this.fetchStatusesWithRetry(boardId, 5, 600);
            console.log(`    found ${existing.length} statuses on board ${boardId}`);
        } catch (e: any) {
            console.log(`    initial status read failed for board ${boardId}: ${e?.message || e}`);
            existing = [];
        }

        const byTitle = new Map<string, any>();
        const byType = new Map<string, any>();
        for (const s of existing) {
            if (s?.title) byTitle.set(this.normalizeTitle(s.title), s);
            if (s?.type)  byType.set(s.type, s);
        }

        for (const desired of TASK_STATUSES) {
            const normTitle = this.normalizeTitle(desired.title);
            const match = byTitle.get(normTitle) || byType.get(desired.type);
            if (!match) {
                try {
                    const createRes: any = await this.taskMgmtApiClient.executeRequest(
                        'POST',
                        '/api/statuses',
                        {
                            title: desired.title,
                            position: desired.position,
                            board_id: boardId,
                            color: desired.color,
                            type: desired.type,
                            timer_action: desired.timer_action,
                        }
                    );
                    const created = createRes?.data || createRes;
                    existing.push(created);
                    byTitle.set(normTitle, created);
                    if (created?.type) byType.set(created.type, created);
                    console.log(`    created status: ${desired.title}`);
                } catch (err: any) {
                    console.log(`    create failed for ${desired.title}: ${err?.message || err}`);
                }
            }
        }

        for (const desired of TASK_STATUSES) {
            const normTitle = this.normalizeTitle(desired.title);
            const match = byTitle.get(normTitle) || byType.get(desired.type);
            if (!match?.id) continue;

            const needsUpdate =
                match.type !== desired.type ||
                match.color !== desired.color ||
                match.position !== desired.position ||
                (match.timer_action ?? '') !== desired.timer_action;

            if (needsUpdate) {
                try {
                    await this.taskMgmtApiClient.executeRequest(
                        'PUT',
                        `/api/statuses/${match.id}`,
                        {
                            title: desired.title,
                            position: desired.position,
                            color: desired.color,
                            type: desired.type,
                            timer_action: desired.timer_action,
                        }
                    );
                    console.log(`    updated status ${desired.title} (id: ${match.id})`);
                } catch (err: any) {
                    console.log(`    update failed for ${desired.title} (id: ${match.id}): ${err?.message || err}`);
                }
            }
        }

        try {
            const finalList = await this.fetchStatusesWithRetry(boardId, 2, 500);
            const pretty = finalList
                .map((s: any) => `${s.position}:${s.title}[${s.type}]`)
                .sort((a: string, b: string) => parseInt(a) - parseInt(b))
                .join(', ');
            console.log(`    final statuses (${finalList.length}): ${pretty}`);
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
                console.log(`  created: ${taskType.title} (id: ${taskTypeId})`);
                created++;
            } catch (error: any) {
                console.log(`  failed to create ${taskType.title}: ${error.message}`);
                errors++;
            }
        }

        console.log(`\nCreated ${created} task types (errors: ${errors})\n`);
    }

    async createTimerCategories(roleMappings?: Array<{ id: string, title: string }>): Promise<void> {
        console.log('\n=== Creating Timer Categories (Activity Types) ===\n');

        let created = 0;
        let errors = 0;

        const boardIds: number[] = this.boardMappings.map(b => b.id);
        console.log(`Will assign timer categories to ${boardIds.length} boards\n`);

        const roleIds: number[] = roleMappings ? roleMappings.map(r => parseInt(r.id)) : [];
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
                const categoryId = response.data?.id || response.id;
                if (categoryId) this.timerCategoryIds.push(categoryId);
                console.log(`  created: ${category.title} (id: ${categoryId})`);
                created++;
            } catch (error: any) {
                console.log(`  failed to create ${category.title}: ${error.message}`);
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

        // pctTask yerine milestone aktivitelerini de serbest bırakmak istiyorsan ekle: 'pctMilestone'
        const activityTypesForSFF = ['task', 'timerCategory', 'pctTask'];
        let created = 0, errors = 0;

        for (const role of roleMappings) {
            try {
                console.log(`  creating restriction for role: ${role.title} (id: ${role.id})`);
                await this.taskMgmtApiClient.executeRequest(
                    'POST',
                    '/api/activity-type-restrictions',
                    { role_id: role.id, allowed_activity_types: activityTypesForSFF }
                );
                console.log(`    added activity types: ${activityTypesForSFF.join(', ')}`);
                created++;
            } catch (error: any) {
                console.log(`    failed to create restriction for role ${role.title}: ${error.message}`);
                errors++;
            }
        }

        console.log(`\n=== Activity Type Restrictions Summary ===\n  - Restrictions created: ${created}\n  - Errors: ${errors}\n`);
    }

    // --------------------------------------------------------------------------
    // Core: Boards & Statuses (no folder creation/reassignment)
    // --------------------------------------------------------------------------
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
                readinessRatio: 1.0, // Wait for ALL milestone boards
                retries: 10, // Increased retries
                baseDelayMs: 1500, // Longer base delay
                jitterMs: 500,
                maxPages: 10,
            });

            const milestoneBoards = boards.filter((b: any) => (b.external_type || b.type) === 'Milestone');

            // Debug: Log all milestone board IDs
            console.log(`DEBUG - All milestone board IDs: ${milestoneBoards.map((b: any) => `${b.id}:${b.title || b.name}`).join(', ')}\n`);

            // Deduplicate by id
            const uniqueBoards = Array.from(new Map(milestoneBoards.map((b: any) => [b.id, b])).values());

            console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length} | Unique: ${uniqueBoards.length}\n`);

            // Map boards with duplicate/project-title rules
            const mappedMilestones = new Set<string>();
            const boardsToDelete: number[] = [];

            // First pass: identify boards to map and boards to delete
            for (const board of uniqueBoards) {
                const title = board.title || board.name;
                const normTitle = this.normalizeTitle(title);

                // Try to find matching milestone by external_id or title
                const matchingMilestone =
                    milestoneMappings.find(m => (m.task_id ?? '').toString() === (board.external_id ?? '').toString())
                    || milestoneMappings.find(m => {
                        const mTitle = this.normalizeTitle(m.milestone_title);
                        // Check if board title contains milestone title (handles prefixes like "3. ", "4. ", etc.)
                        return normTitle.includes(mTitle) || mTitle.includes(normTitle);
                    });

                if (!matchingMilestone) {
                    // Board doesn't match any milestone - check if it's just a project name
                    const isProjectNameOnly = projectMappings.some(p => {
                        const projTitleNorm = this.normalizeTitle(p.title);
                        const projShortNorm = this.normalizeTitle(p.short_title);
                        // Exact match or title is just project name (possibly with number prefix)
                        return normTitle === projTitleNorm || normTitle === projShortNorm;
                    });

                    if (isProjectNameOnly) {
                        console.log(`  ⊗ board "${title}" (id=${board.id}) is project name only → marking for deletion`);
                        boardsToDelete.push(board.id);
                    } else {
                        console.log(`  ⊗ could not match milestone for board "${title}" (id=${board.id}), skipping`);
                    }
                    continue;
                }

                // Check if board title is ONLY the project name (no milestone info)
                const proj = projectMappings.find(p => p.short_title === matchingMilestone.project_short_title);
                if (proj) {
                    const projTitleNorm = this.normalizeTitle(proj.title);
                    const projShortNorm = this.normalizeTitle(proj.short_title);
                    const milestoneNorm = this.normalizeTitle(matchingMilestone.milestone_title);

                    // If title matches project name but doesn't contain milestone info, delete it
                    if ((normTitle === projTitleNorm || normTitle === projShortNorm) && !normTitle.includes(milestoneNorm)) {
                        console.log(`  ⊗ board "${title}" (id=${board.id}) looks like project name → marking for deletion`);
                        boardsToDelete.push(board.id);
                        continue;
                    }
                }

                // Keep first board per milestone, delete duplicates
                const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;
                if (mappedMilestones.has(milestoneKey)) {
                    console.log(`  ⊗ duplicate for milestone "${matchingMilestone.milestone_title}" → marking board id=${board.id} for deletion`);
                    boardsToDelete.push(board.id);
                    continue;
                }

                this.boardMappings.push({
                    id: board.id,
                    folder_id: board.folder_id,
                    project_short_title: matchingMilestone.project_short_title,
                    milestone_title: matchingMilestone.milestone_title,
                    name: title,
                    external_id: board.external_id,
                    external_type: board.external_type,
                    type: board.type
                });

                mappedMilestones.add(milestoneKey);
                console.log(`  ✓ mapped board: "${title}" (id=${board.id})`);
                totalBoards++;
            }

            // Second pass: delete unwanted boards
            console.log(`\nDeleting ${boardsToDelete.length} unwanted boards...`);
            for (const boardId of boardsToDelete) {
                await this.deleteBoard(boardId);
            }

            console.log(`\nWaiting 10000ms for boards to be fully ready...\n`);
            await this.sleep(10000);

            console.log('Now ensuring statuses (upsert) on boards...\n');
            for (const boardMapping of this.boardMappings) {
                try {
                    console.log(`Processing Board: "${boardMapping.name}" (ID: ${boardMapping.id})`);
                    await this.ensureThreeStatuses(boardMapping.id);
                    totalStatusesEnsured += 3;
                    console.log(`  statuses ensured for board ${boardMapping.id}`);
                } catch (stErr: any) {
                    console.log(`  failed to ensure statuses for board ${boardMapping.id}: ${stErr.message}`);
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

    async fetchAndCacheTaskManagementStructure(projectMappings: ProjectMapping[]): Promise<void> {
        console.log('\n=== Fetching & Caching Task Management Structure (No folder creation) ===\n');

        if (!projectMappings || projectMappings.length === 0) return;

        const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json') || [];
        console.log(`Milestone mappings: ${milestoneMappings.length}\n`);

        let totalBoards = 0;
        let totalStatusesEnsured = 0;
        let errors = 0;

        try {
            const boards = await this.fetchBoardsWithRetry({
                expectedMilestoneCount: milestoneMappings.length,
                readinessRatio: 0.9,
                retries: 6,
                baseDelayMs: 900,
                jitterMs: 250,
                maxPages: 8,
            });

            const milestoneBoards = boards.filter((b: any) => (b.external_type || b.type) === 'Milestone');
            console.log(`Total boards: ${boards.length} | Milestone boards: ${milestoneBoards.length}\n`);

            const mappedMilestones = new Set<string>();

            for (const board of milestoneBoards) {
                const title = board.title || board.name;
                const normTitle = this.normalizeTitle(title);

                const matchingMilestone =
                    milestoneMappings.find(m => (m.task_id ?? '').toString() === (board.external_id ?? '').toString())
                    || milestoneMappings.find(m => this.normalizeTitle(title) === this.normalizeTitle(m.milestone_title));

                if (!matchingMilestone) {
                    console.log(`  ⊗ could not map milestone for "${title}" (id=${board.id}), skipping`);
                    continue;
                }

                const proj = projectMappings.find(p => p.short_title === matchingMilestone.project_short_title);
                const projTitleNorm = this.normalizeTitle(proj?.title);
                const projShortNorm = this.normalizeTitle(proj?.short_title);
                if (proj && (normTitle === projTitleNorm || normTitle === projShortNorm)) {
                    console.log(`  ⊗ board "${title}" (id=${board.id}) looks like project name → deleting`);
                    await this.deleteBoard(board.id);
                    continue;
                }

                const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;
                if (mappedMilestones.has(milestoneKey)) {
                    console.log(`  ⊗ duplicate board for milestone "${matchingMilestone.milestone_title}" → deleting id=${board.id}`);
                    await this.deleteBoard(board.id);
                    continue;
                }

                this.boardMappings.push({
                    id: board.id,
                    folder_id: board.folder_id,
                    project_short_title: matchingMilestone.project_short_title,
                    milestone_title: matchingMilestone.milestone_title,
                    name: title,
                    external_id: board.external_id,
                    external_type: board.external_type,
                    type: board.type
                });

                mappedMilestones.add(milestoneKey);
                totalBoards++;
            }

            console.log(`\nWaiting 10000ms for boards to be fully ready...\n`);
            await this.sleep(10000);

            console.log('Now ensuring statuses (upsert) on boards...\n');
            for (const boardMapping of this.boardMappings) {
                try {
                    await this.ensureThreeStatuses(boardMapping.id);
                    totalStatusesEnsured += 3;
                } catch (e: any) {
                    console.log(`    failed to ensure statuses for board ${boardMapping.id}: ${e.message}`);
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
                    console.log(`  ✗ ERROR: Board not found for ${wp.project_short_title} / ${wp.milestone_title} → ${wp.work_package_title}`);
                    console.log(`  Available boards: ${this.boardMappings.map(b => `${b.project_short_title}/${b.milestone_title}`).join(', ')}`);
                    continue;
                }

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
                console.log(`  DEBUG: board_id=${board.id}, status_id=${statusId}, statuses_count=${statuses.length}`);

                const assigned = empsByWP.get(wp.work_package_title) || [];

                for (const t of wpTasks) {
                    try {
                        const createdAt = this.randomDateInPeriod(wp.started_at, wp.finished_at);
                        const deadline  = this.randomDateInPeriod(createdAt, wp.finished_at);

                        const createPayload = { title: t.task_title, position: totalTasks, board_id: board.id, status_id: statusId! };
                        console.log(`    Creating task: ${t.task_title}`);
                        console.log(`    Payload: ${JSON.stringify(createPayload)}`);

                        const createRes: any = await this.taskMgmtApiClient.executeRequest(
                            'POST', '/api/tasks',
                            createPayload
                        );
                        const taskId = createRes?.data?.id || createRes?.id;
                        console.log(`    ✓ Task created with ID: ${taskId}`);

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
                            console.log(`    failed to update task details: ${updErr.message}`);
                        }

                        totalTasks++;
                    } catch (createErr: any) {
                        console.log(`    ✗ ERROR: Failed to create task "${t.task_title}"`);
                        console.log(`    Error message: ${createErr?.message || createErr}`);
                        console.log(`    Error details: ${JSON.stringify(createErr?.response?.data || createErr)}`);
                        console.log(`    Board ID: ${board.id}, Status ID: ${statusId}`);
                        errors++;
                    }
                }

            } catch (err: any) {
                console.log(`  failed to process WP ${wp.work_package_title}: ${err.message}`);
                errors++;
            }
        }

        console.log(`\n\n=== Task Creation Summary ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
    }

    async createTasksForMilestones(csvPath?: string, projectMappings?: ProjectMapping[], partnerId?: string): Promise<void> {
        console.log('\n=== Creating Tasks for Milestones (No Work Packages) ===\n');

        if (partnerId) {
            this.taskMgmtApiClient.setPartnerId(partnerId);
            this.mainApiClient.setPartnerId(partnerId);
        }

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
        const boardStatusCache = new Map<number, any[]>(); // Cache all statuses per board

        // MANDATORY WAIT: Give boards enough time to be fully created and indexed
        console.log(`\n=== MANDATORY WAIT: Giving boards time to be created ===\n`);
        console.log(`Waiting 30 seconds for all ${milestoneMappings.length} milestone boards to be fully ready...\n`);
        await this.sleep(30000);
        console.log(`Wait complete. Now fetching boards...\n`);

        try {
            const boards = await this.fetchBoardsWithRetry({
                expectedMilestoneCount: milestoneMappings.length,
                readinessRatio: 0.95,
                retries: 12,
                baseDelayMs: 2500,
                jitterMs: 500,
                maxPages: 10,
            });

            const milestoneBoards = boards.filter((b: any) => (b.external_type || b.type) === 'Milestone');
            console.log(`Fetched ${boards.length} total boards, ${milestoneBoards.length} milestone boards\n`);

            // Re-map boards
            this.boardMappings = [];
            const mappedMilestones = new Set<string>();

            for (const board of milestoneBoards) {
                const title = board.title || board.name;
                const normTitle = this.normalizeTitle(title);

                const matchingMilestone =
                    milestoneMappings.find(m => (m.task_id ?? '').toString() === (board.external_id ?? '').toString())
                    || milestoneMappings.find(m => {
                        const mTitle = this.normalizeTitle(m.milestone_title);
                        return normTitle.includes(mTitle) || mTitle.includes(normTitle);
                    });

                if (!matchingMilestone) {
                    console.log(`  ⊗ No matching milestone for board "${title}" (id=${board.id}, external_id=${board.external_id})`);
                    continue;
                }

                const milestoneKey = `${matchingMilestone.project_short_title}::${matchingMilestone.milestone_title}`;
                if (mappedMilestones.has(milestoneKey)) {
                    console.log(`  ⊗ Duplicate board for milestone "${matchingMilestone.milestone_title}", skipping id=${board.id}`);
                    continue;
                }

                this.boardMappings.push({
                    id: board.id,
                    folder_id: board.folder_id,
                    project_short_title: matchingMilestone.project_short_title,
                    milestone_title: matchingMilestone.milestone_title,
                    name: title,
                    external_id: board.external_id,
                    external_type: board.external_type,
                    type: board.type
                });

                mappedMilestones.add(milestoneKey);
                console.log(`  ✓ Mapped board "${title}" (id=${board.id}) to milestone "${matchingMilestone.milestone_title}"`);
            }

            console.log(`\nSuccessfully mapped ${this.boardMappings.length} boards from fresh fetch\n`);
            this.saveBoardMappings();

            // Ensure statuses on newly mapped boards
            console.log(`\nEnsuring statuses on ${this.boardMappings.length} newly mapped boards...\n`);
            for (const boardMapping of this.boardMappings) {
                try {
                    console.log(`Processing Board: "${boardMapping.name}" (ID: ${boardMapping.id})`);
                    await this.ensureThreeStatuses(boardMapping.id);
                    console.log(`  ✓ statuses ensured for board ${boardMapping.id}`);
                } catch (stErr: any) {
                    console.log(`  ✗ failed to ensure statuses for board ${boardMapping.id}: ${stErr.message}`);
                }
            }
        } catch (err: any) {
            console.log(`Failed to fetch fresh boards: ${err.message}\n`);
            console.log(`Attempting to load from cache as fallback...\n`);

            const cachedBoards = this.loadFromCache<BoardMapping[]>('./data/cache/task-board-mappings.json') || [];
            this.boardMappings = cachedBoards;
            console.log(`Loaded ${this.boardMappings.length} board mappings from cache\n`);

            if (this.boardMappings.length === 0) {
                console.log(`ERROR: No boards available (neither fresh nor cached). Cannot create tasks.\n`);
                return;
            }
        }

        for (let i = 0; i < milestoneMappings.length; i++) {
            const ms = milestoneMappings[i];

            try {
                console.log(`\n[Milestone ${i + 1}/${milestoneMappings.length}] Looking for board: project="${ms.project_short_title}", milestone="${ms.milestone_title}"`);

                let board = this.boardMappings.find(b => b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title);

                // Retry finding board with normalization
                if (!board) {
                    const normProjShort = this.normalizeTitle(ms.project_short_title);
                    const normMilestone = this.normalizeTitle(ms.milestone_title);

                    board = this.boardMappings.find(b =>
                        this.normalizeTitle(b.project_short_title) === normProjShort &&
                        (this.normalizeTitle(b.milestone_title) === normMilestone ||
                         this.normalizeTitle(b.milestone_title).includes(normMilestone) ||
                         normMilestone.includes(this.normalizeTitle(b.milestone_title)))
                    );
                }

                if (!board) {
                    console.log(`  Warning: Board not found for ${ms.project_short_title} / ${ms.milestone_title}`);
                    console.log(`  Available boards: ${JSON.stringify(this.boardMappings.map(b => ({ id: b.id, project: b.project_short_title, milestone: b.milestone_title })))}`);
                    continue;
                }
                console.log(`  Found board ID: ${board.id} (${board.name})`);

                let statuses = boardStatusCache.get(board.id);
                if (!statuses) {
                    try {
                        statuses = await this.fetchStatusesWithRetry(board.id);
                        boardStatusCache.set(board.id, statuses);
                        console.log(`  Cached ${statuses.length} statuses for board ${board.id}`);
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

                // Load task-year-pm-assignments to get all employees assigned to this milestone
                const taskYearPmAssignments = this.loadFromCache<any[]>('./data/cache/task-year-pm-assignments.json') || [];

                // Find all employees assigned to this milestone via task-year-pm
                const milestoneAssignments = taskYearPmAssignments.filter((assignment: any) =>
                    assignment.task_id === ms.task_id
                );

                // Get user IDs from user-task-year-pms (employees with PM allocations)
                let assigneeUserIds: number[] = [];
                try {
                    const userTaskYearPms: any = await this.mainApiClient.executeRequest(
                        'GET',
                        '/pct/api/user-task-year-pms',
                        { 'filter[task_id]': ms.task_id.toString(), 'per_page': '0' }
                    );
                    const userPms = userTaskYearPms?.data || userTaskYearPms || [];
                    assigneeUserIds = Array.from(new Set(userPms.map((pm: any) => pm.user_id).filter(Boolean)));
                    console.log(`  Found ${assigneeUserIds.length} employees assigned to milestone via PM allocations`);
                } catch (err: any) {
                    console.log(`  Warning: Could not fetch user-task-year-pms: ${err?.message || err}`);
                }

                // Fallback: use milestone responsibles from project plan if no PM assignments found
                if (assigneeUserIds.length === 0) {
                    const msResponsibles = this.getMilestoneResponsibles(ms);
                    assigneeUserIds = msResponsibles.map(r => r.id);
                }

                const assigneesFromMs = assigneeUserIds.map(userId => ({
                    id: userId,
                    organization_id: undefined,
                    email: `user${userId}@example.com`,
                    first_name: '',
                    last_name: '',
                    is_active: 1
                }));
                const assigneeIdsFromMs = assigneeUserIds;

                for (let taskIdx = 0; taskIdx < GENERIC_TASKS.length; taskIdx++) {
                    const t = GENERIC_TASKS[taskIdx];
                    try {
                        console.log(`    [Task ${taskIdx + 1}/${GENERIC_TASKS.length}] Creating "${t.title}"...`);
                        const createdAt = this.randomDateInPeriod(ms.started_at, ms.finished_at);
                        const deadline  = this.randomDateInPeriod(createdAt, ms.finished_at);

                        const createPayload = {
                            title: t.title,
                            position: totalTasks,
                            board_id: board.id,
                            status_id: statusId!
                        };
                        console.log(`    [Task] POST payload: ${JSON.stringify(createPayload)}`);

                        const createRes: any = await this.taskMgmtApiClient.executeRequest(
                            'POST', '/api/tasks',
                            createPayload
                        );
                        const taskId = createRes?.data?.id || createRes?.id;
                        console.log(`    [Task] Created with ID: ${taskId}`);

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
                                    const assignees = assigneesFromMs;
                                    const watchers  = assigneesFromMs;
                                    const assigneeIds = assigneeIdsFromMs;
                                    const watcherIds  = assigneeIdsFromMs;

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
                            console.log(`    failed to update task details: ${updErr.message}`);
                        }

                        totalTasks++;
                        console.log(`    [Task] Successfully created task "${t.title}" (total: ${totalTasks})`);
                    } catch (createErr: any) {
                        console.log(`    ERROR: Failed to create task "${t.title}": ${createErr.message}`);
                        console.log(`    ERROR details: ${JSON.stringify(createErr)}`);
                        errors++;
                    }
                }

            } catch (err: any) {
                console.log(`  failed to process milestone ${ms.milestone_title}: ${err.message}`);
                errors++;
            }
        }

        console.log(`\n\n=== Task Creation Summary (Milestones) ===\n  - Tasks created: ${totalTasks}\n  - Errors: ${errors}\n`);
    }

    // --------------------------------------------------------------------------
    // PCT id teşhisi (debug)
    // --------------------------------------------------------------------------
    async debugWhatIsThisId(id: number): Promise<void> {
        try {
            const t: any = await this.mainApiClient.executeRequest('GET', `/pct/api/tasks/${id}`, {});
            const td = t?.data || t;
            if (td?.id) {
                console.log(`[WHOIS] ${id} = PCT TASK (title="${td.title}")`);
                return;
            }
        } catch {}
        try {
            const m: any = await this.mainApiClient.executeRequest('GET', `/pct/api/milestones/${id}`, {});
            const md = m?.data || m;
            if (md?.id) {
                console.log(`[WHOIS] ${id} = PCT MILESTONE (title="${md.title}")`);
                return;
            }
        } catch {}
        console.log(`[WHOIS] ${id} = bilinmiyor (task/milestone bulunamadı — proje/board/external olabilir).`);
    }

    // --------------------------------------------------------------------------
    // Timers — FAST: activities + concurrency
    // --------------------------------------------------------------------------
    /**
     * Backend'in beklediği *tam* sırayla ve istenen headerlarla timer atar.
     * activities: [TimerCategory?, PctMilestone]
     */
    private async postTimerEntry(options: {
        dayISO: string;
        hours: number;
        userId: number;
        pctMilestoneId: number;       // zorunlu: PctMilestone id (pct-tree child id)
        timerCategoryId?: number;     // opsiyonel
        tz?: string;
        origin?: string;
        referer?: string;
        priorityHeader?: string;
    }): Promise<void> {
        const {
            dayISO,
            hours,
            userId,
            pctMilestoneId,
            timerCategoryId,
            tz = 'Europe/Istanbul',
            origin = 'https://clusterix.io',
            referer = 'https://clusterix.io/',
            priorityHeader = 'u=1, i'
        } = options;

        // 03:00’te başlat, süreden bitişi hesapla (curl ile uyumlu)
        const start = new Date(`${dayISO}T03:00:00`);
        const totalMins = Math.max(1, Math.round(hours * 60));
        const end = new Date(start.getTime() + totalMins * 60000);

        const started_at = `${dayISO} 03:00:00`;
        const finished_at = `${dayISO} ${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}:00`;

        // *** ÖNEMLİ: SIRA ***
        // TimerCategory önce, PctMilestone sonra
        const activities: Array<{id:number; type:string}> = [];
        if (typeof timerCategoryId === 'number') {
            activities.push({ id: Number(timerCategoryId), type: 'App\\Models\\TimerCategory' });
        }
        activities.push({ id: Number(pctMilestoneId), type: 'App\\Models\\PctMilestone' });

        const payload = {
            started_at,
            finished_at,
            startTimer: false,
            activities,
            user_id: Number(userId),
            device_type: 'desktop',
            device_name: 'Apple Mac',
            device_os: 'Mac',
            device_os_version: '10.15',
            device_browser_name: 'Chrome'
        };

        // log
        console.log(`    [TIMER] user=${userId} day=${dayISO} hours=${hours.toFixed(2)} ms#${pctMilestoneId} cat=${timerCategoryId ?? 'none'}`);
        console.log(`    [TIMER] payload: ${JSON.stringify(payload)}`);

        try {
            // executeRequest 4. param: ek headerlar
            const resp = await this.taskMgmtApiClient.executeRequest(
                'POST',
                '/api/timers',
                payload,
                {
                    timezone: tz,
                    origin,
                    referer,
                    priority: priorityHeader,
                    'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"macOS"'
                }
            );
            console.log(`    [TIMER] response: ${JSON.stringify(resp)}`);
        } catch (e:any) {
            console.log(`    ! TIMER failed: ${e?.message || e}`);
            if (e?.response?.data) console.log('    ! Body:', JSON.stringify(e.response.data));
            throw e;
        }
    }

    // küçük bir concurrency limiter
    private async runWithLimit<T>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
        const q = [...items];
        let idx = 0;
        const runners: Promise<void>[] = [];
        const launch = async () => {
            while (q.length) {
                const item = q.shift()!;
                const myIdx = idx++;
                try { await worker(item, myIdx); }
                catch { /* hatayı worker logluyor */ }
            }
        };
        const n = Math.max(1, limit);
        for (let i = 0; i < n; i++) runners.push(launch());
        await Promise.all(runners);
    }

    /**
     * Owner’ın responsible olduğu milestone günlerine timer ekler (HIZLI)
     */
    async addOwnerTrackedTime(options: {
        userId: number;
        totalHours: number;        // e.g. 40
        daysBack: number;          // e.g. 7 (bugün dahil geriye)
        timezone?: string;         // default Europe/Istanbul
        partnerId?: string;        // header için
        defaultTimerCategoryIndex?: number; // varsayılan 0 (Development)
        concurrencyLimit?: number; // varsayılan this.concurrency
        projectMappings?: ProjectMapping[]; // pct-tree için proje adı çözümü
    }): Promise<void> {
        const {
            userId,
            totalHours,
            daysBack,
            timezone = 'Europe/Istanbul',
            partnerId,
            defaultTimerCategoryIndex = 0,
            concurrencyLimit,
            projectMappings
        } = options;

        if (partnerId) {
            this.taskMgmtApiClient.setPartnerId(partnerId);
            this.mainApiClient.setPartnerId(partnerId);
        }

        const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json') || [];
        const cachedBoards = this.loadFromCache<BoardMapping[]>('./data/cache/task-board-mappings.json') || [];
        if (cachedBoards.length === 0 || milestoneMappings.length === 0) {
            console.log('No boards or milestones cached; aborting addOwnerTrackedTime.');
            return;
        }
        this.boardMappings = cachedBoards;

        const timerCategoryId = this.timerCategoryIds?.[defaultTimerCategoryIndex];

        const todayISO = new Date().toISOString().slice(0,10);
        const days = Array.from(this.iterateBusinessDaysDesc(todayISO, daysBack)).reverse();
        if (days.length === 0) {
            console.log('No business days in selected window.');
            return;
        }
        const dailyTarget = totalHours / days.length;

        // Gün => milestoneId listesi
        const dayToMilestoneIds = new Map<string, number[]>();

        for (const ms of milestoneMappings) {
            const msDays = this.businessDaysBetweenInclusive(ms.started_at, ms.finished_at)
                .filter(d => days.includes(d));
            if (msDays.length === 0) continue;

            const board = this.boardMappings.find(b =>
                b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title
            );
            if (!board) continue;

            // owner mı?
            const msResponsibleIds = this.getMilestoneResponsibleUserIds(ms);
            if (!msResponsibleIds.includes(userId)) continue;

            // board’ta active/done task var mı?
            const hasActiveOrDone = await this.boardHasActiveOrDoneTasks(board.id);
            if (!hasActiveOrDone) continue;

            // pct-tree tabanlı çözüm → DOĞRU id uzayı
            const milestoneId = await this.resolvePctMilestoneId(ms, projectMappings, board, partnerId);
            if (!milestoneId) continue;

            // Only add timers for past and today, not future dates
            const today = new Date().toISOString().slice(0, 10);
            const pastDays = msDays.filter(d => d <= today);

            for (const d of pastDays) {
                const arr = dayToMilestoneIds.get(d) || [];
                arr.push(milestoneId);
                dayToMilestoneIds.set(d, arr);
            }
        }

        // hızlı: her gün için milestone’lar paralel
        const allJobs: Array<{day: string, msId: number, hours: number}> = [];
        for (const d of days) {
            const msList = dayToMilestoneIds.get(d) || [];
            if (msList.length === 0) continue;
            const parts = this.splitHoursRandom(dailyTarget, msList.length);
            msList.forEach((msId, i) => {
                const h = parts[i];
                if (h > 0.01) allJobs.push({ day: d, msId, hours: h });
            });
        }

        console.log(`Scheduling ${allJobs.length} timer posts with concurrency=${concurrencyLimit ?? this.concurrency}`);
        await this.runWithLimit(allJobs, concurrencyLimit ?? this.concurrency, async (job) => {
            await this.postTimerEntry({
                dayISO: job.day,
                hours: job.hours,
                userId,
                pctMilestoneId: job.msId,
                timerCategoryId,
                tz: timezone
            });
        });

        console.log(`Tracked time done. Total target ≈ ${totalHours}h across ${days.length} business days.`);
    }

    /**
     * Add tracked time for all employees assigned to milestones (HIZLI)
     */
    async addMilestoneAssigneesTrackedTime(options: {
        totalHoursPerEmployee?: number;  // default: calculated from PM allocation
        timezone?: string;               // default Europe/Istanbul
        partnerId?: string;              // header için
        defaultTimerCategoryIndex?: number; // varsayılan 0 (Development)
        concurrencyLimit?: number;       // varsayılan this.concurrency
        projectMappings?: ProjectMapping[]; // pct-tree için proje adı çözümü
    }): Promise<void> {
        const {
            totalHoursPerEmployee,
            timezone = 'Europe/Istanbul',
            partnerId,
            defaultTimerCategoryIndex = 0,
            concurrencyLimit,
            projectMappings
        } = options;

        if (partnerId) {
            this.taskMgmtApiClient.setPartnerId(partnerId);
            this.mainApiClient.setPartnerId(partnerId);
        }

        const milestoneMappings = this.loadFromCache<any[]>('./data/cache/milestone-mappings.json') || [];
        const cachedBoards = this.loadFromCache<BoardMapping[]>('./data/cache/task-board-mappings.json') || [];
        if (cachedBoards.length === 0 || milestoneMappings.length === 0) {
            console.log('No boards or milestones cached; aborting addMilestoneAssigneesTrackedTime.');
            return;
        }
        this.boardMappings = cachedBoards;

        const timerCategoryId = this.timerCategoryIds?.[defaultTimerCategoryIndex];

        console.log('\n=== Adding Tracked Time for Milestone Assignees (FAST) ===\n');

        let totalTimersCreated = 0;
        let errors = 0;

        // toplu iş listesi
        type TimerJob = { dayISO: string; userId: number; msId: number; hours: number };
        const jobs: TimerJob[] = [];

        for (const ms of milestoneMappings) {
            try {
                const board = this.boardMappings.find(b =>
                    b.project_short_title === ms.project_short_title && b.milestone_title === ms.milestone_title
                );
                if (!board) continue;

                // pct-tree tabanlı çözüm → DOĞRU id uzayı
                const milestoneId = await this.resolvePctMilestoneId(ms, projectMappings, board, partnerId);
                if (!milestoneId) {
                    console.log(`  ⊗ could not resolve pct-tree child id for ${ms.milestone_title}, skipping`);
                    continue;
                }

                // PM allocations
                let userTaskYearPms: any[] = [];
                try {
                    const response: any = await this.mainApiClient.executeRequest(
                        'GET',
                        '/pct/api/user-task-year-pms',
                        { 'filter[task_id]': ms.task_id?.toString() ?? '', 'per_page': '0' }
                    );
                    userTaskYearPms = response?.data || response || [];
                } catch (err: any) {
                    console.log(`  ⊗ Could not fetch user-task-year-pms: ${err?.message || err}`);
                    continue;
                }

                if (userTaskYearPms.length === 0) continue;

                // business days
                const milestoneDays = this.businessDaysBetweenInclusive(ms.started_at, ms.finished_at);
                if (milestoneDays.length === 0) continue;

                for (const userPm of userTaskYearPms) {
                    const userId = userPm.user_id;
                    if (!userId) continue;

                    try {
                        const isAssigned = await this.isUserAssignedToAnyTaskOnBoard(board.id, userId);
                        if (!isAssigned) continue;

                        const pmAmount = userPm.amount || 0;
                        const hoursToDistribute = totalHoursPerEmployee ? totalHoursPerEmployee : (pmAmount * 173.333333);
                        if (hoursToDistribute <= 0) continue;

                        // Only add timers for past and today, not future dates
                        const today = new Date().toISOString().slice(0, 10);
                        const pastDays = milestoneDays.filter(day => day <= today);

                        if (pastDays.length === 0) continue;

                        const dailyHours = hoursToDistribute / pastDays.length;

                        for (const dayISO of pastDays) {
                            jobs.push({ dayISO, userId, msId: milestoneId, hours: dailyHours });
                        }
                    } catch (userErr: any) {
                        console.log(`  ! user ${userId} skipped: ${userErr?.message || userErr}`);
                        errors++;
                    }
                }

            } catch (msErr: any) {
                console.log(`  ! Failed to process milestone ${ms.milestone_title}: ${msErr?.message || msErr}`);
                errors++;
            }
        }

        console.log(`Posting ${jobs.length} timers with concurrency=${concurrencyLimit ?? this.concurrency} ...`);
        await this.runWithLimit(jobs, concurrencyLimit ?? this.concurrency, async (job) => {
            try {
                await this.postTimerEntry({
                    dayISO: job.dayISO,
                    hours: job.hours,
                    userId: job.userId,
                    pctMilestoneId: job.msId,
                    timerCategoryId,
                    tz: timezone
                });
                totalTimersCreated++;
            } catch {
                errors++;
            }
        });

        console.log(`\n=== Tracked Time Summary ===\n  - Total timers created: ${totalTimersCreated}\n  - Errors: ${errors}\n`);
    }
}
