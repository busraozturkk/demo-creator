import axios from 'axios';

export class AccountRegistrationOperation {
    private readonly registerUrl: string;

    constructor() {
        this.registerUrl = 'https://api.innoscripta.com/auth/innos/register';
    }

    async registerAccount(
        email: string,
        password: string,
        firstName: string,
        lastName: string,
        phoneNumber: string,
        companyName: string,
        companyId: number
    ): Promise<void> {
        try {
            console.log(`Registering account for: ${email}`);

            const response = await axios.post(
                this.registerUrl,
                {
                    email,
                    password,
                    repeat_password: password,
                    account_type: 'organization',
                    first_name: firstName,
                    last_name: lastName,
                    phone_number: phoneNumber,
                    country_code: 'DE',
                    company_name: companyName,
                    company_id: companyId
                },
                {
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Content-Type': 'application/json',
                        'Origin': 'https://clusterix.io',
                        'Referer': 'https://clusterix.io/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
                    }
                }
            );

            console.log('Account registration successful');
            console.log('Activation email sent to:', email);

        } catch (error: any) {
            console.error('Registration error details:');
            if (error.response) {
                console.error('  Status:', error.response.status);
                console.error('  Status Text:', error.response.statusText);
                console.error('  Response Data:', JSON.stringify(error.response.data, null, 2));
                throw new Error(`Registration failed: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
            }
            console.error('  Error:', error.message);
            throw new Error(`Registration failed: ${error.message}`);
        }
    }
}
