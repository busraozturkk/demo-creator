import { ApiClient } from '../../api-client';
import { CsvLoader, OccupationGroup } from '../../utils/csv-loader';

export interface OccupationGroupMapping {
  name: string;
  id: number;
}

export class OccupationGroupsOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async createOccupationGroups(csvPath: string): Promise<OccupationGroupMapping[]> {
    console.log(`Loading occupation groups from: ${csvPath}`);
    const groups = CsvLoader.loadOccupationGroups(csvPath);

    console.log(`Found ${groups.length} occupation groups to create\n`);

    const mappings: OccupationGroupMapping[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const displayName = group.name_de ? `${group.name} (${group.name_de})` : group.name;
      console.log(`[${i + 1}/${groups.length}] Creating: ${displayName}`);

      try {
        const value: any = { name: group.name };

        // Add name_de only if it exists
        if (group.name_de) {
          value.name_de = group.name_de;
        }

        const response = await this.apiClient.executeRequest(
          'POST',
          `/auth/applications/settings/${this.applicationId}`,
          {
            key: 'occupation_groups',
            value,
          }
        );

        // Extract ID from POST response
        // The response contains all occupation groups in data.value array
        // Find the one we just created by name
        if (response.data?.value && Array.isArray(response.data.value)) {
          const createdGroup = response.data.value.find((g: any) => g.name === group.name);
          if (createdGroup?.id) {
            mappings.push({
              name: group.name,
              id: createdGroup.id,
            });
            console.log(`Created successfully (ID: ${createdGroup.id})\n`);
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

    console.log(`Completed! Processed ${groups.length} occupation groups.\n`);
    console.log(`Collected ${mappings.length} occupation group IDs\n`);

    return mappings;
  }

  async getOccupationGroupMappings(): Promise<OccupationGroupMapping[]> {
    const response = await this.apiClient.executeRequest(
      'GET',
      `/auth/applications/settings/${this.applicationId}?key=occupation_groups`,
      undefined
    );

    console.log(`🔍 Full response:`, JSON.stringify(response, null, 2).substring(0, 3000));

    // The response structure should be: { data: { value: [{id, name, ...}] } }
    if (response.data?.value && Array.isArray(response.data.value)) {
      return response.data.value.map((group: any) => ({
        name: group.name,
        id: group.id,
      }));
    }

    return [];
  }
}
