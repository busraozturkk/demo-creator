import { ApiClient } from '../../api-client';

interface DefaultItem {
  id: number;
  name: string;
  created_at: string;
  [key: string]: any;
}

export class CleanDefaultsOperation {
  private apiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, applicationId: string = '3') {
    this.apiClient = apiClient;
    this.applicationId = applicationId;
  }

  /**
   * Get unique items by keeping only the oldest entry for each name
   */
  private getUniqueItems(items: DefaultItem[]): { keep: DefaultItem[]; remove: DefaultItem[] } {
    const nameMap = new Map<string, DefaultItem[]>();

    // Group items by name
    items.forEach(item => {
      if (!nameMap.has(item.name)) {
        nameMap.set(item.name, []);
      }
      nameMap.get(item.name)!.push(item);
    });

    const keep: DefaultItem[] = [];
    const remove: DefaultItem[] = [];

    // For each name, keep the oldest (first created) and mark others for removal
    nameMap.forEach(group => {
      if (group.length === 1) {
        keep.push(group[0]);
      } else {
        // Sort by creation date (oldest first)
        group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        keep.push(group[0]);
        remove.push(...group.slice(1));
      }
    });

    return { keep, remove };
  }

  async cleanDuplicateTitles(): Promise<void> {
    console.log('Fetching existing titles');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=titles`
      );

      const titles = response.data?.value || [];
      console.log(`Found ${titles.length} total titles\n`);

      const { keep, remove } = this.getUniqueItems(titles);

      console.log(`Unique titles: ${keep.length}`);
      console.log(`Duplicate titles to remove: ${remove.length}\n`);

      if (remove.length === 0) {
        console.log('No duplicate titles to remove\n');
        return;
      }

      // Show what will be kept
      console.log('Titles to keep:');
      keep.forEach(title => {
        console.log(`  - ${title.name} (ID: ${title.id})`);
      });
      console.log();

      // Delete duplicates
      for (let i = 0; i < remove.length; i++) {
        const title = remove[i];
        console.log(`[${i + 1}/${remove.length}] Deleting duplicate: ${title.name} (ID: ${title.id})`);

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

      console.log(`\nCompleted! Removed ${remove.length} duplicate titles.\n`);
    } catch (error) {
      console.error(`Failed to fetch titles: ${error}\n`);
    }
  }

  async cleanDuplicateOccupationGroups(): Promise<void> {
    console.log('Fetching existing occupation groups');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=occupation_groups`
      );

      const groups = response.data?.value || [];
      console.log(`Found ${groups.length} total occupation groups\n`);

      const { keep, remove } = this.getUniqueItems(groups);

      console.log(`Unique occupation groups: ${keep.length}`);
      console.log(`Duplicate occupation groups to remove: ${remove.length}\n`);

      if (remove.length === 0) {
        console.log('No duplicate occupation groups to remove\n');
        return;
      }

      // Show what will be kept
      console.log('Occupation groups to keep:');
      keep.forEach(group => {
        console.log(`  - ${group.name} (ID: ${group.id})`);
      });
      console.log();

      // Delete duplicates
      for (let i = 0; i < remove.length; i++) {
        const group = remove[i];
        console.log(`[${i + 1}/${remove.length}] Deleting duplicate: ${group.name} (ID: ${group.id})`);

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

      console.log(`\nCompleted! Removed ${remove.length} duplicate occupation groups.\n`);
    } catch (error) {
      console.error(`Failed to fetch occupation groups: ${error}\n`);
    }
  }

  async cleanDuplicateOccupations(): Promise<void> {
    console.log('Fetching existing occupations');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=occupations`
      );

      const occupations = response.data?.value || [];
      console.log(`Found ${occupations.length} total occupations\n`);

      const { keep, remove } = this.getUniqueItems(occupations);

      console.log(`Unique occupations: ${keep.length}`);
      console.log(`Duplicate occupations to remove: ${remove.length}\n`);

      if (remove.length === 0) {
        console.log('No duplicate occupations to remove\n');
        return;
      }

      // Show what will be kept
      console.log('Occupations to keep:');
      keep.forEach(occupation => {
        console.log(`  - ${occupation.name} (ID: ${occupation.id})`);
      });
      console.log();

      // Delete duplicates
      for (let i = 0; i < remove.length; i++) {
        const occupation = remove[i];
        console.log(`[${i + 1}/${remove.length}] Deleting duplicate: ${occupation.name} (ID: ${occupation.id})`);

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

      console.log(`\nCompleted! Removed ${remove.length} duplicate occupations.\n`);
    } catch (error) {
      console.error(`Failed to fetch occupations: ${error}\n`);
    }
  }

  async deleteAllDefaults(): Promise<void> {
    console.log('=== Starting Deletion of All Default Data ===\n');

    // Delete in order: occupations first (they may depend on groups), then groups, then titles
    await this.deleteAllOccupations();
    await this.deleteAllOccupationGroups();
    await this.deleteAllTitles();

    console.log('=== All Default Data Deleted ===\n');
  }

  private async deleteAllOccupations(): Promise<void> {
    console.log('Deleting all occupations');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=occupations`
      );

      const occupations = response.data?.value || [];
      console.log(`Found ${occupations.length} occupations to delete\n`);

      if (occupations.length === 0) {
        console.log('No occupations to delete\n');
        return;
      }

      for (let i = 0; i < occupations.length; i++) {
        const occupation = occupations[i];
        console.log(`[${i + 1}/${occupations.length}] Deleting: ${occupation.name} (ID: ${occupation.id})`);

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

      console.log(`\nCompleted! Deleted ${occupations.length} occupations.\n`);
    } catch (error) {
      console.error(`Failed to fetch occupations: ${error}\n`);
    }
  }

  private async deleteAllOccupationGroups(): Promise<void> {
    console.log('Deleting all occupation groups');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=occupation_groups`
      );

      const groups = response.data?.value || [];
      console.log(`Found ${groups.length} occupation groups to delete\n`);

      if (groups.length === 0) {
        console.log('No occupation groups to delete\n');
        return;
      }

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        console.log(`[${i + 1}/${groups.length}] Deleting: ${group.name} (ID: ${group.id})`);

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

      console.log(`\nCompleted! Deleted ${groups.length} occupation groups.\n`);
    } catch (error) {
      console.error(`Failed to fetch occupation groups: ${error}\n`);
    }
  }

  private async deleteAllTitles(): Promise<void> {
    console.log('Deleting all titles');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}?key=titles`
      );

      const titles = response.data?.value || [];
      console.log(`Found ${titles.length} titles to delete\n`);

      if (titles.length === 0) {
        console.log('No titles to delete\n');
        return;
      }

      for (let i = 0; i < titles.length; i++) {
        const title = titles[i];
        console.log(`[${i + 1}/${titles.length}] Deleting: ${title.name} (ID: ${title.id})`);

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

      console.log(`\nCompleted! Deleted ${titles.length} titles.\n`);
    } catch (error) {
      console.error(`Failed to fetch titles: ${error}\n`);
    }
  }

  async cleanAllDuplicates(): Promise<void> {
    console.log('=== Starting Cleanup of Duplicate Default Data ===\n');

    // Clean in order: occupations first (they may depend on groups), then groups, then titles
    await this.cleanDuplicateOccupations();
    await this.cleanDuplicateOccupationGroups();
    await this.cleanDuplicateTitles();

    console.log('=== Duplicate Cleanup Completed ===\n');
  }
}