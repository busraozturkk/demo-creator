import { ApiClient } from '../../../api-client';
import { BaseOperation } from '../../utilities/base-operation';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_PATHS } from '../../../utils/constants';
import { EmployeeMapping, DepartmentMapping } from '../../../types';

interface Department {
  name: string;
  leader_email_username: string;
}

export class DepartmentsOperation extends BaseOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    super();
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

        // Get organization ID from config or first API call
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
      this.saveMappings(mappings);
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
    // Get organization ID from current user or config
    // For now, we'll extract it from the auth token or make a simple API call
    // This is a placeholder - you might need to adjust based on your API
    const response = await this.apiClient.executeRequest('GET', '/api/employees?limit=1&per_page=1');

    if (response && response.data && response.data.length > 0) {
      return response.data[0].organization_id;
    }

    throw new Error('Could not determine organization ID');
  }

  private saveMappings(mappings: DepartmentMapping[]): void {
    this.saveToCache(CACHE_PATHS.DEPARTMENT_MAPPINGS, mappings);
    console.log(`Saved department mappings to: ${CACHE_PATHS.DEPARTMENT_MAPPINGS}\n`);
  }

  getMappings(): DepartmentMapping[] | null {
    return this.loadFromCache<DepartmentMapping[]>(CACHE_PATHS.DEPARTMENT_MAPPINGS);
  }
}