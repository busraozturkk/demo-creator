import { ApiClient } from '../../../api-client';
import * as fs from 'fs';
import * as path from 'path';

interface Country {
  id: number;
  name: string;
}

interface State {
  id: number;
  name: string;
  country_id: number;
}

interface City {
  id: number;
  name: string;
  state_id: number;
}

interface LocationData {
  countries: Country[];
  states: State[];
  cities: City[];
}

export class LocationIdsOperation {
  private apiClient: ApiClient;
  private cacheDir: string;

  constructor(apiClient: ApiClient, cacheDir: string = './data/cache') {
    this.apiClient = apiClient;
    this.cacheDir = cacheDir;
  }

  async fetchAndCacheLocationIds(): Promise<void> {
    console.log('Fetching location IDs\n');

    const locationData: LocationData = {
      countries: [],
      states: [],
      cities: [],
    };

    try {
      // Fetch countries
      console.log('Fetching countries');
      const countriesResponse = await this.apiClient.executeRequest('GET', '/common/api/countries', undefined);
      locationData.countries = Array.isArray(countriesResponse) ? countriesResponse : (countriesResponse.data || []);
      console.log(`Found ${locationData.countries.length} countries\n`);

      // Fetch states for key countries (Germany, USA, UK)
      const keyCountryIds = [332, 485, 484]; // Germany, USA, UK
      console.log('Fetching states for key countries');

      for (const countryId of keyCountryIds) {
        const statesResponse = await this.apiClient.executeRequest(
          'GET',
          `/common/api/states?country_id=${countryId}`,
          undefined
        );
        const states = Array.isArray(statesResponse) ? statesResponse : (statesResponse.data || []);
        if (Array.isArray(states)) {
          locationData.states.push(...states);
        }
      }
      console.log(`Found ${locationData.states.length} states\n`);

      // Fetch cities for key states (Berlin: 1388, New York: 4784, England: 4583)
      const keyStateIds = [1388, 4784, 4583];
      console.log('Fetching cities for key states (Berlin, New York, England)');

      for (const stateId of keyStateIds) {
        const citiesResponse = await this.apiClient.executeRequest(
          'GET',
          `/common/api/cities?state_id=${stateId}`,
          undefined
        );
        const cities = Array.isArray(citiesResponse) ? citiesResponse : (citiesResponse.data || []);
        if (Array.isArray(cities)) {
          locationData.cities.push(...cities);
        }
      }
      console.log(`Found ${locationData.cities.length} cities\n`);

      // Save to cache
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const cacheFile = path.join(this.cacheDir, 'location-ids.json');
      fs.writeFileSync(cacheFile, JSON.stringify(locationData, null, 2));
      console.log(`Cached location data to: ${cacheFile}\n`);

      // Export to CSV files
      this.exportToCSV(locationData);

    } catch (error) {
      console.error(`Failed to fetch location IDs: ${error}\n`);
    }
  }

  getLocationData(): LocationData | null {
    const cacheFile = path.join(this.cacheDir, 'location-ids.json');

    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }

    return null;
  }

  private exportToCSV(locationData: LocationData): void {
    // Export countries
    const countriesCSV = ['id,name,name_en,name_de'];
    locationData.countries.forEach((country: any) => {
      countriesCSV.push(`${country.id},${country.name || ''},${country.name_en || ''},${country.name_de || ''}`);
    });
    const countriesFile = path.join(this.cacheDir, 'countries.csv');
    fs.writeFileSync(countriesFile, countriesCSV.join('\n'));
    console.log(`Exported ${locationData.countries.length} countries to: ${countriesFile}`);

    // Export states
    const statesCSV = ['id,name,name_en,name_de'];
    locationData.states.forEach((state: any) => {
      statesCSV.push(`${state.id},${state.name || ''},${state.name_en || ''},${state.name_de || ''}`);
    });
    const statesFile = path.join(this.cacheDir, 'states.csv');
    fs.writeFileSync(statesFile, statesCSV.join('\n'));
    console.log(`Exported ${locationData.states.length} states to: ${statesFile}`);

    // Export cities
    const citiesCSV = ['id,name,name_en,name_de'];
    locationData.cities.forEach((city: any) => {
      citiesCSV.push(`${city.id},${city.name || ''},${city.name_en || ''},${city.name_de || ''}`);
    });
    const citiesFile = path.join(this.cacheDir, 'cities.csv');
    fs.writeFileSync(citiesFile, citiesCSV.join('\n'));
    console.log(`Exported ${locationData.cities.length} cities to: ${citiesFile}\n`);
  }
}
