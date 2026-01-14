import axios from 'axios';
import { AuthService } from '../../auth';

export class ChildCompanyCreationOperation {
    private readonly companyToken: string;
    private readonly myOrgApiUrl: string;

    constructor() {
        // Force reload environment variables
        require('dotenv').config({ override: true });

        const token = process.env.COMPANY_CREATION_TOKEN;

        if (!token) {
            throw new Error(
                'Missing COMPANY_CREATION_TOKEN in .env file.\n' +
                'Please add your personal token from Clusterix platform.\n' +
                'See DEPLOYMENT.md for instructions on how to get a new token.'
            );
        }

        this.companyToken = token;
        this.myOrgApiUrl = 'https://my-organization-backend.innoscripta.com/api';
    }

    /**
     * Create a child company using COMPANY_CREATION_TOKEN
     */
    async createChildCompany(companyName: string): Promise<number> {
        try {
            console.log(`Creating child company: ${companyName}`);

            const authHeader = this.companyToken.startsWith('Bearer ')
                ? this.companyToken
                : `Bearer ${this.companyToken}`;

            const response = await axios.post(
                `${this.myOrgApiUrl}/company/external`,
                {
                    company_name: companyName,
                    legal_form: "2058",
                    website: "",
                    company_type_id: 12,
                    tax_country_id: 332,
                    clusterix_fetch_status: "ready_to_fetch",
                    clusterix_related_company_id: null,
                    external_control_auth: true,
                    currency: "3",
                    tax_number: "",
                    employer_identifier_number: ""
                },
                {
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Authorization': authHeader,
                        'Content-Type': 'application/json',
                        'Content-Language': 'en',
                        'Origin': 'https://app.clusterix.io',
                        'Referer': 'https://app.clusterix.io/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                    },
                    validateStatus: () => true
                }
            );

            console.log('Child company creation response status:', response.status);

            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`API returned status ${response.status}: ${JSON.stringify(response.data)}`);
            }

            const childCompanyId = response.data?.data?.id;

            if (!childCompanyId) {
                console.error('Full response:', response.data);
                throw new Error('No child company ID returned from API');
            }

            console.log(`Child company created successfully with ID: ${childCompanyId}`);
            return childCompanyId;

        } catch (error: any) {
            console.error('Failed to create child company');
            console.error('Error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Link child company to parent company via shareholder relationship
     */
    async linkChildToParent(
        parentCompanyId: number,
        childCompanyId: number,
        authService: AuthService
    ): Promise<void> {
        try {
            console.log(`Linking child company ${childCompanyId} to parent ${parentCompanyId}`);

            const userToken = authService.getBearerToken();
            if (!userToken) {
                throw new Error('No user token available for shareholder linking');
            }

            const response = await axios.post(
                `${this.myOrgApiUrl}/shareholder`,
                {
                    shares_quantity: 60,
                    parent_company_id: parentCompanyId,
                    child_company_id: childCompanyId,
                    shareholders_connection_type_id: 1,
                    dominant_influence: true
                },
                {
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Authorization': `Bearer ${userToken}`,
                        'Content-Type': 'application/json',
                        'Content-Language': 'en',
                        'Origin': 'https://app.clusterix.io',
                        'Referer': 'https://app.clusterix.io/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                    },
                    validateStatus: () => true
                }
            );

            console.log('Shareholder linking response status:', response.status);

            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`Shareholder API returned status ${response.status}: ${JSON.stringify(response.data)}`);
            }

            console.log('Child company successfully linked to parent via shareholder relationship');

        } catch (error: any) {
            console.error('Failed to link child to parent company');
            console.error('Error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Full flow: Create child company and link to parent
     */
    async createAndLinkChildCompany(
        companyName: string,
        parentCompanyId: number,
        authService: AuthService
    ): Promise<number> {
        // Step 1: Create child company
        const childCompanyId = await this.createChildCompany(companyName);

        // Step 2: Link via shareholder relationship
        await this.linkChildToParent(parentCompanyId, childCompanyId, authService);

        return childCompanyId;
    }
}
