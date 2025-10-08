import { ApiClient } from '../../api-client';
import * as fs from 'fs';
import * as path from 'path';

interface DayOffType {
  id: number;
  name: string;
  day_type_flag: string;
  icon: string;
  color: string;
  is_working_day: boolean;
  requires_substitute: boolean;
  is_half_day_allowed: boolean;
}

export class DayOffTypesOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async fetchAndCache(): Promise<DayOffType[]> {
    console.log('Fetching day-off types');

    const dayOffTypes = await this.apiClient.executeRequest('GET', '/api/day-off-types');
    console.log(`Fetched ${dayOffTypes.length} day-off types`);

    const data: DayOffType[] = Array.isArray(dayOffTypes) ? dayOffTypes : (dayOffTypes.data || []);

    this.cacheData(data);
    console.log();

    return data;
  }

  private cacheData(data: DayOffType[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'day-off-types.json');
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    console.log(`Cached day-off types to: ${cacheFile}\n`);

    console.log('=== Day-Off Types ===');
    data.forEach(type => {
      const working = type.is_working_day ? '(Working Day)' : '(Off Day)';
      const halfDay = type.is_half_day_allowed ? '(Half-day allowed)' : '';
      console.log(`  ${type.name}: ${type.id} [${type.day_type_flag}] ${working} ${halfDay}`);
    });
  }

  getCachedData(): DayOffType[] | null {
    const cacheFile = path.join('./data/cache', 'day-off-types.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }

  getVacationTypes(): DayOffType[] {
    const cached = this.getCachedData();
    if (!cached) return [];

    // Return vacation and flexi types (off days that are not sick)
    return cached.filter(type =>
      !type.is_working_day &&
      type.day_type_flag !== 'sick'
    );
  }

  getSickDayTypes(): DayOffType[] {
    const cached = this.getCachedData();
    if (!cached) return [];

    return cached.filter(type => type.day_type_flag === 'sick');
  }

  getHomeOfficeTypes(): DayOffType[] {
    const cached = this.getCachedData();
    if (!cached) return [];

    return cached.filter(type => type.day_type_flag === 'home_office');
  }
}