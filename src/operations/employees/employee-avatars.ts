import { ApiClient } from '../../api-client';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import axios from 'axios';

interface EmployeeMapping {
    email: string;
    id: number;
}

interface AvatarMapping {
    email_username: string;
    avatar_filename: string;
}

export class EmployeeAvatarsOperation {
    private apiClient: ApiClient;

    constructor(apiClient: ApiClient) {
        this.apiClient = apiClient;
    }

    async uploadSingleAvatar(employeeId: number, avatarPath: string): Promise<void> {
        await this.uploadAvatar(employeeId, avatarPath);
    }

    async uploadAvatars(
        avatarsDir: string,
        avatarMappingsCsv: string,
        employeeMappings: EmployeeMapping[]
    ): Promise<void> {
        // First, try to upload owner avatar if it exists
        const ownerAvatarPath = path.join(avatarsDir, 'owner.jpeg');
        const ownerAvatarPathJpg = path.join(avatarsDir, 'owner.jpg');
        const actualOwnerPath = fs.existsSync(ownerAvatarPath) ? ownerAvatarPath :
                               fs.existsSync(ownerAvatarPathJpg) ? ownerAvatarPathJpg : null;

        if (actualOwnerPath) {
            console.log(`Uploading owner employee avatar from: ${actualOwnerPath}`);
            try {
                const ownerEmployee = employeeMappings.find(e => {
                    // Owner employee should have user_id property
                    return (e as any).user_id !== undefined;
                });

                if (ownerEmployee) {
                    await this.uploadAvatar(ownerEmployee.id, actualOwnerPath);
                    console.log('Owner avatar uploaded successfully\n');
                } else {
                    console.log('Owner employee not found in mappings\n');
                }
            } catch (error) {
                console.error(`Failed to upload owner avatar: ${error}\n`);
            }
        } else {
            console.log('Owner avatar file not found (looked for owner.jpeg and owner.jpg)\n');
        }

        console.log(`Loading avatar mappings from: ${avatarMappingsCsv}`);

        // Parse CSV manually (simple format: email_username,avatar_filename)
        const csvContent = fs.readFileSync(avatarMappingsCsv, 'utf-8');
        const lines = csvContent.trim().split('\n');
        const headers = lines[0].split(',');

        const avatarMappings: AvatarMapping[] = lines.slice(1).map(line => {
            const values = line.split(',');
            return {
                email_username: values[0].trim(),
                avatar_filename: values[1].trim(),
            };
        });

        console.log(`Found ${avatarMappings.length} avatar mappings for regular employees\n`);

        for (let i = 0; i < avatarMappings.length; i++) {
            const mapping = avatarMappings[i];
            console.log(`[${i + 1}/${avatarMappings.length}] Uploading avatar for: ${mapping.email_username}`);

            try {
                // Find employee ID
                const employee = employeeMappings.find(
                    e => e.email.startsWith(mapping.email_username)
                );

                if (!employee) {
                    console.error(`Employee not found for username: ${mapping.email_username}\n`);
                    continue;
                }

                // Check if avatar file exists
                const avatarPath = path.join(avatarsDir, mapping.avatar_filename);
                if (!fs.existsSync(avatarPath)) {
                    console.error(`Avatar file not found: ${avatarPath}\n`);
                    continue;
                }

                // Upload avatar
                await this.uploadAvatar(employee.id, avatarPath);
                console.log(`Avatar uploaded successfully\n`);
            } catch (error) {
                console.error(`Error: Failed to upload avatar: ${error}\n`);
            }
        }

        console.log(`Completed! Processed ${avatarMappings.length} avatars.`);
    }

    private async uploadAvatar(employeeId: number, avatarPath: string): Promise<void> {
        const form = new FormData();
        const filename = path.basename(avatarPath);

        // Determine content type based on file extension
        const ext = path.extname(avatarPath).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' :
            ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                ext === '.gif' ? 'image/gif' :
                    'image/jpeg';

        // Use stream for form-data
        const fileStream = fs.createReadStream(avatarPath);

        form.append('avatar', fileStream, {
            filename: filename,
            contentType: contentType,
        });

        // Use the API client to get token and base URL
        const token = this.apiClient.getBearerToken();
        const baseUrl = this.apiClient.getAppApiUrl();

        try {
            await axios.post(
                `${baseUrl}/api/employees/${employeeId}/avatar`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        ...form.getHeaders(),
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                }
            );
        } catch (error: any) {
            if (error.response) {
                const errorData = error.response.data;
                const errorMessage = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
                throw new Error(`HTTP ${error.response.status}: ${errorMessage}`);
            }
            throw error;
        }
    }
}