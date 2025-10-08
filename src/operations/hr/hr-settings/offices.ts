import { ApiClient } from '../../../api-client';
import { CsvLoader, Office } from '../../../utils/csv-loader';
import * as fs from 'fs';
import * as path from 'path';

interface OfficeMapping {
  name: string;
  id: number;
}

export class OfficesOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async fetchAndCacheOffices(): Promise<OfficeMapping[]> {
    console.log('Fetching offices from HR API');
    const response = await this.apiClient.executeRequest(
      'GET',
      '/api/offices?include=employeesCount,vacationResponsibles,sickLeaveResponsibles,contractResponsibles,birthDateResponsibles,officeManagers'
    );

    const offices = Array.isArray(response) ? response : (response.data || []);

    // Group offices by name and keep only the latest (highest ID) for each name
    const officesByName = new Map<string, OfficeMapping>();
    offices.forEach((office: any) => {
      const existing = officesByName.get(office.name);
      if (!existing || office.id > existing.id) {
        officesByName.set(office.name, {
          name: office.name,
          id: office.id,
        });
      }
    });

    const mappings: OfficeMapping[] = Array.from(officesByName.values());

    console.log(`Found ${mappings.length} unique offices (latest version for each name)`);
    mappings.forEach(o => console.log(`  ${o.name}: ${o.id}`));
    console.log();

    this.saveOfficeMappings(mappings);
    return mappings;
  }

  private saveOfficeMappings(mappings: OfficeMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'office-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved office mappings to: ${cacheFile}\n`);
  }

  getOfficeMappings(): OfficeMapping[] | null {
    const cacheFile = path.join('./data/cache', 'office-mappings.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }

  async createOffices(csvPath: string): Promise<void> {
    console.log(`Loading offices from: ${csvPath}`);
    const offices = CsvLoader.loadOffices(csvPath);

    console.log(`Found ${offices.length} offices to create\n`);

    for (let i = 0; i < offices.length; i++) {
      const office = offices[i];
      console.log(`[${i + 1}/${offices.length}] Creating: ${office.name}`);

      try {
        const payload = {
          ...office,
          vacation_responsibles: [],
          sick_leave_responsibles: [],
          contract_responsibles: [],
          birthdate_responsibles: [],
          office_managers: [],
        };

        await this.apiClient.executeRequest(
          'POST',
          '/api/offices',
          payload
        );

        console.log(`Created successfully\n`);
      } catch (error) {
        console.error(`Failed to create: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${offices.length} offices.`);

    // After creating offices, fetch and cache their IDs
    console.log('Fetching created office IDs\n');
    await this.fetchAndCacheOffices();
  }
}
