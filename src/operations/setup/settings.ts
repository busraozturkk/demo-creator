import { ApiClient } from '../../api-client';

export class SettingsOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async updateSetting(key: string, value: any): Promise<void> {
    console.log(`Updating setting: ${key} = ${value}`);

    try {
      await this.apiClient.executeRequest(
        'POST',
        `/auth/applications/settings/${this.applicationId}`,
        {
          key,
          value,
        }
      );

      console.log(`Updated successfully\n`);
    } catch (error) {
      console.error(`Failed to update: ${error}\n`);
    }
  }
}
