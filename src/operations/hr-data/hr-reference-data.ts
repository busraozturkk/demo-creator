import { ApiClient } from '../../api-client';
import { ReferenceDataOperation } from './reference-data';
import * as fs from 'fs';
import * as path from 'path';

interface Gender {
  id: number;
  name: string;
}

interface Title {
  id: number;
  name: string;
}

interface Occupation {
  id: number;
  name: string;
  group_id: number;
}

interface ContractType {
  id: number;
  name: string;
}

interface QualificationGroup {
  id: number;
  name: string;
}

interface Country {
  id: number;
  name: string;
}

interface Currency {
  id: number;
  name: string;
  short_name: string;
}

export interface HrReferenceData {
  genders: Gender[];
  titles: Title[];
  occupations: Occupation[];
  contractTypes: ContractType[];
  qualificationGroups: QualificationGroup[];
  countries?: Country[];
  currencies?: Currency[];
}

export class HrReferenceDataOperation {
  private apiClient: ApiClient;
  private referenceDataOp: ReferenceDataOperation | null = null;

  constructor(apiClient: ApiClient, referenceDataOp?: ReferenceDataOperation) {
    this.apiClient = apiClient;
    this.referenceDataOp = referenceDataOp || null;
  }

  async fetchAndCache(): Promise<HrReferenceData> {
    console.log('Fetching HR reference data');

    const genders = await this.apiClient.executeRequest('GET', '/api/genders');
    console.log(`Fetched ${genders.length} genders`);

    const contractTypes = await this.apiClient.executeRequest('GET', '/api/contract-types');
    console.log(`Fetched ${contractTypes.length} contract types`);

    const qualificationGroups = await this.apiClient.executeRequest('GET', '/api/qualification-groups');
    console.log(`Fetched ${qualificationGroups.length} qualification groups`);

    // Fetch currencies from common API
    let currencies: Currency[] = [];
    try {
      const commonApiUrl = this.apiClient.getAppApiUrl().replace('innos-hr-backend.innoscripta.com', 'api.innoscripta.com/common');
      const token = this.apiClient.getBearerToken();
      const currenciesResponse = await fetch(`${commonApiUrl}/api/currencies`, {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en',
          'authorization': `Bearer ${token}`,
        }
      });
      if (currenciesResponse.ok) {
        const currenciesData = await currenciesResponse.json();
        currencies = Array.isArray(currenciesData) ? currenciesData : (currenciesData.data || []);
        console.log(`Fetched ${currencies.length} currencies`);
      } else {
        console.warn('Failed to fetch currencies, using empty array');
      }
    } catch (error) {
      console.warn('Error fetching currencies:', error);
    }

    // Get titles and occupations from cached reference data if available
    let titles: Title[] = [];
    let occupations: Occupation[] = [];

    if (this.referenceDataOp) {
      const refData = this.referenceDataOp.getCachedData();
      if (refData) {
        titles = refData.titles.map(t => ({ id: t.id, name: t.name }));
        occupations = refData.occupations.map(o => ({ id: o.id, name: o.name, group_id: o.group_id }));
        console.log(`Using cached titles (${titles.length}) and occupations (${occupations.length}) from reference data`);
      } else {
        console.warn('Reference data not cached. Titles and occupations will be empty.');
      }
    } else {
      console.warn('ReferenceDataOperation not provided. Titles and occupations will be empty.');
    }

    console.log();

    const data: HrReferenceData = {
      genders: Array.isArray(genders) ? genders : (genders.data || []),
      titles,
      occupations,
      contractTypes: Array.isArray(contractTypes) ? contractTypes : (contractTypes.data || []),
      qualificationGroups: Array.isArray(qualificationGroups) ? qualificationGroups : (qualificationGroups.data || []),
      currencies,
    };

    this.cacheData(data);

    return data;
  }

  private cacheData(data: HrReferenceData): void {
    const cacheDir = './data/cache';
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'hr-reference-data.json');
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    console.log(`Cached HR reference data to: ${cacheFile}\n`);

    console.log('=== Gender IDs ===');
    const uniqueGenders = this.removeDuplicates(data.genders, 'name');
    uniqueGenders.forEach(g => console.log(`  ${g.name}: ${g.id}`));

    console.log('\n=== Sample Title IDs ===');
    const uniqueTitles = this.removeDuplicates(data.titles, 'name');
    uniqueTitles.slice(0, 10).forEach(t => console.log(`  ${t.name}: ${t.id}`));

    console.log('\n=== Sample Occupation IDs ===');
    const uniqueOccupations = this.removeDuplicates(data.occupations, 'name');
    uniqueOccupations.slice(0, 10).forEach(o => console.log(`  ${o.name}: ${o.id}`));

    console.log('\n=== Contract Types ===');
    const uniqueContractTypes = this.removeDuplicates(data.contractTypes, 'name');
    uniqueContractTypes.forEach(ct => console.log(`  ${ct.name}: ${ct.id}`));

    console.log('\n=== Qualification Groups ===');
    const uniqueQualificationGroups = this.removeDuplicates(data.qualificationGroups, 'name');
    uniqueQualificationGroups.forEach(qg => console.log(`  ${qg.name}: ${qg.id}`));

    if (data.currencies && data.currencies.length > 0) {
      console.log('\n=== Currencies ===');
      const uniqueCurrencies = this.removeDuplicates(data.currencies, 'short_name');
      uniqueCurrencies.forEach(c => console.log(`  ${c.short_name} (${c.name}): ${c.id}`));
    }
    console.log();
  }

  private removeDuplicates<T>(arr: T[], key: keyof T): T[] {
    const seen = new Set();
    return arr.filter(item => {
      const value = item[key];
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  getCachedData(): HrReferenceData | null {
    const cacheFile = path.join('./data/cache', 'hr-reference-data.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }
}
