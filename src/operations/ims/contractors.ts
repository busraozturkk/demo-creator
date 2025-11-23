import { ApiClient } from '../../api-client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface ContractorData {
  title: string;
  legal_form_country_id: number;
  tax_number: string;
  country_id: number;
  state_name: string;
  city_name: string;
  postcode: string;
  street: string;
  building: string;
  optional: string;
}

interface ContractorMapping {
  title: string;
  id: number;
  country_id: number;
  state_id: number;
  city_id: number;
}

interface LocationCache {
  countries: Array<{ id: number; name: string }>;
  states: { [country_id: number]: Array<{ id: number; name: string }> };
  cities: { [state_id: number]: Array<{ id: number; name: string }> };
  legalForms: { [country_id: number]: Array<{ id: number; name: string }> };
}

export class ContractorsOperation {
  private imsApiClient: ApiClient;
  private commonApiClient: ApiClient;
  private locationCache: LocationCache;

  constructor(imsApiClient: ApiClient, commonApiClient: ApiClient) {
    this.imsApiClient = imsApiClient;
    this.commonApiClient = commonApiClient;
    this.locationCache = {
      countries: [],
      states: {},
      cities: {},
      legalForms: {}
    };
  }

  async createContractors(csvPath: string, organizationId: number): Promise<ContractorMapping[]> {
    console.log(`\n=== Creating Contractors ===`);
    console.log(`Loading contractors from: ${csvPath}`);

    const contractorsData = this.loadContractors(csvPath);
    console.log(`Found ${contractorsData.length} contractors to create\n`);

    // Load location data (cached for performance)
    await this.loadLocationData();

    const mappings: ContractorMapping[] = [];
    let created = 0;
    let errors = 0;

    for (const contractor of contractorsData) {
      try {
        console.log(`[${created + errors + 1}/${contractorsData.length}] Creating: ${contractor.title}`);

        // Get location IDs
        const stateId = await this.getStateId(contractor.country_id, contractor.state_name);
        const cityId = await this.getCityId(stateId, contractor.city_name);
        const legalFormId = await this.getLegalFormId(contractor.country_id);

        // Create contractor
        const response = await this.imsApiClient.executeRequest(
          'POST',
          '/api/contractors',
          {
            isOpen: true,
            id: 0,
            title: contractor.title,
            legal_form_id: legalFormId,
            tax_number: contractor.tax_number,
            country_id: contractor.country_id,
            state_id: stateId,
            city_id: cityId,
            postcode: contractor.postcode,
            street: contractor.street,
            building: contractor.building,
            optional: contractor.optional,
            restrictToEUCountries: false
          },
          { 'partner-id': organizationId.toString() }
        );

        const contractorId = response.data?.id || response.id;

        mappings.push({
          title: contractor.title,
          id: contractorId,
          country_id: contractor.country_id,
          state_id: stateId,
          city_id: cityId
        });

        console.log(`  ✓ Created successfully (ID: ${contractorId})`);
        created++;
      } catch (error: any) {
        console.error(`  ✗ Failed to create: ${error.message}`);
        errors++;
      }
    }

    console.log(`\nContractor Creation Summary:`);
    console.log(`  - Created: ${created}`);
    console.log(`  - Errors: ${errors}\n`);

    // Save mappings to cache
    this.saveContractorMappings(mappings);

    return mappings;
  }

  private async loadLocationData(): Promise<void> {
    console.log('Loading location reference data...');

    // Check if location-ids cache exists
    const locationCachePath = './data/cache/location-ids.json';
    if (fs.existsSync(locationCachePath)) {
      console.log('  ✓ Using cached location data\n');
      this.locationCache = JSON.parse(fs.readFileSync(locationCachePath, 'utf-8'));
      return;
    }

    console.log('  Fetching location data from API...');

    // Fetch countries
    const countriesResponse = await this.commonApiClient.executeRequest('GET', '/common/api/countries');
    this.locationCache.countries = countriesResponse.data || countriesResponse;
    console.log(`  ✓ Loaded ${this.locationCache.countries.length} countries`);
  }

  private async getStateId(countryId: number, stateName: string): Promise<number> {
    // Check cache first
    if (!this.locationCache.states[countryId]) {
      // Fetch states for this country
      const statesResponse = await this.commonApiClient.executeRequest(
        'GET',
        `/api/states?country_id=${countryId}`
      );
      this.locationCache.states[countryId] = statesResponse.data || statesResponse;
    }

    const state = this.locationCache.states[countryId].find(
      s => s.name.toLowerCase() === stateName.toLowerCase()
    );

    if (!state) {
      throw new Error(`State not found: ${stateName} in country ${countryId}`);
    }

    return state.id;
  }

  private async getCityId(stateId: number, cityName: string): Promise<number> {
    // Check cache first
    if (!this.locationCache.cities[stateId]) {
      // Fetch cities for this state
      const citiesResponse = await this.commonApiClient.executeRequest(
        'GET',
        `/api/cities?state_id=${stateId}`
      );
      this.locationCache.cities[stateId] = citiesResponse.data || citiesResponse;
    }

    const city = this.locationCache.cities[stateId].find(
      c => c.name.toLowerCase() === cityName.toLowerCase()
    );

    if (!city) {
      throw new Error(`City not found: ${cityName} in state ${stateId}`);
    }

    return city.id;
  }

