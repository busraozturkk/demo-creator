import { ApiClient } from '../../api-client';
import { CsvLoader, LegalRequirement } from '../../utils/csv-loader';
import * as fs from 'fs';
import * as path from 'path';

interface LegalRequirementMapping {
  title: string;
  country_id: number;
  id: number;
}

export class LegalRequirementsOperation {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async fetchAndCache(): Promise<LegalRequirementMapping[]> {
    console.log('Fetching legal requirements');
    const response = await this.apiClient.executeRequest('GET', '/api/legal-requirements');

    const requirements = Array.isArray(response) ? response : (response.data || []);
    const mappings: LegalRequirementMapping[] = requirements.map((req: any) => ({
      title: req.title,
      country_id: req.country_id,
      id: req.id,
    }));

    console.log(`Found ${mappings.length} legal requirements`);
    mappings.forEach(r => console.log(`  ${r.title} (Country: ${r.country_id}): ${r.id}`));
    console.log();

    this.saveMappings(mappings);
    return mappings;
  }

  private saveMappings(mappings: LegalRequirementMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'legal-requirement-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved legal requirement mappings to: ${cacheFile}\n`);
  }

  getMappings(): LegalRequirementMapping[] | null {
    const cacheFile = path.join('./data/cache', 'legal-requirement-mappings.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }

  async createLegalRequirements(csvPath: string): Promise<void> {
    console.log(`Loading legal requirements from: ${csvPath}`);
    const legalRequirements = CsvLoader.loadLegalRequirements(csvPath);

    console.log(`Found ${legalRequirements.length} legal requirements to create\n`);

    for (let i = 0; i < legalRequirements.length; i++) {
      const requirement = legalRequirements[i];
      console.log(`[${i + 1}/${legalRequirements.length}] Creating: ${requirement.title}`);

      try {
        await this.apiClient.executeRequest(
          'POST',
          '/api/legal-requirements',
          requirement
        );

        console.log(`Created successfully\n`);
      } catch (error) {
        console.error(`Failed to create: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${legalRequirements.length} legal requirements.`);

    // After creating legal requirements, fetch and cache their IDs
    console.log('Fetching created legal requirement IDs\n');
    await this.fetchAndCache();
  }
}
