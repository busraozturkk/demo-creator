import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface Project {
  type_id: string;
  short_title: string;
  title: string;
  started_at: string;
  finished_at: string;
}

export interface ProjectMapping {
  short_title: string;
  title: string;
  id: number;
  partnership_id?: number;  // Partnership ID for /pct/api endpoints
  work_plan_id?: number;
  started_at?: string;
  finished_at?: string;
}

export class ProjectsOperation {
  private apiClient: ApiClient;
  private pctApiClient: ApiClient;
  private projects: Project[] = [];

  constructor(apiClient: ApiClient, pctApiClient: ApiClient) {
    this.apiClient = apiClient;
    this.pctApiClient = pctApiClient;
  }

  async createProjects(csvPath: string, maxCount?: number, selectedTitles?: string[]): Promise<ProjectMapping[]> {
    console.log(`Loading projects from: ${csvPath}`);
    this.projects = this.loadProjects(csvPath);

    console.log(`DEBUG: selectedTitles parameter:`, selectedTitles);
    console.log(`DEBUG: selectedTitles length:`, selectedTitles?.length);
    console.log(`DEBUG: Available projects in CSV:`, this.projects.map(p => p.short_title));

    // Filter by selected titles if provided, otherwise use maxCount
    let projectsToCreate: Project[];
    if (selectedTitles && selectedTitles.length > 0) {
      projectsToCreate = this.projects.filter(p => selectedTitles.includes(p.short_title));
      console.log(`Found ${this.projects.length} projects in CSV, creating ${projectsToCreate.length} selected projects`);
      console.log(`Selected projects:`, projectsToCreate.map(p => p.short_title));
      console.log('');
    } else if (maxCount && maxCount < this.projects.length) {
      projectsToCreate = this.projects.slice(0, maxCount);
      console.log(`Found ${this.projects.length} projects in CSV, creating ${projectsToCreate.length} projects\n`);
    } else {
      projectsToCreate = this.projects;
      console.log(`Found ${this.projects.length} projects in CSV, creating all projects\n`);
    }

    const mappings: ProjectMapping[] = [];

    for (let i = 0; i < projectsToCreate.length; i++) {
      const project = projectsToCreate[i];
      console.log(`[${i + 1}/${projectsToCreate.length}] Creating: ${project.short_title}`);

      try {
        const response = await this.apiClient.executeRequest('POST', '/api/projects', {
          type_id: project.type_id,
          short_title: project.short_title,
          title: project.title,
          started_at: project.started_at,
          finished_at: project.finished_at,
        });

        const projectId = response.data.id;

        console.log(`Created successfully (ID: ${projectId})`);
        console.log(`  Title: ${project.title}`);
        console.log(`  Period: ${project.started_at} - ${project.finished_at}`);

        // Fetch work-plan ID for this project
        console.log(`  Fetching work-plan ID`);
        const workPlanId = await this.fetchWorkPlanId(projectId);
        console.log(`  Work-plan ID: ${workPlanId}`);

        // Fetch partnership ID for this project
        console.log(`  Fetching partnership ID`);
        const partnershipId = await this.fetchPartnershipId(projectId);
        console.log(`  Partnership ID: ${partnershipId}\n`);

        mappings.push({
          short_title: project.short_title,
          title: project.title,
          id: projectId,
          partnership_id: partnershipId ?? undefined,
          work_plan_id: workPlanId ?? undefined,
          started_at: project.started_at,
          finished_at: project.finished_at,
        });
      } catch (error) {
        console.error(`Error: Failed to create project: ${error}\n`);
      }
    }

    console.log(`Completed! Created ${mappings.length} projects.`);

    if (mappings.length > 0) {
      this.saveMappings(mappings);
    }

    return mappings;
  }

  getProjectsData(): Array<{ short_title: string; started_at: string; finished_at: string }> {
    return this.projects.map(p => ({
      short_title: p.short_title,
      started_at: p.started_at,
      finished_at: p.finished_at,
    }));
  }

  private loadProjects(csvPath: string): Project[] {
    const absolutePath = path.resolve(csvPath);
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      type_id: record.type_id,
      short_title: record.short_title,
      title: record.title,
      started_at: record.started_at,
      finished_at: record.finished_at,
    }));
  }

  private saveMappings(mappings: ProjectMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'project-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved project mappings to: ${cacheFile}\n`);
  }

  getMappings(): ProjectMapping[] | null {
    const cacheFile = path.join('./data/cache', 'project-mappings.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }

  private async fetchWorkPlanId(projectId: number): Promise<number | null> {
    try {
      const response = await this.pctApiClient.executeRequest(
        'GET',
        `/pct/api/work-plans?filter[project_id]=${projectId}&filter[is_current]=1`
      );

      if (response.data && response.data.length > 0) {
        return response.data[0].id;
      }

      return null;
    } catch (error) {
      console.error(`  Failed to fetch work-plan ID: ${error}`);
      return null;
    }
  }

  private async fetchPartnershipId(projectId: number): Promise<number | null> {
    try {
      // Try to fetch partnership by project ID
      const response = await this.pctApiClient.executeRequest(
        'GET',
        `/pct/api/partnerships?filter[project_id]=${projectId}`
      );

      if (response.data && response.data.length > 0) {
        return response.data[0].id;
      }

      // If not found by filter, the project ID might BE the partnership ID
      console.log(`    No separate partnership found, using project ID as partnership ID`);
      return projectId;
    } catch (error) {
      console.error(`  Failed to fetch partnership ID: ${error}`);
      // Fallback: use project ID as partnership ID
      console.log(`    Using project ID as partnership ID (fallback)`);
      return projectId;
    }
  }
}
