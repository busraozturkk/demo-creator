import { ApiClient } from '../../api-client';

export class CleanupOperation {
  private apiClient: ApiClient;
  private hrApiClient: ApiClient;
  private applicationId: string;

  constructor(apiClient: ApiClient, hrApiClient: ApiClient, applicationId: string) {
    this.apiClient = apiClient;
    this.hrApiClient = hrApiClient;
    this.applicationId = applicationId;
  }

  async deleteAllOccupationGroups(): Promise<void> {
    console.log('Fetching existing occupation groups');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}/occupation-groups`
      );

      const groups = Array.isArray(response) ? response : (response.data || []);
      console.log(`Found ${groups.length} occupation groups to delete\n`);

      if (groups.length === 0) {
        console.log('No occupation groups to delete\n');
        return;
      }

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        console.log(`[${i + 1}/${groups.length}] Deleting occupation group: ${group.name} (ID: ${group.id})`);

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

  async deleteAllOccupations(): Promise<void> {
    console.log('Fetching existing occupations (roles)');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}/occupations`
      );

      const occupations = Array.isArray(response) ? response : (response.data || []);
      console.log(`Found ${occupations.length} occupations to delete\n`);

      if (occupations.length === 0) {
        console.log('No occupations to delete\n');
        return;
      }

      for (let i = 0; i < occupations.length; i++) {
        const occupation = occupations[i];
        console.log(`[${i + 1}/${occupations.length}] Deleting occupation: ${occupation.name} (ID: ${occupation.id})`);

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

  async deleteAllTitles(): Promise<void> {
    console.log('Fetching existing titles');

    try {
      const response = await this.apiClient.executeRequest(
        'GET',
        `/auth/applications/settings/${this.applicationId}/titles`
      );

      const titles = Array.isArray(response) ? response : (response.data || []);
      console.log(`Found ${titles.length} titles to delete\n`);

      if (titles.length === 0) {
        console.log('No titles to delete\n');
        return;
      }

      for (let i = 0; i < titles.length; i++) {
        const title = titles[i];
        console.log(`[${i + 1}/${titles.length}] Deleting title: ${title.name} (ID: ${title.id})`);

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

  async deleteAllEmployees(): Promise<void> {
    console.log('Fetching existing employees');

    try {
      const response = await this.hrApiClient.executeRequest(
        'GET',
        '/api/employees?per_page=1000'
      );

      const employees = Array.isArray(response) ? response : (response.data || []);
      console.log(`Found ${employees.length} employees to delete\n`);

      if (employees.length === 0) {
        console.log('No employees to delete\n');
        return;
      }

      for (let i = 0; i < employees.length; i++) {
        const employee = employees[i];
        console.log(`[${i + 1}/${employees.length}] Deleting employee: ${employee.first_name} ${employee.last_name} (ID: ${employee.id})`);

        try {
          await this.hrApiClient.executeRequest(
            'DELETE',
            `/api/employees/${employee.id}`
          );
          console.log('Deleted successfully');
        } catch (error) {
          console.error(`Failed to delete: ${error}`);
        }
      }

      console.log(`\nCompleted! Deleted ${employees.length} employees.\n`);
    } catch (error) {
      console.error(`Failed to fetch employees: ${error}\n`);
    }
  }

  async cleanupAll(): Promise<void> {
    console.log('=== Starting Cleanup of Default Data ===\n');

    // Delete employees first
    await this.deleteAllEmployees();

    // Delete in order: occupations first (they depend on groups), then groups, then titles
    await this.deleteAllOccupations();
    await this.deleteAllOccupationGroups();
    await this.deleteAllTitles();

    console.log('=== Cleanup Completed ===\n');
  }
}
