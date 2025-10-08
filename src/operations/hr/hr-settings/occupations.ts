import { ApiClient } from '../../../api-client';
import { CsvLoader, Occupation } from '../../../utils/csv-loader';
import { OccupationGroupMapping } from './occupation-groups';
import * as fs from 'fs';
import * as path from 'path';

export interface OccupationMapping {
  name: string;
  id: number;
  group_id: number;
}

export class OccupationsOperation {
  private apiClient: ApiClient;
  private applicationId: string;
  private cacheDir: string = './data/cache';
  private cacheFile: string = 'occupation-mappings.json';

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async createOccupations(
    csvPath: string,
    groupMappings: OccupationGroupMapping[]
  ): Promise<OccupationMapping[]> {
    console.log(`Loading occupations (roles) from: ${csvPath}`);
    const occupations = CsvLoader.loadOccupations(csvPath);

    console.log(`Found ${occupations.length} occupations to create\n`);

    // Create a map for quick lookup
    const groupMap = new Map<string, number>();
    groupMappings.forEach((mapping) => {
      groupMap.set(mapping.name, mapping.id);
    });

    const mappings: OccupationMapping[] = [];

    for (let i = 0; i < occupations.length; i++) {
      const occupation = occupations[i];
      const groupId = groupMap.get(occupation.group_name);

      if (!groupId) {
        console.log(
          `[${i + 1}/${occupations.length}] Skipping: ${occupation.name} - Group "${occupation.group_name}" not found\n`
        );
        continue;
      }

      const displayName = occupation.name_de
        ? `${occupation.name} (${occupation.name_de})`
        : occupation.name;
      console.log(
        `[${i + 1}/${occupations.length}] Creating: ${displayName} in group "${occupation.group_name}" (ID: ${groupId})`
      );

      try {
        const value: any = {
          group_id: groupId,
          name: occupation.name,
        };

        // Add name_de only if it exists
        if (occupation.name_de) {
          value.name_de = occupation.name_de;
        }

        const response = await this.apiClient.executeRequest(
          'POST',
          `/auth/applications/settings/${this.applicationId}`,
          {
            key: 'occupations',
            value,
          }
        );

        // Extract ID from POST response
        // The response contains all occupations in data.value array
        // Find the one we just created by name and group_id
        if (response.data?.value && Array.isArray(response.data.value)) {
          const createdOccupation = response.data.value.find(
            (o: any) => o.name === occupation.name && o.group_id === groupId
          );
          if (createdOccupation?.id) {
            mappings.push({
              name: occupation.name,
              id: createdOccupation.id,
              group_id: groupId,
            });
            console.log(`Created successfully (ID: ${createdOccupation.id})\n`);
          } else {
            console.log(`Created successfully\n`);
          }
        } else {
          console.log(`Created successfully\n`);
        }
      } catch (error) {
        console.error(`Failed to create: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${occupations.length} occupations.`);
    console.log(`Collected ${mappings.length} occupation IDs\n`);

    // Save mappings to cache
    if (mappings.length > 0) {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const cachePath = path.join(this.cacheDir, this.cacheFile);
      fs.writeFileSync(cachePath, JSON.stringify(mappings, null, 2));
      console.log(`Saved occupation mappings to: ${cachePath}\n`);
    }

    return mappings;
  }

  getOccupationMappings(): OccupationMapping[] | null {
    const cachePath = path.join(this.cacheDir, this.cacheFile);

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to read occupation mappings: ${error}`);
      return null;
    }
  }
}
