import { ApiClient } from '../../../api-client';
import { CsvLoader, Title } from '../../../utils/csv-loader';

export class TitlesOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async createTitles(csvPath: string): Promise<void> {
    console.log(`Loading titles from: ${csvPath}`);
    const titles = CsvLoader.loadTitles(csvPath);

    console.log(`Found ${titles.length} titles to create\n`);

    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      const displayName = title.name_de ? `${title.name} (${title.name_de})` : title.name;
      console.log(`[${i + 1}/${titles.length}] Creating: ${displayName}`);

      try {
        const value: any = { name: title.name };

        if (title.name_de) {
          value.name_de = title.name_de;
        }

        await this.apiClient.executeRequest(
          'POST',
          `/auth/applications/settings/${this.applicationId}`,
          {
            key: 'titles',
            value,
          }
        );

        console.log(`Created successfully\n`);
      } catch (error) {
        console.error(`Failed to create: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${titles.length} titles.`);
  }
}
