import { ApiClient } from '../../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface CLevel {
  employee_email_username: string;
  department_names: string;
}

interface EmployeeMapping {
  email: string;
  id: number;
  first_name: string;
  last_name: string;
}

interface DepartmentMapping {
  name: string;
  id: number;
}

export class CLevelOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async assignCLevel(
    csvPath: string,
    employeeMappings: EmployeeMapping[],
    departmentMappings: DepartmentMapping[],
    emailDomain: string
  ): Promise<void> {
    console.log(`Loading C-level assignments from: ${csvPath}`);
    const cLevels = this.loadCLevels(csvPath);

    console.log(`Found ${cLevels.length} C-level assignment(s)\n`);

    for (let i = 0; i < cLevels.length; i++) {
      const cLevel = cLevels[i];
      console.log(`[${i + 1}/${cLevels.length}] Assigning C-level: ${cLevel.employee_email_username}`);

      try {
        // Find employee ID
        const employeeEmail = `${cLevel.employee_email_username}@${emailDomain}`;
        const employee = employeeMappings.find(e => e.email === employeeEmail);

        if (!employee) {
          console.error(`Employee not found for email: ${employeeEmail}\n`);
          continue;
        }

        console.log(`  Employee: ${employee.first_name} ${employee.last_name} (ID: ${employee.id})`);

        // Parse department names
        const departmentNames = cLevel.department_names
          .split(',')
          .map(d => d.trim())
          .filter(d => d.length > 0);

        // Find department IDs
        const departmentIds: number[] = [];
        for (const deptName of departmentNames) {
          const dept = departmentMappings.find(
            d => d.name.toLowerCase() === deptName.toLowerCase()
          );
          if (dept) {
            departmentIds.push(dept.id);
          } else {
            console.warn(`  Department not found: ${deptName}`);
          }
        }

        if (departmentIds.length === 0) {
          console.error(`  No valid departments found\n`);
          continue;
        }

        console.log(`  Departments: ${departmentIds.length} department(s)`);

        await this.apiClient.executeRequest('POST', '/api/c-levels', {
          employee_id: employee.id,
          department_ids: departmentIds,
        });

        console.log(`C-level assigned successfully\n`);
      } catch (error) {
        console.error(`Error: Failed to assign C-level: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${cLevels.length} C-level assignment(s).`);
  }

  private loadCLevels(csvPath: string): CLevel[] {
    const absolutePath = path.resolve(csvPath);
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      employee_email_username: record.employee_email_username,
      department_names: record.department_names || '',
    }));
  }
}