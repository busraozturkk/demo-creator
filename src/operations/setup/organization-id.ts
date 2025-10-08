import { ApiClient } from '../../api-client';
import { AuthService } from '../../auth';
import * as fs from 'fs';
import * as path from 'path';

interface UserData {
  id: number;
  organization_id: number;
}

export class OrganizationIdOperation {
  private apiClient: ApiClient;
  private authService: AuthService;

  constructor(apiClient: ApiClient, authService: AuthService) {
    this.apiClient = apiClient;
    this.authService = authService;
  }

  async fetchAndCache(): Promise<number> {
    console.log('Fetching organization ID (partner ID)');

    const userId = this.authService.getUserId();
    const response = await this.apiClient.executeRequest(
      'GET',
      `/auth/users/${userId}`
    );

    const organizationId = response.data.organization_id;

    // Save to cache
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'organization-id.json');
    fs.writeFileSync(cacheFile, JSON.stringify({ organization_id: organizationId }, null, 2));

    console.log(`Organization ID (Partner ID): ${organizationId}`);
    console.log(`Saved to: ${cacheFile}\n`);

    return organizationId;
  }

  getOrganizationId(): number | null {
    const cacheFile = path.join('./data/cache', 'organization-id.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.organization_id;
    }
    return null;
  }
}
