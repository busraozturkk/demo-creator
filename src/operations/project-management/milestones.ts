import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface ProjectMapping {
  short_title: string;
  title: string;
  id: number;
  work_plan_id?: number;
}

export interface MilestoneMapping {
  project_short_title: string;
  milestone_title: string;
  task_id: number;
  work_plan_id: number;
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
    return allMappings;
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
