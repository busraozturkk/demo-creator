import { ApiClient } from '../../../api-client';
import * as fs from 'fs';
import * as path from 'path';

interface TitleMapping {
  id: number;
  name: string;
  name_de?: string;
}

interface OccupationGroupMapping {
  id: number;
  name: string;
  name_de?: string;
}

interface OccupationMapping {
  id: number;
  name: string;
  name_de?: string;
  group_id: number;
}

interface ReferenceData {
  titles: TitleMapping[];
  occupation_groups: OccupationGroupMapping[];
  occupations: OccupationMapping[];
}

export class ReferenceDataOperation {
  private apiClient: ApiClient;
  private applicationId: string;
  private cacheDir: string = './data/cache';
  private cacheFile: string = 'reference-data.json';
  private occupationMappingsFile: string = 'occupation-mappings.json';

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  /**
   * Fetch all reference data (titles, occupation groups, occupations) from API and cache them
   */
  async fetchAndCache(): Promise<ReferenceData> {
    console.log('Fetching reference data from API\n');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}/module?module=general`
      );

      const formOptions = response.data?.sections?.form_options?.settings || {};

      const titles = (formOptions.titles?.value || []).map((title: any) => ({
        id: title.id,
        name: title.name,
        name_de: title.name_de,
      }));

      const occupationGroups = (formOptions.occupation_groups?.value || []).map((group: any) => ({
        id: group.id,
        name: group.name,
        name_de: group.name_de,
      }));

      // Try to load occupations from cached occupation-mappings.json
      let occupations: OccupationMapping[] = [];
      const occupationMappingsPath = path.join(this.cacheDir, this.occupationMappingsFile);

      if (fs.existsSync(occupationMappingsPath)) {
        try {
          const content = fs.readFileSync(occupationMappingsPath, 'utf-8');
          occupations = JSON.parse(content);
          console.log(`Loaded ${occupations.length} occupations from cached occupation mappings`);
        } catch (error) {
          console.error(`Failed to read occupation mappings: ${error}`);
        }
      } else {
        console.log('No occupation mappings found in cache');
      }

      const referenceData: ReferenceData = {
        titles,
        occupation_groups: occupationGroups,
        occupations,
      };

      // Ensure cache directory exists
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      // Save to cache
      const cachePath = path.join(this.cacheDir, this.cacheFile);
      fs.writeFileSync(cachePath, JSON.stringify(referenceData, null, 2));

      console.log(`Reference data cached to: ${cachePath}\n`);
      console.log(`  - Titles: ${titles.length}`);
      console.log(`  - Occupation Groups: ${occupationGroups.length}`);
      console.log(`  - Occupations: ${occupations.length}\n`);

      return referenceData;
    } catch (error) {
      console.error(`Failed to fetch reference data: ${error}`);
      return {
        titles: [],
        occupation_groups: [],
        occupations: [],
      };
    }
  }

  /**
   * Get cached reference data
   */
  getCachedData(): ReferenceData | null {
    const cachePath = path.join(this.cacheDir, this.cacheFile);

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to read cached reference data: ${error}`);
      return null;
    }
  }

  /**
   * Get title ID by name
   */
  getTitleId(name: string): number | null {
    const data = this.getCachedData();
    if (!data) return null;

    const title = data.titles.find(t => t.name === name || t.name_de === name);
    return title ? title.id : null;
  }

  /**
   * Get occupation group ID by name
   */
  getOccupationGroupId(name: string): number | null {
    const data = this.getCachedData();
    if (!data) return null;

    const group = data.occupation_groups.find(g => g.name === name || g.name_de === name);
    return group ? group.id : null;
  }

  /**
   * Get occupation ID by name
   */
  getOccupationId(name: string): number | null {
    const data = this.getCachedData();
    if (!data) return null;

    const occupation = data.occupations.find(o => o.name === name || o.name_de === name);
    return occupation ? occupation.id : null;
  }

  /**
   * Get all titles
   */
  getTitles(): TitleMapping[] {
    const data = this.getCachedData();
    return data ? data.titles : [];
  }

  /**
   * Get all occupation groups
   */
  getOccupationGroups(): OccupationGroupMapping[] {
    const data = this.getCachedData();
    return data ? data.occupation_groups : [];
  }

  /**
   * Get all occupations
   */
  getOccupations(): OccupationMapping[] {
    const data = this.getCachedData();
    return data ? data.occupations : [];
  }
}
