import { ApiClient } from '../../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

export interface DepartmentMapping {
  name: string;
  id: number;
  leader_employee_id: number;
}

interface Department {
  name: string;
  leader_email_username: string;
}

interface EmployeeMapping {
  email: string;
  id: number;
  first_name: string;
  last_name: string;
}

export class DepartmentsOperation {
  private apiClient: ApiClient;
  private cacheDir: string = './data/cache';
  private cacheFile: string = 'department-mappings.json';

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async createDepartments(
    csvPath: string,
    employeeMappings: EmployeeMapping[],
    emailDomain: string
  ): Promise<DepartmentMapping[]> {
    console.log(`Loading departments from: ${csvPath}`);
    const departments = this.loadDepartments(csvPath);

    console.log(`Found ${departments.length} departments to create\n`);

    const mappings: DepartmentMapping[] = [];

    for (let i = 0; i < departments.length; i++) {
      const department = departments[i];
      console.log(`[${i + 1}/${departments.length}] Creating: ${department.name}`);

      try {
        // Find leader employee ID
        const leaderEmail = `${department.leader_email_username}@${emailDomain}`;
        const leader = employeeMappings.find(e => e.email === leaderEmail);

        if (!leader) {
          console.error(`Leader not found for email: ${leaderEmail}\n`);
          continue;
        }

        console.log(`  Leader: ${leader.first_name} ${leader.last_name} (ID: ${leader.id})`);

        // Get organization ID
        const organizationId = await this.getOrganizationId();

        const response = await this.apiClient.executeRequest('POST', '/api/departments', {
          name: department.name,
          organization_id: organizationId,
          department_leader_employee_id: leader.id,
        });

        console.log(`Created successfully (ID: ${response.id})\n`);

        mappings.push({
          name: department.name,
          id: response.id,
          leader_employee_id: leader.id,
        });
      } catch (error) {
        console.error(`Error: Failed to create department: ${error}\n`);
      }
    }

    console.log(`Completed! Created ${mappings.length} departments.`);

    if (mappings.length > 0) {
      const cachePath = path.join(this.cacheDir, this.cacheFile);
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(cachePath, JSON.stringify(mappings, null, 2));
      console.log(`Saved department mappings to: ${cachePath}\n`);
    }

    return mappings;
  }

  private loadDepartments(csvPath: string): Department[] {
    const absolutePath = path.resolve(csvPath);
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      name: record.name,
      leader_email_username: record.leader_email_username,
    }));
  }

  private async getOrganizationId(): Promise<number> {
    // Get organization ID from cached value or API call
    const orgCachePath = path.join(this.cacheDir, 'organization-id.json');

    if (fs.existsSync(orgCachePath)) {
      try {
        const content = fs.readFileSync(orgCachePath, 'utf-8');
        const orgData = JSON.parse(content);
        return orgData.organizationId || orgData;
      } catch (error) {
        // Continue to API call if cache read fails
      }
    }

    // Fallback: Get from API
    const response = await this.apiClient.executeRequest('GET', '/api/employees?limit=1&per_page=1');

    if (response && response.data && response.data.length > 0) {
      return response.data[0].organization_id;
    }

    throw new Error('Could not determine organization ID');
  }

  getMappings(): DepartmentMapping[] | null {
    const cachePath = path.join(this.cacheDir, this.cacheFile);

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to read department mappings: ${error}`);
      return null;
    }
  }
}
