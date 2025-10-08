import { ApiClient } from '../../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface Team {
  name: string;
  department_name: string;
  leader_email_username: string;
  member_email_usernames: string;
}

interface TeamMapping {
  name: string;
  id: number;
  department_id: number;
  leader_employee_id: number;
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

export class TeamsOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async createTeams(
    csvPath: string,
    employeeMappings: EmployeeMapping[],
    departmentMappings: DepartmentMapping[],
    emailDomain: string
  ): Promise<TeamMapping[]> {
    console.log(`Loading teams from: ${csvPath}`);
    const teams = this.loadTeams(csvPath);

    console.log(`Found ${teams.length} teams to create\n`);

    const mappings: TeamMapping[] = [];

    // Get office location ID (we'll use the first one from cache)
    const officeLocationId = await this.getOfficeLocationId();

    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      console.log(`[${i + 1}/${teams.length}] Creating: ${team.name}`);

      try {
        // Find department ID
        const department = departmentMappings.find(
          d => d.name.toLowerCase() === team.department_name.toLowerCase()
        );

        if (!department) {
          console.error(`Department not found: ${team.department_name}\n`);
          continue;
        }

        console.log(`  Department: ${department.name} (ID: ${department.id})`);

        // Find leader employee ID
        const leaderEmail = `${team.leader_email_username}@${emailDomain}`;
        const leader = employeeMappings.find(e => e.email === leaderEmail);

        if (!leader) {
          console.error(`Leader not found for email: ${leaderEmail}\n`);
          continue;
        }

        console.log(`  Leader: ${leader.first_name} ${leader.last_name} (ID: ${leader.id})`);

        // Parse member email usernames
        const memberUsernames = team.member_email_usernames
          .split(',')
          .map(u => u.trim())
          .filter(u => u.length > 0);

        // Find member employee IDs
        const memberIds: number[] = [];
        for (const username of memberUsernames) {
          const memberEmail = `${username}@${emailDomain}`;
          const member = employeeMappings.find(e => e.email === memberEmail);
          if (member) {
            memberIds.push(member.id);
          }
        }

        // Add leader to participants if not already included
        if (!memberIds.includes(leader.id)) {
          memberIds.push(leader.id);
        }

        console.log(`  Members: ${memberIds.length} employee(s)`);

        const response = await this.apiClient.executeRequest('POST', '/api/teams', {
          name: team.name,
          team_leader_employee_id: leader.id,
          parent_id: null,
          team_leader_can_manage_leave_requests: false,
          departments: [department.id],
          participants: memberIds,
          locations: officeLocationId ? [officeLocationId] : [],
        });

        console.log(`Created successfully (ID: ${response.id})\n`);

        mappings.push({
          name: team.name,
          id: response.id,
          department_id: department.id,
          leader_employee_id: leader.id,
        });
      } catch (error) {
        console.error(`Error: Failed to create team: ${error}\n`);
      }
    }

    console.log(`Completed! Created ${mappings.length} teams.`);

    if (mappings.length > 0) {
      this.saveMappings(mappings);
    }

    return mappings;
  }

  private loadTeams(csvPath: string): Team[] {
    const absolutePath = path.resolve(csvPath);
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      name: record.name,
      department_name: record.department_name,
      leader_email_username: record.leader_email_username,
      member_email_usernames: record.member_email_usernames || '',
    }));
  }

  private async getOfficeLocationId(): Promise<number | null> {
    try {
      // Try to get office location from office mappings
      const officeMappingsPath = './data/cache/office-mappings.json';
      if (fs.existsSync(officeMappingsPath)) {
        const mappings = JSON.parse(fs.readFileSync(officeMappingsPath, 'utf-8'));
        if (mappings && mappings.length > 0 && mappings[0].location_id) {
          return mappings[0].location_id;
        }
      }
    } catch (error) {
      console.warn('Could not get office location ID, will use empty array');
    }
    return null;
  }

  private saveMappings(mappings: TeamMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'team-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved team mappings to: ${cacheFile}\n`);
  }

  getMappings(): TeamMapping[] | null {
    const cacheFile = path.join('./data/cache', 'team-mappings.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }
}