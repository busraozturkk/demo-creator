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
  project_short_title: string | undefined;  // Project short title for matching
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

const TASK_STATUSES = [
  {
    title: 'TO DO',
    position: 0,
    color: '#CCCCCC',
    type: 'todo',
    timer_action: ''
  },
  {
    title: 'IN PROGRESS',
    position: 1,
    color: '#FECC45',
    type: 'active',
    timer_action: ''
  },
  {
    title: 'DONE',
    position: 2,
    color: '#8AA657',
    type: 'completed',
    timer_action: ''
  }
];

const TASK_TYPES = [
  {
    title: 'Task',
    icon: 'WhiteFlagIcon',
    color: '#8E6BAC'
  },
  {
    title: 'Bug',
    icon: 'BugIcon',
    color: '#D50000'
  },
  {
    title: 'Feature',
    icon: 'StarEmptyIcon',
    color: '#F6BF26'
  },
  {
    title: 'Documentation',
    icon: 'DocIcon',
    color: '#8AA657'
  }
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

  /**
   * Create task types (Task, Bug, Feature, Documentation)
   */
  async createTaskTypes(): Promise<void> {
    console.log('\n=== Creating Task Types ===\n');

    let created = 0;
    let errors = 0;

    for (const taskType of TASK_TYPES) {
      try {
        const response: any = await this.taskMgmtApiClient.executeRequest(
          'POST',
          '/api/task-types',
          {
            title: taskType.title,
            icon: taskType.icon,
            color: taskType.color
          }
        );

        const taskTypeId = response.data?.id || response.id;
        this.taskTypeIds.push(taskTypeId);

        console.log(`  ✓ Created: ${taskType.title} (ID: ${taskTypeId})`);
        created++;
      } catch (error: any) {
        console.log(`  ✗ Failed to create ${taskType.title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\nCreated ${created} task types\n`);
  }

  /**
   * Fetch priorities from the system
   */
  async fetchPriorities(): Promise<void> {
    console.log('\n=== Fetching Priorities ===\n');

    try {
      const response: any = await this.taskMgmtApiClient.executeRequest(
        'GET',
        '/api/priorities'
      );

      const priorities = response.data || response || [];

      for (const priority of priorities) {
        this.priorityIds.push(priority.id);
      }

      console.log(`Found ${this.priorityIds.length} priorities\n`);
    } catch (error: any) {
      console.log(`Failed to fetch priorities: ${error.message}\n`);
    }
  }

  /**
   * Fetch allowed activity types from the system
   */
  async fetchAllowedActivityTypes(): Promise<void> {
    console.log('\n=== Fetching Allowed Activity Types ===\n');

    try {
      const response: any = await this.taskMgmtApiClient.executeRequest(
        'GET',
        '/api/allowed-activity-types'
      );

      const activityTypes = response.data || response || [];

      for (const activityType of activityTypes) {
        this.allowedActivityTypes.push(activityType.value || activityType);
      }

      console.log(`Found ${this.allowedActivityTypes.length} allowed activity types: ${this.allowedActivityTypes.join(', ')}\n`);
    } catch (error: any) {
      console.log(`Failed to fetch allowed activity types: ${error.message}\n`);
    }
  }

  /**
   * Create activity type restrictions for all roles
   * For SFF data, we add all three types: task, timerCategory, pctTask
   */
  async createActivityTypeRestrictions(roleMappings: Array<{ id: string, title: string }>): Promise<void> {
    console.log('\n=== Creating Activity Type Restrictions ===\n');

    if (!roleMappings || roleMappings.length === 0) {
      console.log('No roles found. Skipping activity type restrictions.\n');
      return;
    }

    // For SFF data, always use these three activity types
    const activityTypesForSFF = ['task', 'timerCategory', 'pctTask'];

    let created = 0;
    let errors = 0;

    for (const role of roleMappings) {
      try {
        console.log(`  Creating restriction for role: ${role.title} (ID: ${role.id})`);

        await this.taskMgmtApiClient.executeRequest(
          'POST',
          '/api/activity-type-restrictions',
          {
            role_id: role.id,
            allowed_activity_types: activityTypesForSFF
          }
        );

        console.log(`    ✓ Added activity types: ${activityTypesForSFF.join(', ')}`);
        created++;
      } catch (error: any) {
        console.log(`    ✗ Failed to create restriction for role ${role.title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\n=== Activity Type Restrictions Summary ===`);
    console.log(`  - Restrictions created: ${created}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  /**
   * Fetch and cache task management structure (boards)
   *
   * Flow:
   * 1. Fetch all boards directly from /api/boards
   * 2. Match boards to milestones by parsing board title (e.g., "1. Milestone Name")
   * 3. For each board, create statuses (TO DO, IN PROGRESS, DONE)
   */
  async fetchAndCacheTaskManagementStructure(
    projectMappings: ProjectMapping[]
  ): Promise<void> {
    console.log('\n=== Fetching Task Management Structure ===\n');

    if (!projectMappings || projectMappings.length === 0) {
      console.log('No projects found. Skipping task management setup.\n');
      return;
    }

    let totalBoards = 0;
    let totalStatuses = 0;
    let errors = 0;

    // Fetch all boards directly
    console.log('Fetching boards from Task Management...\n');

    try {
      const boardsResponse: any = await this.taskMgmtApiClient.executeRequest(
        'GET',
        '/api/boards',
        {
          'include': 'pinned'
        }
      );

      const boards = boardsResponse.data || boardsResponse || [];
      console.log(`Found ${boards.length} boards\n`);

      // Create a map of folder_id to project_short_title
      const folderToProjectMap = new Map<number, string>();
      for (const project of projectMappings) {
        if (project.partnership_id) {
          // Fetch folder for this project to get folder_id
          try {
            const foldersResponse: any = await this.taskMgmtApiClient.executeRequest(
              'GET',
              '/api/folders',
              {
                'filter[partnership_id]': project.partnership_id.toString()
              }
            );
            const folders = foldersResponse.data || foldersResponse || [];
            for (const folder of folders) {
              folderToProjectMap.set(folder.id, project.short_title);
            }
          } catch (error: any) {
            console.log(`  Warning: Could not fetch folder for project ${project.short_title}`);
          }
        }
      }

      // Process each board
      for (const board of boards) {
        // Board title format: "1. Milestone Name" or "2. Milestone Name"
        // Extract milestone title by removing the number prefix
        const milestoneTitle = board.title ? board.title.replace(/^\d+\.\s*/, '') : board.name.replace(/^\d+\.\s*/, '');

        // Find project for this board using folder_id
        const projectShortTitle = folderToProjectMap.get(board.folder_id);

        // Only add boards that have a project_short_title (skip orphaned boards)
        if (projectShortTitle) {
          this.boardMappings.push({
            id: board.id,
            folder_id: board.folder_id || 0,
            project_short_title: projectShortTitle,
            milestone_title: milestoneTitle,
            name: board.title || board.name
          });

          console.log(`  ✓ Board: ${board.title || board.name} (ID: ${board.id}) → Project: ${projectShortTitle}, Milestone: ${milestoneTitle}`);
          totalBoards++;

          // Create statuses for this board
          for (const status of TASK_STATUSES) {
            try {
              // Create status
              const statusResponse: any = await this.taskMgmtApiClient.executeRequest(
                'POST',
                '/api/statuses',
                {
                  title: status.title,
                  position: status.position,
                  board_id: board.id
                }
              );

              const statusId = statusResponse.data?.id || statusResponse.id;

              // Update status with color and type
              try {
                await this.taskMgmtApiClient.executeRequest(
                  'PUT',
                  `/api/statuses/${statusId}`,
                  {
                    title: status.title,
                    color: status.color,
                    type: status.type,
                    timer_action: status.timer_action
                  }
                );
              } catch (updateError: any) {
                console.log(`    ✗ Failed to update status '${status.title}': ${updateError.message}`);
              }

              totalStatuses++;
            } catch (statusError: any) {
              // Status might already exist, ignore error
              if (!statusError.message.includes('already') && !statusError.message.includes('duplicate')) {
                console.log(`    ✗ Failed to create status '${status.title}': ${statusError.message}`);
                errors++;
              }
            }
          }

          console.log(`    Added ${TASK_STATUSES.length} statuses`);
        } else {
          console.log(`  ⊗ Board: ${board.title || board.name} (ID: ${board.id}) → Skipped (no project found for folder ${board.folder_id})`);
        }
      }

    } catch (error: any) {
      console.log(`Failed to fetch boards: ${error.message}\n`);
      return;
    }

    console.log(`\n=== Task Management Structure Summary ===`);
    console.log(`  - Boards found: ${totalBoards}`);
    console.log(`  - Statuses created: ${totalStatuses}`);
    console.log(`  - Errors: ${errors}\n`);

    // Save mappings to cache
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

  /**
   * Load task data from CSV file
   */
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

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Parse CSV with quoted fields
      const fields: string[] = [];
      let currentField = '';
      let insideQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];

        if (char === '"') {
          if (insideQuotes && line[j + 1] === '"') {
            // Escaped quote
            currentField += '"';
            j++; // Skip next quote
          } else {
            // Toggle quotes
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          // Field separator
          fields.push(currentField);
          currentField = '';
        } else {
          currentField += char;
        }
      }

      // Add last field
      fields.push(currentField);

      if (fields.length >= 4) {
        tasks.push({
          work_package_title: fields[0].trim(),
          task_title: fields[1].trim(),
          task_description: fields[2].trim(),
          task_type: fields[3].trim()
        });
      }
    }

    return tasks;
  }

  /**
   * Generate random date within a period
   */
  private randomDateInPeriod(startDate: string, endDate: string): string {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
    const randomDate = new Date(randomTime);

    // Format as YYYY-MM-DD
    const year = randomDate.getFullYear();
    const month = String(randomDate.getMonth() + 1).padStart(2, '0');
    const day = String(randomDate.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * Create tasks in boards and link them to work packages
   *
   * Flow:
   * 1. Load work package intervals from cache
   * 2. Load task data from CSV
   * 3. For each work package, find its milestone board
   * 4. Create multiple tasks for the work package
   * 5. Set created_at and deadline within work package period
   * 6. Update task with full details including description, assignees, watchers
   */
  async createTasksForWorkPackages(csvPath?: string): Promise<void> {
    console.log('\n=== Creating Tasks for Work Packages ===\n');

    // Load work package intervals from cache
    const workPackageIntervals = this.loadFromCache<any[]>('./data/cache/work-package-intervals.json');

    if (!workPackageIntervals || workPackageIntervals.length === 0) {
      console.log('No work package intervals found. Skipping task creation.\n');
      return;
    }

    console.log(`Found ${workPackageIntervals.length} work packages\n`);

    // Load task data from CSV
    const tasksData = this.loadTasksFromCSV(csvPath);
    if (tasksData.length === 0) {
      console.log('No task data found in CSV. Skipping task creation.\n');
      return;
    }

    console.log(`Loaded ${tasksData.length} tasks from CSV\n`);

    // Load work package employee assignments from cache
    const wpEmployeeAssignments = this.loadFromCache<WorkPackageEmployeeAssignment[]>('./data/cache/wp-employee-assignments.json') || [];
    console.log(`Loaded ${wpEmployeeAssignments.length} work package employee assignments from cache\n`);

    // Group tasks by work package title
    const tasksByWorkPackage = new Map<string, TaskData[]>();
    for (const task of tasksData) {
      const existing = tasksByWorkPackage.get(task.work_package_title) || [];
      existing.push(task);
      tasksByWorkPackage.set(task.work_package_title, existing);
    }

    // Group employees by work package title
    const employeesByWorkPackage = new Map<string, WorkPackageEmployeeAssignment['assigned_employees']>();
    for (const assignment of wpEmployeeAssignments) {
      employeesByWorkPackage.set(assignment.work_package_title, assignment.assigned_employees);
    }

    // Check if we have task types
    if (this.taskTypeIds.length === 0) {
      console.log('Warning: No task types created. Tasks will not have a type assigned.\n');
    }

    // Check if we have priorities
    if (this.priorityIds.length === 0) {
      console.log('Warning: No priorities found. Tasks will not have a priority assigned.\n');
    }

    let totalTasks = 0;
    let errors = 0;

    // Get first status (TO DO) for each board
    const boardStatuses = new Map<number, number>();

    // Create task type name to ID mapping
    const taskTypeByName = new Map<string, number>();
    // We'll need to fetch task types to map names to IDs
    // For now, use random assignment

    for (const wp of workPackageIntervals) {
      try {
        // Find the board for this specific project and milestone
        const board = this.boardMappings.find(b =>
          b.project_short_title === wp.project_short_title &&
          b.milestone_title === wp.milestone_title
        );

        if (!board) {
          console.log(`  Warning: Board not found for project ${wp.project_short_title}, milestone ${wp.milestone_title}, skipping work package ${wp.work_package_title}`);
          continue;
        }

        // Get or fetch the first status (TO DO) for this board
        let statusId: number | undefined = boardStatuses.get(board.id);
        if (!statusId) {
          // Fetch statuses for this board
          try {
            const statusesResponse: any = await this.taskMgmtApiClient.executeRequest(
              'GET',
              '/api/statuses',
              {
                board_id: board.id.toString()
              }
            );

            const statuses = statusesResponse.data || statusesResponse || [];
            // Find TO DO status
            const todoStatus = statuses.find((s: any) => s.title === 'TO DO' || s.type === 'todo');
            if (todoStatus && todoStatus.id) {
              statusId = todoStatus.id;
              boardStatuses.set(board.id, todoStatus.id); // Use todoStatus.id directly to avoid undefined
            }
          } catch (error: any) {
            console.log(`  Warning: Failed to fetch statuses for board ${board.id}: ${error.message}`);
          }
        }

        if (!statusId) {
          console.log(`  Warning: No TO DO status found for board ${board.id}, skipping`);
          continue;
        }

        // Get tasks for this work package
        const wpTasks = tasksByWorkPackage.get(wp.work_package_title) || [];

        if (wpTasks.length === 0) {
          console.log(`  Warning: No tasks found for work package ${wp.work_package_title}`);
          continue;
        }

        console.log(`  ${wp.project_short_title} → ${wp.milestone_title} → ${wp.work_package_title} (${wpTasks.length} tasks)`);

        // Get assigned employees for this work package
        const assignedEmployees = employeesByWorkPackage.get(wp.work_package_title) || [];

        // Create each task for this work package
        for (const taskData of wpTasks) {
          try {
            // Generate created_at and deadline within work package period
            const createdAt = this.randomDateInPeriod(wp.started_at, wp.finished_at);
            const deadline = this.randomDateInPeriod(createdAt, wp.finished_at);

            // Create task
            const taskResponse: any = await this.taskMgmtApiClient.executeRequest(
              'POST',
              '/api/tasks',
              {
                title: taskData.task_title,
                position: totalTasks,
                board_id: board.id,
                status_id: statusId
              }
            );

            const taskId = taskResponse.data?.id || taskResponse.id;

            // Update task with full details
            try {
              const updatePayload: any = {
                title: taskData.task_title,
                description: `<div style="font-size: 11pt; font-family: Raleway, sans-serif;" data-node-font-size="11pt" data-node-font-family="Raleway, sans-serif">${taskData.task_description}</div>`,
                deadline: deadline,
                fields: [
                  'pct_task',
                  'description',
                  'task_type',
                  'responsibles',
                  'watchers',
                  'sprint_point',
                  'urgency',
                  'tags',
                  'deadline'
                ],
                checklistSections: []
              };

              // Assign a random task type
              if (this.taskTypeIds.length > 0) {
                const randomTaskTypeId = this.taskTypeIds[Math.floor(Math.random() * this.taskTypeIds.length)];
                updatePayload.task_type_id = randomTaskTypeId;
              }

              // Assign a random priority
              if (this.priorityIds.length > 0) {
                const randomPriorityId = this.priorityIds[Math.floor(Math.random() * this.priorityIds.length)];
                updatePayload.priority_id = randomPriorityId;
              }

              // Link to work package via pct_task
              if (wp.task_id) {
                updatePayload.pct_task_id = wp.task_id;
              }

              await this.taskMgmtApiClient.executeRequest(
                'PUT',
                `/api/tasks/${taskId}`,
                updatePayload
              );

              // Determine status based on deadline date
              const now = new Date();
              const deadlineDate = new Date(deadline);
              const createdDate = new Date(createdAt);

              let targetStatusId = statusId; // Default TO DO
              let targetStatusType = 'todo';
              let completedAt = null;

              if (deadlineDate < now) {
                // Past task - mark as DONE
                targetStatusType = 'completed';
                // Set completed_at between created_at and deadline
                completedAt = this.randomDateInPeriod(createdAt, deadline);
              } else if (createdDate < now && deadlineDate > now) {
                // Current task - randomly DONE or IN PROGRESS
                const isDone = Math.random() > 0.5;
                if (isDone) {
                  targetStatusType = 'completed';
                  completedAt = this.randomDateInPeriod(createdAt, now.toISOString().split('T')[0]);
                } else {
                  targetStatusType = 'active';
                }
              }
              // Future tasks stay as TO DO

              // If we need to change status, find and update
              if (targetStatusType !== 'todo') {
                try {
                  // Fetch all statuses for this board if not already fetched
                  const statusesResponse: any = await this.taskMgmtApiClient.executeRequest(
                    'GET',
                    '/api/statuses',
                    {
                      board_id: board.id.toString()
                    }
                  );

                  const statuses = statusesResponse.data || statusesResponse || [];
                  const targetStatus = statuses.find((s: any) => s.type === targetStatusType);

                  if (targetStatus) {
                    targetStatusId = targetStatus.id;

                    // Prepare assignees and watchers (same people from work package)
                    const assignees: any[] = [];
                    const watchers: any[] = [];
                    const assigneeIds: number[] = [];
                    const watcherIds: number[] = [];

                    // Add assigned employees as both assignees and watchers
                    for (const emp of assignedEmployees) {
                      const empData = {
                        id: emp.user_id,
                        organization_id: taskResponse.organization_id,
                        // We don't have all employee details, so minimal info
                        email: `user${emp.user_id}@example.com`,
                        first_name: emp.employee_name.split(' ')[0] || emp.employee_name,
                        last_name: emp.employee_name.split(' ').slice(1).join(' ') || '',
                        is_active: 1
                      };
                      assignees.push(empData);
                      watchers.push(empData);
                      assigneeIds.push(emp.user_id);
                      watcherIds.push(emp.user_id);
                    }

                    // Update task status
                    const statusUpdatePayload: any = {
                      id: taskId,
                      organization_id: taskResponse.organization_id,
                      board_id: board.id,
                      status_id: targetStatusId,
                      title: taskData.task_title,
                      fields: updatePayload.fields,
                      is_checklist: 0,
                      position: totalTasks,
                      sprint_position: 1,
                      time_estimation_unit: 'hour',
                      total_sprint_points: 0,
                      task_size: 'small',
                      estimated_sprint_points: 2,
                      estimated_time: 4,
                      assignees: assignees,
                      watchers: watchers,
                      status: targetStatus,
                      created_at: createdAt,
                      encoded_id: taskResponse.encoded_id || '',
                      is_public: false,
                      customer_id: null,
                      user_task_track_times: [],
                      user_task_costs: [],
                      user_hourly_salaries: [],
                      sectionsDetail: updatePayload.fields.map((field: string, index: number) => ({
                        id: field,
                        type: field,
                        order: index + 1,
                        dropMeta: {
                          destination: { droppableId: 'all-sections', index },
                          type: 'SECTION'
                        },
                        value: field === 'description' ? updatePayload.description :
                               (field === 'task_type' && updatePayload.task_type_id ? updatePayload.task_type_id :
                               (field === 'urgency' && updatePayload.priority_id ? updatePayload.priority_id :
                               (field === 'responsibles' ? assignees :
                               (field === 'watchers' ? watchers : ''))))
                      })),
                      checklistSections: [],
                      positionIndex: { destinationIndex: 0, sourceIndex: 0 },
                      source_status_id: targetStatusId,
                      assignee_ids: assigneeIds,
                      watcher_ids: watcherIds
                    };

                    // Add completed_at if task is done
                    if (completedAt) {
                      statusUpdatePayload.completed_at = completedAt;
                    }

                    await this.taskMgmtApiClient.executeRequest(
                      'PUT',
                      `/api/tasks/${taskId}`,
                      statusUpdatePayload
                    );
                  }
                } catch (statusError: any) {
                  console.log(`    ✗ Failed to update task status: ${statusError.message}`);
                }
              }

            } catch (updateError: any) {
              console.log(`    ✗ Failed to update task details: ${updateError.message}`);
            }

            totalTasks++;

          } catch (taskError: any) {
            console.log(`    ✗ Failed to create task "${taskData.task_title}": ${taskError.message}`);
            errors++;
          }
        }

      } catch (error: any) {
        console.log(`  ✗ Failed to process work package ${wp.work_package_title}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\n\n=== Task Creation Summary ===`);
    console.log(`  - Tasks created: ${totalTasks}`);
    console.log(`  - Errors: ${errors}\n`);
  }
}
