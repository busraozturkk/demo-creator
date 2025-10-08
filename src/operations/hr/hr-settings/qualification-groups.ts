import { ApiClient } from '../../../api-client';
import { CsvLoader, QualificationGroup } from '../../../utils/csv-loader';

export class QualificationGroupsOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async createQualificationGroups(csvPath: string): Promise<void> {
    console.log(`Loading qualification groups from: ${csvPath}`);
    const groups = CsvLoader.loadQualificationGroups(csvPath);

    console.log(`Found ${groups.length} qualification groups to create\n`);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      console.log(`[${i + 1}/${groups.length}] Creating: ${group.name} (${group.name_de})`);

      try {
        const response = await this.apiClient.executeRequest(
          'POST',
          `/auth/applications/settings/${this.applicationId}`,
          {
            key: 'qualification_groups',
            value: {
              name: group.name,
              name_de: group.name_de,
            },
          }
        );

        console.log(`Created successfully\n`);
      } catch (error) {
        console.error(`Failed to create: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${groups.length} qualification groups.`);
  }
}
