import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export class CompanyCreationOperation {
    private readonly token: string;
    private readonly apiUrl: string;

    constructor() {
        const token = process.env.COMPANY_CREATION_TOKEN;

        if (!token) {
            throw new Error(
                'Missing COMPANY_CREATION_TOKEN in .env file.\n' +
                'Please add your personal token from Clusterix platform.\n' +
                'See DEPLOYMENT.md for instructions on how to get a new token.'
            );
        }

        this.token = token;
        this.apiUrl = process.env.COMPANY_CREATION_API_URL ||
                     'https://company-searcher-api.innoscripta.com/api/company-information/create-company';
    }

    async createCompany(companyName: string): Promise<number> {
        try {
            console.log(`Creating company: ${companyName}`);
            console.log(`API URL: ${this.apiUrl}`);

            const requestData = {
                company_name: companyName,
                country_id: 84,
                site: `https://${companyName.toLowerCase().replace(/\s+/g, '-')}.com`
            };

            console.log('Request data:', JSON.stringify(requestData, null, 2));

            const response = await axios.post(
                this.apiUrl,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://clusterix.io/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
                    },
                    validateStatus: () => true // Accept all status codes to see response
                }
            );

            console.log('Response status:', response.status);
            console.log('Response headers:', JSON.stringify(response.headers, null, 2));
            console.log('Response data type:', typeof response.data);
            console.log('Response data:', JSON.stringify(response.data, null, 2));

            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`API returned status ${response.status}: ${JSON.stringify(response.data)}`);
            }

            // Try different possible response structures
            const companyId = response.data?.data?.company_id ||
                            response.data?.company_id ||
                            response.data?.data?.id ||
                            response.data?.id;

            if (!companyId) {
                console.error('Full response object:', response);
                console.error('Could not find company ID in response data');
                throw new Error('No ID returned from API. Response: ' + JSON.stringify(response.data));
            }

            console.log(`Successfully created company with ID: ${companyId}`);
            return companyId;

        } catch (error: any) {
            console.error('Full error object:', error);
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);
            console.error('Error code:', error.code);

            if (error.response) {
                console.error('Error response status:', error.response.status);
                console.error('Error response data:', error.response.data);
                console.error('Error response headers:', error.response.headers);

                if (error.response.status === 401) {
                    throw new Error('Authorization token expired. Please update the token.');
                }
                throw new Error(`API error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            }

            if (error.request) {
                console.error('Request was made but no response received');
                console.error('Request:', error.request);
                throw new Error('No response from server. Check network connection.');
            }

            throw new Error(error.message);
        }
    }
}
