import { ApiClient } from '../../api-client';

interface DefaultItem {
  id: number;
  name: string;
  created_at: string;
  [key: string]: any;
}

export class CleanDefaultsFromModuleOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  async deleteAllDefaults(): Promise<void> {
    console.log('=== Starting Deletion of All Default Data from Module Endpoint ===\n');

    // Fetch module data
    const response = await this.apiClient.executeRequest(
      'GET',
      `/auth/applications/settings/${this.applicationId}/module?module=general`
    );

    const sections = response.data?.sections;
    if (!sections) {
      console.log('No sections found in module data\n');
      return;
    }

    // Delete default occupations (group_id: null and early created_at)
    await this.deleteDefaultOccupations(sections.occupations?.settings?.occupations?.value || []);

    // Delete default occupation groups (HR, IT with early created_at)
    await this.deleteDefaultOccupationGroups(sections.form_options?.settings?.occupation_groups?.value || []);

    // Delete default titles (Dr., Dr.Med. with early created_at)
    await this.deleteDefaultTitles(sections.form_options?.settings?.titles?.value || []);

    console.log('=== All Default Data Deleted ===\n');
  }

  private async deleteDefaultOccupations(occupations: DefaultItem[]): Promise<void> {
    console.log('Deleting default occupations');

    // Find defaults: occupations with group_id: null or very early creation time
    const defaults = occupations.filter(occ =>
      occ.group_id === null || occ.group_id === undefined
    );

    console.log(`Found ${defaults.length} default occupations to delete\n`);

    if (defaults.length === 0) {
      console.log('No default occupations to delete\n');
      return;
    }

    for (let i = 0; i < defaults.length; i++) {
      const occupation = defaults[i];
      console.log(`[${i + 1}/${defaults.length}] Deleting: ${occupation.name} (ID: ${occupation.id})`);

      try {
        await this.apiClient.executeRequest(
          'DELETE',
          `/auth/applications/settings/${this.applicationId}`,
          { key: 'occupations', id: occupation.id }
        );
        console.log('Deleted successfully');
      } catch (error) {
        console.error(`Failed to delete: ${error}`);
      }
    }

    console.log(`\nCompleted! Deleted ${defaults.length} default occupations.\n`);
  }

  private async deleteDefaultOccupationGroups(groups: DefaultItem[]): Promise<void> {
    console.log('Deleting default occupation groups');

    // Find defaults: HR and IT groups (can check by name or by early creation time)
    const defaultNames = ['HR', 'IT'];
    const defaults = groups.filter(group =>
      defaultNames.includes(group.name)
    );

    console.log(`Found ${defaults.length} default occupation groups to delete\n`);

    if (defaults.length === 0) {
      console.log('No default occupation groups to delete\n');
      return;
    }

    for (let i = 0; i < defaults.length; i++) {
      const group = defaults[i];
      console.log(`[${i + 1}/${defaults.length}] Deleting: ${group.name} (ID: ${group.id})`);

      try {
        await this.apiClient.executeRequest(
          'DELETE',
          `/auth/applications/settings/${this.applicationId}`,
          { key: 'occupation_groups', id: group.id }
        );
        console.log('Deleted successfully');
      } catch (error) {
        console.error(`Failed to delete: ${error}`);
      }
    }

    console.log(`\nCompleted! Deleted ${defaults.length} default occupation groups.\n`);
  }

  private async deleteDefaultTitles(titles: DefaultItem[]): Promise<void> {
    console.log('Deleting default titles');

    // Find defaults: Dr. and Dr.Med. (can check by name or by early creation time)
    const defaultNames = ['Dr.', 'Dr.Med.'];
    const defaults = titles.filter(title =>
      defaultNames.includes(title.name)
    );

    console.log(`Found ${defaults.length} default titles to delete\n`);

    if (defaults.length === 0) {
      console.log('No default titles to delete\n');
      return;
    }

    for (let i = 0; i < defaults.length; i++) {
      const title = defaults[i];
      console.log(`[${i + 1}/${defaults.length}] Deleting: ${title.name} (ID: ${title.id})`);

      try {
        await this.apiClient.executeRequest(
          'DELETE',
          `/auth/applications/settings/${this.applicationId}`,
          { key: 'titles', id: title.id }
        );
        console.log('Deleted successfully');
      } catch (error) {
        console.error(`Failed to delete: ${error}`);
      }
    }

    console.log(`\nCompleted! Deleted ${defaults.length} default titles.\n`);
  }
}
