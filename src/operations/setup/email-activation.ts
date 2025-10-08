import puppeteer from 'puppeteer';

export class EmailActivationOperation {
    private readonly maxRetries = 20;
    private readonly retryDelay = 5000; // 5 seconds

    /**
     * Extract the Yopmail username from email
     */
    private extractYopmailUsername(email: string): string {
        const match = email.match(/^(.+)@yopmail\.com$/);
        if (!match) {
            throw new Error('Email must be a yopmail.com address');
        }
        return match[1];
    }

    /**
     * Wait for a specified duration
     */
    private async wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Activate account using Puppeteer
     */
    async activateAccount(email: string): Promise<void> {
        const username = this.extractYopmailUsername(email);
        const yopmailUrl = `https://yopmail.com/en/?login=${username}`;

        console.log(`Opening Yopmail for: ${username}`);
        console.log('Waiting for activation email...');

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');

            // Go to Yopmail inbox
            console.log('Loading Yopmail inbox...');
            await page.goto(yopmailUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait a bit for inbox to load
            await this.wait(3000);

            let activationLink: string | null = null;

            // Retry logic to wait for email
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                console.log(`Attempt ${attempt}/${this.maxRetries}: Checking for activation email...`);

                try {
                    // Refresh the inbox by clicking the refresh button or reloading
                    if (attempt > 1) {
                        console.log('Refreshing inbox...');
                        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                        await this.wait(2000);
                    }

                    // Switch to the inbox iframe
                    const iframeElement = await page.$('iframe#ifinbox');
                    if (iframeElement) {
                        const iframe = await iframeElement.contentFrame();
                        if (iframe) {
                            // Check if there are any emails
                            const emails = await iframe.$$('div.m');
                            console.log(`Found ${emails.length} email(s) in inbox`);

                            if (emails.length > 0) {
                                // Click on the first/latest email
                                console.log('Opening latest email...');
                                await emails[0].click();
                                await this.wait(2000);

                                // Switch to the email content iframe
                                const mailIframeElement = await page.$('iframe#ifmail');
                                if (mailIframeElement) {
                                    const mailIframe = await mailIframeElement.contentFrame();
                                    if (mailIframe) {
                                        // Get all the text content
                                        const content = await mailIframe.content();

                                        // Look for activation link
                                        const linkMatch = content.match(/https:\/\/clusterix\.io\/activate\/[a-zA-Z0-9_-]+/);
                                        if (linkMatch) {
                                            activationLink = linkMatch[0];
                                            console.log('Activation link found!');
                                            break;
                                        } else {
                                            console.log('Email received but no activation link found');
                                        }
                                    }
                                }
                            } else {
                                console.log('No emails in inbox yet, waiting...');
                            }
                        }
                    }

                    if (attempt < this.maxRetries) {
                        await this.wait(this.retryDelay);
                    }

                } catch (error: any) {
                    console.warn(`Attempt ${attempt} error: ${error.message}`);
                    if (attempt < this.maxRetries) {
                        await this.wait(this.retryDelay);
                    }
                }
            }

            if (!activationLink) {
                throw new Error(`No activation email received after ${this.maxRetries} attempts`);
            }

            // Click the activation link
            console.log(`Activating account: ${activationLink}`);
            const activationPage = await browser.newPage();
            await activationPage.goto(activationLink, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.wait(2000);

            console.log('Account activated successfully!');

        } finally {
            await browser.close();
        }
    }
}