  private async getLegalFormId(countryId: number): Promise<number> {
    // Check cache first
    if (!this.locationCache.legalForms[countryId]) {
      // Fetch legal forms for this country
      const legalFormsResponse = await this.commonApiClient.executeRequest(
        'GET',
        `/api/legal-forms?country_id=${countryId}`
      );
      this.locationCache.legalForms[countryId] = legalFormsResponse.data || legalFormsResponse;
    }

    // Return first legal form for simplicity (usually GmbH for Germany)
    if (this.locationCache.legalForms[countryId].length > 0) {
      return this.locationCache.legalForms[countryId][0].id;
    }

    throw new Error(`No legal forms found for country ${countryId}`);
  }

  private loadContractors(csvPath: string): ContractorData[] {
    const absolutePath = path.resolve(csvPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Contractors file not found: ${absolutePath}`);
    }

    const fileContent = fs.readFileSync(absolutePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      title: record.title,
      legal_form_country_id: parseInt(record.legal_form_country_id),
      tax_number: record.tax_number,
      country_id: parseInt(record.country_id),
      state_name: record.state_name,
      city_name: record.city_name,
      postcode: record.postcode,
      street: record.street,
      building: record.building,
      optional: record.optional,
    }));
  }

  private saveContractorMappings(mappings: ContractorMapping[]): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'contractor-mappings.json');
    fs.writeFileSync(cacheFile, JSON.stringify(mappings, null, 2));
    console.log(`Saved ${mappings.length} contractor mappings to: ${cacheFile}\n`);
  }

  /**
   * Assign contractors to projects
   * Each project gets 1-2 random contractors
   */
  async assignContractorsToProjects(
    projectMappings: Array<{ short_title: string; id: number; partnership_id?: number }>,
    organizationId: number
  ): Promise<void> {
    console.log(`\n=== Assigning Contractors to Projects ===`);

    // Load contractor mappings
    const contractorMappingsPath = './data/cache/contractor-mappings.json';
    if (!fs.existsSync(contractorMappingsPath)) {
      console.log('  ✗ Contractor mappings not found. Skipping contractor assignments.\n');
      return;
    }

    const contractorMappings: ContractorMapping[] = JSON.parse(
      fs.readFileSync(contractorMappingsPath, 'utf-8')
    );

    if (contractorMappings.length === 0) {
      console.log('  ✗ No contractors available. Skipping assignments.\n');
      return;
    }

    console.log(`Total projects: ${projectMappings.length}`);
    console.log(`Available contractors: ${contractorMappings.length}\n`);

    let assigned = 0;
    let errors = 0;

    // Contractor types (from UI dropdown)
    const contractorTypes = [
      { id: 1, name: 'Subcontractor' },
      { id: 2, name: 'Supplier' },
      { id: 3, name: 'Consultant' }
    ];

    for (const project of projectMappings) {
      if (!project.partnership_id) {
        console.log(`  Skipping ${project.short_title}: No partnership ID`);
        continue;
      }

      // Randomly assign 1-2 contractors per project
      const numContractors = Math.floor(Math.random() * 2) + 1; // 1 or 2
      console.log(`\n  Project: ${project.short_title} (Partnership ID: ${project.partnership_id})`);
      console.log(`  Assigning ${numContractors} contractor(s)...`);

      // Randomly select contractors
      const selectedContractors = this.selectRandomContractors(contractorMappings, numContractors);

      for (const contractor of selectedContractors) {
        try {
          // Step 1: Attach contractor to project
          await this.imsApiClient.executeRequest(
            'POST',
            `/api/contractors/${contractor.id}/attach`,
            { partnership_id: project.partnership_id },
            { 'partner-id': organizationId.toString() }
          );

          // Step 2: Update project details
          const contractorType = contractorTypes[Math.floor(Math.random() * contractorTypes.length)];
          const orderDate = this.generateRandomOrderDate();

          await this.imsApiClient.executeRequest(
            'PUT',
            `/api/contractors/${contractor.id}/update-project-details`,
            {
              partnership_id: project.partnership_id,
              contractor_type_id: contractorType.id,
              description: `${contractorType.name} services for ${project.short_title}`,
              order_date: orderDate
            },
            { 'partner-id': organizationId.toString() }
          );

          console.log(`    ✓ ${contractor.title} (${contractorType.name})`);
          assigned++;
        } catch (error: any) {
          console.log(`    ✗ Failed to assign ${contractor.title}: ${error.message}`);
          errors++;
        }
      }
    }

    console.log(`\nContractor Assignment Summary:`);
    console.log(`  - Assignments created: ${assigned}`);
    console.log(`  - Errors: ${errors}\n`);
  }

  private selectRandomContractors(contractors: ContractorMapping[], count: number): ContractorMapping[] {
    const shuffled = [...contractors].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, contractors.length));
  }

  private generateRandomOrderDate(): string {
    // Generate order date within last 6 months
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(today.getMonth() - 6);

    const randomTime = sixMonthsAgo.getTime() + Math.random() * (today.getTime() - sixMonthsAgo.getTime());
    const randomDate = new Date(randomTime);

    return randomDate.toISOString().split('T')[0];
  }
}
