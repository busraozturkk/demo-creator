import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface OtherCostData {
  title: string;
  purpose_id: number;
  type_id: number;
  detail_title: string;
}

interface CostMapping {
  title: string;
  cost_id: number;
  detail_id: number;
  detail_title: string;
}

export class OtherCostsOperation {
  private imsApiClient: ApiClient;

  constructor(imsApiClient: ApiClient) {
    this.imsApiClient = imsApiClient;
  }

  async createOtherCosts(csvPath: string, organizationId: number, language: string = 'en'): Promise<CostMapping[]> {
    console.log(`\n=== Creating Other Costs ===`);
    console.log(`Loading other costs from: ${csvPath}`);

    const costsData = this.loadOtherCosts(csvPath);
    console.log(`Found ${costsData.length} cost items to create\n`);

    const mappings: CostMapping[] = [];
    let created = 0;
    let errors = 0;

    // Group by cost title to create cost and its details together
    const costGroups = new Map<string, OtherCostData[]>();
    for (const cost of costsData) {
      if (!costGroups.has(cost.title)) {
        costGroups.set(cost.title, []);
      }
      costGroups.get(cost.title)!.push(cost);
    }

    for (const [costTitle, costItems] of costGroups.entries()) {
      try {
        console.log(`[${created + errors + 1}/${costGroups.size}] Creating: ${costTitle}`);

        // Step 1: Create the cost
        const firstItem = costItems[0];
        const costResponse = await this.imsApiClient.executeRequest(
          'POST',
          '/api/costs',
          {
            title: costTitle,
            purpose_id: firstItem.purpose_id,
            type_id: firstItem.type_id,
            partner_id: organizationId
          },
          { 'partner-id': organizationId.toString() }
        );

        const costId = costResponse.data?.id || costResponse.id;
        console.log(`  ✓ Cost created (ID: ${costId})`);

        // Step 2: Create cost details for each item
        for (const item of costItems) {
          try {
            const detailResponse = await this.imsApiClient.executeRequest(
              'POST',
              '/api/cost-details',
              {
                id: -1,
                cost_id: costId,
                title: item.detail_title
              },
              { 'partner-id': organizationId.toString() }
            );

            const detailId = detailResponse.data?.id || detailResponse.id;

            mappings.push({
              title: costTitle,
              cost_id: costId,
              detail_id: detailId,
              detail_title: item.detail_title
            });

            console.log(`    ✓ Detail created: ${item.detail_title} (ID: ${detailId})`);
          } catch (error: any) {
            console.error(`    ✗ Failed to create detail ${item.detail_title}: ${error.message}`);
          }
        }

        created++;
      } catch (error: any) {
        console.error(`  ✗ Failed to create cost: ${error.message}`);
        errors++;
      }
    }

    console.log(`\nOther Costs Creation Summary:`);
    console.log(`  - Costs created: ${created}`);
    console.log(`  - Errors: ${errors}`);
    console.log(`  - Total cost details: ${mappings.length}\n`);

    // Save mappings to cache
    this.saveCostMappings(mappings, language);

    return mappings;
  }

  async assignCostsToProjects(
    projectMappings: Array<{ short_title: string; id: number; partnership_id?: number }>,
    organizationId: number,
    language: string = 'en'
  ): Promise<void> {
    console.log(`\n=== Assigning Other Costs to Projects ===`);

    // Load cost mappings
    const costMappingsPath = `./data/cache/other-cost-mappings-${language}.json`;
    if (!fs.existsSync(costMappingsPath)) {
      console.log('  ✗ Other cost mappings not found. Skipping cost assignments.\n');
      return;
    }

    const costMappings: CostMapping[] = JSON.parse(
      fs.readFileSync(costMappingsPath, 'utf-8')
    );

    if (costMappings.length === 0) {
      console.log('  ✗ No other costs available. Skipping assignments.\n');
      return;
    }

    console.log(`Total projects: ${projectMappings.length}`);
    console.log(`Available cost details: ${costMappings.length}\n`);

    let assigned = 0;
    let errors = 0;

    for (const project of projectMappings) {
      if (!project.id) {
        console.log(`  Skipping ${project.short_title}: No project ID`);
        continue;
      }

      // Randomly assign 2-4 cost items per project
      const numCosts = Math.floor(Math.random() * 3) + 2; // 2-4
      console.log(`\n  Project: ${project.short_title} (ID: ${project.id})`);
      console.log(`  Assigning ${numCosts} cost item(s)...`);

      // Randomly select cost details
      const selectedCosts = this.selectRandomCosts(costMappings, numCosts);

      for (const cost of selectedCosts) {
        try {
          // Assign cost to project
          await this.imsApiClient.executeRequest(
            'POST',
            `/api/partnership-costs/${cost.cost_id}/assign-partnership`,
            {
              project_id: project.id,
              cost_detail_id: cost.detail_id
            },
            { 'partner-id': organizationId.toString() }
          );

          console.log(`    ✓ ${cost.title} - ${cost.detail_title}`);
          assigned++;
        } catch (error: any) {
          console.log(`    ✗ Failed to assign ${cost.title}: ${error.message}`);
          errors++;
        }
      }
    }

    console.log(`\nOther Costs Assignment Summary:`);
    console.log(`  - Assignments created: ${assigned}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  private loadOtherCosts(csvPath: string): OtherCostData[] {
    const absolutePath = path.resolve(csvPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Other costs file not found: ${absolutePath}`);
    }

    const fileContent = fs.readFileSync(absolutePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      title: record.title,
      purpose_id: parseInt(record.purpose_id),
      type_id: parseInt(record.type_id),
      detail_title: record.detail_title,
    }));
  }

  private saveCostMappings(mappings: CostMapping[], language: string = 'en'): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, `other-cost-mappings-${language}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved ${mappings.length} other cost mappings to: ${cacheFile}\n`);
  }

  private selectRandomCosts(costs: CostMapping[], count: number): CostMapping[] {
    const shuffled = [...costs].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, costs.length));
  }
}
