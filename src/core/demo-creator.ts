/**
 * Demo Creator - Full automation mode
 *
 * This module contains the main demo creation logic that runs all steps
 * in sequence to create a complete demo account.
 */

import { overrideConsole, restoreConsole } from '../server/console-utils';

export async function runDemoCreation(
    socket: any,
    dataGroup: string,
    emailDomain: string,
    email: string,
    password: string,
    environment: string = 'testing',
    companyName?: string,
    selectedProjects: string[] = [],
    includeWorkPackages: boolean = true
) {
    // Override console for this execution
    overrideConsole(socket);

    try {
        socket.emit('log', { type: 'info', message: 'Demo Creator Starting' });
        socket.emit('log', { type: 'info', message: `Environment: ${environment.toUpperCase()}` });

        // Clean cache before starting new demo
        socket.emit('log', { type: 'info', message: '\n=== Cleaning Previous Demo Cache ===' });
        const fs = await import('fs');
        const path = await import('path');
        const cacheDir = './data/cache';
        const filesToDelete = [
            'employee-mappings.json',
            'project-mappings.json',
            'department-mappings.json',
            'team-mappings.json',
            'work-package-intervals.json',
            'task-year-pm-assignments.json',
            'organization-id.json',
            'wp-employee-assignments.json',
            'task-folder-mappings.json',
            'task-board-mappings.json',
            'user-partnership-pms.json'
        ];

        for (const file of filesToDelete) {
            const filePath = path.join(cacheDir, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                socket.emit('log', { type: 'info', message: `  ✓ Deleted ${file}` });
            }
        }
        socket.emit('log', { type: 'success', message: 'Cache cleaned successfully\n' });

        // Step 0: Create company
        let companyId: number | undefined;
        if (companyName) {
            socket.emit('log', { type: 'info', message: '\n=== Step 0: Creating Company ===' });
            try {
                const { CompanyCreationOperation } = await import('../operations/setup/company-creation');
                const companyCreationOp = new CompanyCreationOperation();
                companyId = await companyCreationOp.createCompany(companyName);
                socket.emit('log', { type: 'success', message: `Company created successfully with ID: ${companyId}\n` });
            } catch (error: any) {
                socket.emit('log', { type: 'error', message: `Company creation failed: ${error.message}` });
                throw error; // Stop execution if company creation fails
            }
        }

        // Step 1: Register account
        if (companyId && email && password && companyName) {
            socket.emit('log', { type: 'info', message: '\n=== Step 1: Registering Account ===' });
            try {
                const { AccountRegistrationOperation } = await import('../operations/setup/account-registration');
                const registrationOp = new AccountRegistrationOperation();

                // Use default German female name and valid German phone number
                const defaultFirstName = 'Anna';
                const defaultLastName = 'Schmidt';
                const defaultPhoneNumber = '+49 30 12345678'; // Valid German phone number (Berlin area code)

                await registrationOp.registerAccount(email, password, defaultFirstName, defaultLastName, defaultPhoneNumber, companyName, companyId);
                socket.emit('log', { type: 'success', message: 'Account registered successfully\n' });
            } catch (error: any) {
                socket.emit('log', { type: 'error', message: `Account registration failed: ${error.message}` });
                throw error; // Stop execution if registration fails
            }
        }

        // Step 2: Activate account via Yopmail
        if (email) {
            socket.emit('log', { type: 'info', message: '\n=== Step 2: Activating Account ===' });
            try {
                const { EmailActivationOperation } = await import('../operations/setup/email-activation');
                const activationOp = new EmailActivationOperation();
                await activationOp.activateAccount(email);
                socket.emit('log', { type: 'success', message: 'Account activated successfully\n' });
            } catch (error: any) {
                socket.emit('log', { type: 'error', message: `Account activation failed: ${error.message}` });
                throw error; // Stop execution if activation fails
            }
        }

        const { AuthService } = await import('../auth');
        const { ApiClient } = await import('../api-client');
        const { parseEnvironment, getEnvironmentConfig, getCredentials } = await import('../environment');

        // Parse environment and get config
        const env = parseEnvironment(environment);
        const envConfig = getEnvironmentConfig(env);
        const credentials = getCredentials(env);

        socket.emit('log', { type: 'info', message: `API Base: ${envConfig.apiBaseUrl}` });

        // Login
        socket.emit('log', { type: 'info', message: 'Logging in' });
        const authService = new AuthService(envConfig.loginUrl);

        // Use provided credentials or fall back to .env credentials
        const loginEmail = email || credentials.email;
        const loginPassword = password || credentials.password;

        await authService.login(loginEmail, loginPassword);
        socket.emit('log', { type: 'success', message: 'Successfully authenticated!' });

        const apiClient = new ApiClient(authService, envConfig.apiBaseUrl);
        const hrApiClient = new ApiClient(authService, envConfig.hrApiBaseUrl);
        const taskManagementApiClient = new ApiClient(authService, envConfig.taskManagementApiBaseUrl);
        const imsCustomersApiClient = new ApiClient(authService, envConfig.imsCustomersApiBaseUrl);

        // Fetch current user information
        socket.emit('log', { type: 'info', message: 'Fetching current user information' });
        const userInfo: any = await apiClient.executeRequest('GET', `/auth/users/${authService.getUserId()}`);
        socket.emit('log', { type: 'info', message: `Current user: ${userInfo.name || userInfo.data?.name || 'Unknown'} (ID: ${userInfo.id || userInfo.data?.id})` });

        socket.emit('log', { type: 'info', message: `Using data group: ${dataGroup}` });

        // Organization ID
        const { OrganizationIdOperation } = await import('../operations/setup/organization-id');
        const organizationIdOp = new OrganizationIdOperation(apiClient, authService);
        const organizationId = await organizationIdOp.fetchAndCache();
        apiClient.setPartnerId(organizationId.toString());
        imsCustomersApiClient.setPartnerId(organizationId.toString());

        // Clean defaults
        socket.emit('log', { type: 'info', message: '\n=== Step 1: Cleaning default data ===' });
        try {
            const { CleanDefaultsFromModuleOperation } = await import('../operations/utilities/clean-defaults-from-module');
            const cleanDefaultsOp = new CleanDefaultsFromModuleOperation(apiClient, '3');
            await cleanDefaultsOp.deleteAllDefaults();
            socket.emit('log', { type: 'success', message: 'Clean defaults completed\n' });
        } catch (error: any) {
            socket.emit('log', { type: 'error', message: `Clean defaults failed: ${error.message}` });
            console.error('Clean defaults error details:', error);
            socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
        }

        // Location IDs
        const { LocationIdsOperation } = await import('../operations/hr/hr-settings/location-ids');
        const locationIdsOp = new LocationIdsOperation(apiClient);
        const cachedLocations = locationIdsOp.getLocationData();
        if (!cachedLocations) {
            await locationIdsOp.fetchAndCacheLocationIds();
        }

        // Qualification Groups
        const qualificationGroupsPath = `./data/${dataGroup}/qualification-groups.csv`;
        if (fs.existsSync(qualificationGroupsPath)) {
            const { QualificationGroupsOperation } = await import('../operations/hr/hr-settings/qualification-groups');
            const qualificationGroupsOp = new QualificationGroupsOperation(apiClient, '3');
            await qualificationGroupsOp.createQualificationGroups(qualificationGroupsPath);
        }

        // Titles
        const titlesPath = `./data/${dataGroup}/titles.csv`;
        if (fs.existsSync(titlesPath)) {
            const { TitlesOperation } = await import('../operations/hr/hr-settings/titles');
            const titlesOp = new TitlesOperation(apiClient, '3');
            await titlesOp.createTitles(titlesPath);
        }

        // Reference Data
        socket.emit('log', { type: 'info', message: 'Step 2: Fetching reference data' });
        const { ReferenceDataOperation } = await import('../operations/hr/hr-settings/reference-data');
        const referenceDataOp = new ReferenceDataOperation(apiClient, '3');
        await referenceDataOp.fetchAndCache();

        // Settings
        const { SettingsOperation } = await import('../operations/setup/settings');
        const settingsOp = new SettingsOperation(apiClient, '3');
        await settingsOp.updateSetting('default_days_off_number', '24');

        // Offices
        const officesPath = `./data/${dataGroup}/offices.csv`;
        const { OfficesOperation } = await import('../operations/hr/hr-settings/offices');
        const officesOp = new OfficesOperation(hrApiClient);
        if (fs.existsSync(officesPath)) {
            await officesOp.createOffices(officesPath);
        }

        // Legal Requirements
        const legalRequirementsPath = `./data/${dataGroup}/legal-requirements.csv`;
        const { LegalRequirementsOperation } = await import('../operations/time-tracking/legal-requirements');
        const legalRequirementsOp = new LegalRequirementsOperation(taskManagementApiClient);
        if (fs.existsSync(legalRequirementsPath)) {
            await legalRequirementsOp.createLegalRequirements(legalRequirementsPath);
        }

        // HR Reference Data
        socket.emit('log', { type: 'info', message: 'Step 3: Fetching HR reference data' });
        const { HrReferenceDataOperation } = await import('../operations/hr/hr-settings/hr-reference-data');
        const hrReferenceDataOp = new HrReferenceDataOperation(hrApiClient, referenceDataOp);
        await hrReferenceDataOp.fetchAndCache();

        // Day Off Types
        const { DayOffTypesOperation } = await import('../operations/hr/hr-settings/day-off-types');
        const dayOffTypesOp = new DayOffTypesOperation(hrApiClient);
        await dayOffTypesOp.fetchAndCache();

        // Owner Employee
        socket.emit('log', { type: 'info', message: '\n=== Creating Owner Employee ===' });
        try {
            const { OwnerEmployeeOperation } = await import('../operations/hr/employees/owner-employee');
            const ownerEmployeeOp = new OwnerEmployeeOperation(apiClient, hrApiClient, authService);
            await ownerEmployeeOp.createOwnerEmployee();
            socket.emit('log', { type: 'success', message: 'Owner employee created\n' });

            // Update owner employee details
            socket.emit('log', { type: 'info', message: 'Updating owner employee details' });
            await ownerEmployeeOp.updateOwnerEmployeeDetails(hrReferenceDataOp);
            socket.emit('log', { type: 'success', message: 'Owner employee setup completed\n' });
        } catch (error: any) {
            socket.emit('log', { type: 'error', message: `Owner employee creation failed: ${error.message}` });
            console.error('Owner employee creation error:', error);
            socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
        }

        // Employees
        socket.emit('log', { type: 'info', message: '\n=== Creating Employees ===' });
        const employeesPath = `./data/${dataGroup}/employees.csv`;
        let employeeMappings = null;
        if (fs.existsSync(employeesPath)) {
            try {
                const { EmployeesOperation } = await import('../operations/hr/employees/employees');
                const employeesOp = new EmployeesOperation(hrApiClient, hrReferenceDataOp, officesOp, apiClient);
                await employeesOp.createEmployees(employeesPath, emailDomain, { ownerEmail: loginEmail });
                employeeMappings = employeesOp.getMappings();
                socket.emit('log', { type: 'success', message: `Employees created: ${employeeMappings?.length || 0} employees\n` });
            } catch (error: any) {
                socket.emit('log', { type: 'error', message: `Employee creation failed: ${error.message}` });
                console.error('Employee creation error:', error);
                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
            }
        } else {
            socket.emit('log', { type: 'warning', message: `Employees file not found: ${employeesPath}\n` });
        }

        if (employeeMappings) {
            const employeesOp = new (await import('../operations/hr/employees/employees')).EmployeesOperation(hrApiClient, hrReferenceDataOp, officesOp, apiClient);

            // Employee Details
            socket.emit('log', { type: 'info', message: '\n=== Updating Employee Details ===' });
            const employeeDetailsPath = `./data/${dataGroup}/employee-details.csv`;
            if (fs.existsSync(employeeDetailsPath)) {
                try {
                    await employeesOp.updateEmployeeDetails(employeeDetailsPath, emailDomain);
                    socket.emit('log', { type: 'success', message: 'Employee details updated\n' });
                } catch (error: any) {
                    socket.emit('log', { type: 'error', message: `Employee details update failed: ${error.message}` });
                    console.error('Employee details error:', error);
                    socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                }
            } else {
                socket.emit('log', { type: 'warning', message: `Employee details file not found\n` });
            }

            // Update owner employee contract first
            socket.emit('log', { type: 'info', message: '\n=== Updating Owner Employee Contract ===' });
            try {
                const { OwnerEmployeeOperation: OwnerEmpOp } = await import('../operations/hr/employees/owner-employee');
                const ownerEmpOp = new OwnerEmpOp(apiClient, hrApiClient, authService);
                const contractStartDate = await ownerEmpOp.updateOwnerEmployeeContract(hrReferenceDataOp, legalRequirementsOp);
                socket.emit('log', { type: 'success', message: 'Owner employee contract updated\n' });

                // Add salary for owner employee (use contract start date)
                if (contractStartDate) {
                    socket.emit('log', { type: 'info', message: '\n=== Adding Owner Employee Salary ===' });
                    await ownerEmpOp.addOwnerEmployeeSalary(80000, contractStartDate);
                    socket.emit('log', { type: 'success', message: 'Owner employee salary added\n' });
                }
            } catch (error: any) {
                socket.emit('log', { type: 'error', message: `Owner contract update failed: ${error.message}` });
                console.error('Owner contract error:', error);
                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
            }

            // Employee Contracts
            socket.emit('log', { type: 'info', message: '\n=== Updating Employee Contracts ===' });
            const employeeContractsPath = `./data/${dataGroup}/employee-contracts.csv`;
            if (fs.existsSync(employeeContractsPath) && employeeMappings) {
                try {
                    const { EmployeeContractsOperation } = await import('../operations/hr/employees/employee-contracts');
                    const employeeContractsOp = new EmployeeContractsOperation(hrApiClient, hrReferenceDataOp, legalRequirementsOp);
                    await employeeContractsOp.updateEmployeeContracts(employeeContractsPath, employeeMappings, employeeDetailsPath);
                    socket.emit('log', { type: 'success', message: 'Employee contracts updated\n' });
                } catch (error: any) {
                    socket.emit('log', { type: 'error', message: `Employee contracts update failed: ${error.message}` });
                    console.error('Employee contracts error:', error);
                    socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                }
            } else {
                socket.emit('log', { type: 'warning', message: `Employee contracts file not found or no employee mappings\n` });
            }

            // Note: Avatar upload moved to the end to prevent deletion during user assignment

            // Salary & Contributions
            if (employeeMappings && employeeMappings.length > 0) {
                const { EmployeeSalaryPrefillOperation } = await import('../operations/hr/employees/employee-salary-prefill');
                const salaryPrefillOp = new EmployeeSalaryPrefillOperation(hrApiClient);
                const salariesPath = `./data/${dataGroup}/employee-salaries.csv`;
                await salaryPrefillOp.loadSalaryData(salariesPath);
                await salaryPrefillOp.prefillSalaryRecords(employeeMappings);
                await salaryPrefillOp.prefillEmployerContributions(employeeMappings);

                // Days Off
                const { EmployeeDaysOffOperation } = await import('../operations/hr/employees/employee-days-off');
                const daysOffOp = new EmployeeDaysOffOperation(hrApiClient, dayOffTypesOp);
                await daysOffOp.createDaysOff(employeeMappings);

                // Departments
                const departmentsPath = `./data/${dataGroup}/departments.csv`;
                if (fs.existsSync(departmentsPath)) {
                    socket.emit('log', { type: 'info', message: '\n=== Creating Departments ===' });
                    try {
                        const { DepartmentsOperation } = await import('../operations/hr/hr-settings/departments');
                        const departmentsOp = new DepartmentsOperation(hrApiClient);
                        const departmentMappings = await departmentsOp.createDepartments(
                            departmentsPath,
                            employeeMappings,
                            emailDomain
                        );
                        socket.emit('log', { type: 'success', message: `✓ Departments created: ${departmentMappings?.length || 0}\n` });

                        // Occupations (Roles) - link to departments
                        const occupationsPath = `./data/${dataGroup}/occupations.csv`;
                        if (fs.existsSync(occupationsPath) && departmentMappings.length > 0) {
                            socket.emit('log', { type: 'info', message: '\n=== Creating Occupations (Roles) ===' });
                            try {
                                const { OccupationsOperation } = await import('../operations/hr/hr-settings/occupations');
                                const occupationsOp = new OccupationsOperation(apiClient, '3');
                                await occupationsOp.createOccupations(occupationsPath, departmentMappings);
                                socket.emit('log', { type: 'success', message: 'Occupations (roles) created and linked to departments\n' });
                            } catch (error: any) {
                                socket.emit('log', { type: 'error', message: `Occupations creation failed: ${error.message}` });
                                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                            }
                        }

                        // Teams
                        const teamsPath = `./data/${dataGroup}/teams.csv`;
                        if (fs.existsSync(teamsPath) && departmentMappings.length > 0) {
                            socket.emit('log', { type: 'info', message: '\n=== Creating Teams ===' });
                            try {
                                const { TeamsOperation } = await import('../operations/hr/hr-settings/teams');
                                const teamsOp = new TeamsOperation(hrApiClient);
                                await teamsOp.createTeams(
                                    teamsPath,
                                    employeeMappings,
                                    departmentMappings,
                                    emailDomain
                                );
                                socket.emit('log', { type: 'success', message: 'Teams created\n' });
                            } catch (error: any) {
                                socket.emit('log', { type: 'error', message: `Teams creation failed: ${error.message}` });
                                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                            }
                        }

                        // C-level
                        const cLevelPath = `./data/${dataGroup}/c-level.csv`;
                        if (fs.existsSync(cLevelPath) && departmentMappings.length > 0) {
                            socket.emit('log', { type: 'info', message: '\n=== Assigning C-Level ===' });
                            try {
                                const { CLevelOperation } = await import('../operations/hr/employees/c-level');
                                const cLevelOp = new CLevelOperation(hrApiClient);
                                await cLevelOp.assignCLevel(
                                    cLevelPath,
                                    employeeMappings,
                                    departmentMappings,
                                    emailDomain
                                );
                                socket.emit('log', { type: 'success', message: 'C-level assigned\n' });
                            } catch (error: any) {
                                socket.emit('log', { type: 'error', message: `C-level assignment failed: ${error.message}` });
                                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                            }
                        }
                    } catch (error: any) {
                        socket.emit('log', { type: 'error', message: `Departments creation failed: ${error.message}` });
                        socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                    }
                }

                // Projects
                const projectsPath = `./data/${dataGroup}/projects.csv`;
                if (fs.existsSync(projectsPath)) {
                    socket.emit('log', { type: 'info', message: '\n=== Creating Projects ===' });
                    try {
                        const { ProjectsOperation } = await import('../operations/project-management/projects');
                        const projectsOp = new ProjectsOperation(imsCustomersApiClient, apiClient);
                        const projectMappings = await projectsOp.createProjects(projectsPath, undefined, selectedProjects);
                        socket.emit('log', { type: 'success', message: `✓ Projects created: ${projectMappings?.length || 0}\n` });

                        // Milestones
                        const milestonesPath = `./data/${dataGroup}/milestones.csv`;
                        if (projectMappings.length > 0 && fs.existsSync(milestonesPath)) {
                            socket.emit('log', { type: 'info', message: '\n=== Creating Milestones ===' });
                            try {
                                const { MilestonesOperation } = await import('../operations/project-management/milestones');
                                const milestonesOp = new MilestonesOperation(apiClient);
                                const milestoneMappings = await milestonesOp.createMilestones(milestonesPath, projectMappings);
                                socket.emit('log', { type: 'success', message: `✓ Milestones created: ${milestoneMappings?.length || 0}\n` });

                                // If work packages are NOT enabled, configure milestones for R&D assignment
                                if (!includeWorkPackages && milestoneMappings.length > 0) {
                                    socket.emit('log', { type: 'info', message: '\n=== Configuring Milestones for R&D ===' });
                                    try {
                                        // Enable R&D assignment (use organizationId as partner)
                                        await milestonesOp.enableRAndDForMilestones(milestoneMappings, projectMappings, organizationId);
                                        socket.emit('log', { type: 'success', message: '✓ R&D assignment enabled\n' });

                                        // Set periods
                                        await milestonesOp.setMilestonePeriods(milestoneMappings, projectMappings);
                                        socket.emit('log', { type: 'success', message: '✓ Periods set for milestones\n' });

                                        // Assign employees to milestones (include owner user)
                                        await milestonesOp.assignEmployeesToMilestones(milestoneMappings, organizationId, authService.getUserId());
                                        socket.emit('log', { type: 'success', message: '✓ Employees assigned to milestones\n' });

                                        // Re-save milestone mappings with updated period info
                                        const cacheDirPath = './data/cache';
                                        const cacheFilePath = `${cacheDirPath}/milestone-mappings.json`;
                                        if (!fs.existsSync(cacheDirPath)) {
                                            fs.mkdirSync(cacheDirPath, { recursive: true });
                                        }
                                        fs.writeFileSync(cacheFilePath, JSON.stringify(milestoneMappings, null, 2));
                                        socket.emit('log', { type: 'success', message: '✓ Milestone mappings updated with periods\n' });
                                    } catch (error: any) {
                                        socket.emit('log', { type: 'error', message: `Milestone R&D configuration failed: ${error.message}` });
                                        socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                    }
                                }

                                // Work Packages (only if includeWorkPackages is true)
                                if (includeWorkPackages) {
                                    const workPackagesPath = `./data/${dataGroup}/work-packages.csv`;
                                    if (milestoneMappings.length > 0 && fs.existsSync(workPackagesPath)) {
                                        socket.emit('log', { type: 'info', message: '\n=== Creating Work Packages ===' });
                                        try {
                                            const { WorkPackagesOperation } = await import('../operations/project-management/work-packages');
                                            const workPackagesOp = new WorkPackagesOperation(apiClient);
                                            const projectsData = projectsOp.getProjectsData();
                                            await workPackagesOp.createWorkPackages(workPackagesPath, milestoneMappings, projectsData);
                                            socket.emit('log', { type: 'success', message: '✓ Work packages created\n' });

                                            // Calculate yearly max PM for employees
                                            socket.emit('log', { type: 'info', message: '\n=== Calculating Yearly Max PM ===' });
                                            try {
                                                const { EmployeeYearlyPmOperation } = await import('../operations/hr/employees/employee-yearly-pm');
                                                const yearlyPmOp = new EmployeeYearlyPmOperation(hrApiClient);
                                                await yearlyPmOp.calculateYearlyMaxPm();
                                                socket.emit('log', { type: 'success', message: '✓ Yearly max PM calculated\n' });

                                                // Assign employees to project-management
                                                socket.emit('log', { type: 'info', message: '\n=== Assigning Employees to Projects ===' });
                                                try {
                                                    const projectMappingsForAssignment = projectsOp.getMappings();
                                                    if (projectMappingsForAssignment && projectMappingsForAssignment.length > 0) {
                                                        await yearlyPmOp.assignEmployeesToProjects(projectMappingsForAssignment, apiClient, organizationId);
                                                        socket.emit('log', { type: 'success', message: 'Employees assigned to project-management\n' });

                                                        // Assign PM to work packages
                                                        socket.emit('log', { type: 'info', message: '\n=== Assigning PM to Work Packages ===' });
                                                        try {
                                                            const { WorkPackagePmAssignmentOperation } = await import('../operations/project-management/work-package-pm-assignment');
                                                            const wpPmAssignmentOp = new WorkPackagePmAssignmentOperation(apiClient);
                                                            await wpPmAssignmentOp.assignPmToWorkPackages(projectMappingsForAssignment, organizationId);
                                                            socket.emit('log', { type: 'success', message: 'Work package PM assignments completed\n' });

                                                            // Assign employees to work packages
                                                            socket.emit('log', { type: 'info', message: '\n=== Assigning Employees to Work Packages ===' });
                                                            try {
                                                                const { EmployeeWorkPackageAssignmentOperation } = await import('../operations/hr/employees/employee-work-package-assignment');
                                                                const empWpAssignmentOp = new EmployeeWorkPackageAssignmentOperation(apiClient);
                                                                await empWpAssignmentOp.assignEmployeesToWorkPackages(projectMappingsForAssignment, organizationId);
                                                                socket.emit('log', { type: 'success', message: 'Employee-work package assignments completed\n' });

                                                                // Task Management (always setup structure)
                                                                socket.emit('log', { type: 'info', message: '\n=== Setting up Task Management ===' });
                                                                try {
                                                                    const { TaskManagementOperation } = await import('../operations/task-management/task-management');
                                                                    const taskMgmtOp = new TaskManagementOperation(authService);

                                                                    // Approve user consent for task management
                                                                    await taskMgmtOp.approveUserConsent();

                                                                    // Create task types
                                                                    await taskMgmtOp.createTaskTypes();

                                                                    // Fetch priorities
                                                                    await taskMgmtOp.fetchPriorities();

                                                                    // Fetch allowed activity types
                                                                    await taskMgmtOp.fetchAllowedActivityTypes();

                                                                    // Create activity type restrictions for all roles
                                                                    const occupationMappingsPath = './data/cache/occupation-mappings.json';
                                                                    if (fs.existsSync(occupationMappingsPath)) {
                                                                        const occupationMappings = JSON.parse(fs.readFileSync(occupationMappingsPath, 'utf-8'));
                                                                        if (occupationMappings && occupationMappings.length > 0) {
                                                                            const roleMappings = occupationMappings.map((occ: any) => ({
                                                                                id: occ.id.toString(),
                                                                                title: occ.name
                                                                            }));
                                                                            await taskMgmtOp.createActivityTypeRestrictions(roleMappings);
                                                                        }
                                                                    }

                                                                    // Fetch and cache structure (boards, statuses)
                                                                    await taskMgmtOp.fetchAndCacheTaskManagementStructure(projectMappingsForAssignment);

                                                                    // Create timer categories (activity types for time tracking) after boards are ready
                                                                    if (fs.existsSync(occupationMappingsPath)) {
                                                                        const occupationMappings = JSON.parse(fs.readFileSync(occupationMappingsPath, 'utf-8'));
                                                                        if (occupationMappings && occupationMappings.length > 0) {
                                                                            const roleMappings = occupationMappings.map((occ: any) => ({
                                                                                id: occ.id.toString(),
                                                                                title: occ.name
                                                                            }));
                                                                            await taskMgmtOp.createTimerCategories(roleMappings);
                                                                        }
                                                                    } else {
                                                                        await taskMgmtOp.createTimerCategories();
                                                                    }

                                                                    // Create tasks
                                                                    const tasksPath = `./data/${dataGroup}/tasks.csv`;
                                                                    if (fs.existsSync(tasksPath)) {
                                                                        await taskMgmtOp.createTasksForWorkPackages(tasksPath);
                                                                        socket.emit('log', { type: 'success', message: 'Task management setup completed\n' });
                                                                        try {
                                                                            await taskMgmtOp.addOwnerTrackedTime({
                                                                                userId: authService.getUserId(),          // owner user
                                                                                totalHours: 40,                           // örnek: 1 hafta = 5 iş günü → günlük 8h
                                                                                daysBack: 7,                              // “bugünden geriye” pencere
                                                                                timezone: 'Europe/Istanbul',
                                                                                partnerId: organizationId.toString(),     // Partner header
                                                                                defaultTimerCategoryIndex: 0              // Development
                                                                            });
                                                                            socket.emit('log', { type: 'success', message: '✓ Owner tracked time created (WP flow)\n' });
                                                                        } catch (e: any) {
                                                                            socket.emit('log', { type: 'warning', message: `Owner tracked time failed (WP flow): ${e.message}\n` });
                                                                        }
                                                                    } else {
                                                                        socket.emit('log', { type: 'warning', message: `Tasks CSV not found at ${tasksPath}, skipping task creation\n` });
                                                                    }
                                                                } catch (error: any) {
                                                                    socket.emit('log', { type: 'error', message: `Task management setup failed: ${error.message}` });
                                                                    socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                                                }
                                                            } catch (error: any) {
                                                                socket.emit('log', { type: 'error', message: `Employee-work package assignment failed: ${error.message}` });
                                                                socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                                            }
                                                        } catch (error: any) {
                                                            socket.emit('log', { type: 'error', message: `Work package PM assignment failed: ${error.message}` });
                                                            socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                                        }
                                                    } else {
                                                        socket.emit('log', { type: 'warning', message: 'No project-management found for assignment\n' });
                                                    }
                                                } catch (error: any) {
                                                    socket.emit('log', { type: 'error', message: `Project assignment failed: ${error.message}` });
                                                    socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                                }
                                            } catch (error: any) {
                                                socket.emit('log', { type: 'error', message: `Yearly PM calculation failed: ${error.message}` });
                                                socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                            }
                                        } catch (error: any) {
                                            socket.emit('log', { type: 'error', message: `Work packages creation failed: ${error.message}` });
                                            socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                        }
                                    }
                                } else {
                                    socket.emit('log', { type: 'info', message: '\nℹ Work packages skipped (includeWorkPackages = false)\n' });

                                    // If no work packages, assign PM directly to milestones
                                    socket.emit('log', { type: 'info', message: '\n=== Assigning PM to Milestones ===' });
                                    try {
                                        const { EmployeeYearlyPmOperation } = await import('../operations/hr/employees/employee-yearly-pm');
                                        const yearlyPmOp = new EmployeeYearlyPmOperation(hrApiClient);
                                        await yearlyPmOp.calculateYearlyMaxPm();
                                        socket.emit('log', { type: 'success', message: '✓ Yearly max PM calculated\n' });

                                        // Assign employees to projects
                                        const projectMappingsForAssignment = projectsOp.getMappings();
                                        if (projectMappingsForAssignment && projectMappingsForAssignment.length > 0) {
                                            await yearlyPmOp.assignEmployeesToProjects(projectMappingsForAssignment, apiClient, organizationId);
                                            socket.emit('log', { type: 'success', message: 'Employees assigned to projects\n' });

                                            // Assign PM to milestones
                                            socket.emit('log', { type: 'info', message: '\n=== Assigning PM to Milestones ===' });
                                            try {
                                                const { MilestonePmAssignmentOperation } = await import('../operations/project-management/milestone-pm-assignment');
                                                const msPmAssignmentOp = new MilestonePmAssignmentOperation(apiClient);
                                                await msPmAssignmentOp.assignPmToMilestones(projectMappingsForAssignment, organizationId);
                                                socket.emit('log', { type: 'success', message: 'Milestone PM assignments completed\n' });

                                                // Task Management (always setup structure)
                                                socket.emit('log', { type: 'info', message: '\n=== Setting up Task Management ===' });
                                                try {
                                                    const { TaskManagementOperation } = await import('../operations/task-management/task-management');
                                                    const taskMgmtOp = new TaskManagementOperation(authService);

                                                    // Approve user consent for task management
                                                    await taskMgmtOp.approveUserConsent();

                                                    // Create task types
                                                    await taskMgmtOp.createTaskTypes();

                                                    // Fetch priorities
                                                    await taskMgmtOp.fetchPriorities();

                                                    // Fetch allowed activity types
                                                    await taskMgmtOp.fetchAllowedActivityTypes();

                                                    // Create activity type restrictions for all roles
                                                    const occupationMappingsPath = './data/cache/occupation-mappings.json';
                                                    if (fs.existsSync(occupationMappingsPath)) {
                                                        const occupationMappings = JSON.parse(fs.readFileSync(occupationMappingsPath, 'utf-8'));
                                                        if (occupationMappings && occupationMappings.length > 0) {
                                                            const roleMappings = occupationMappings.map((occ: any) => ({
                                                                id: occ.id.toString(),
                                                                title: occ.name
                                                            }));
                                                            await taskMgmtOp.createActivityTypeRestrictions(roleMappings);
                                                        }
                                                    }

                                                    // Setup Task Management for milestones (boards, statuses)
                                                    await taskMgmtOp.setupTaskManagementForMilestones(projectMappingsForAssignment);

                                                    // Create timer categories (activity types for time tracking) after boards are ready
                                                    if (fs.existsSync(occupationMappingsPath)) {
                                                        const occupationMappings = JSON.parse(fs.readFileSync(occupationMappingsPath, 'utf-8'));
                                                        if (occupationMappings && occupationMappings.length > 0) {
                                                            const roleMappings = occupationMappings.map((occ: any) => ({
                                                                id: occ.id.toString(),
                                                                title: occ.name
                                                            }));
                                                            await taskMgmtOp.createTimerCategories(roleMappings);
                                                        }
                                                    } else {
                                                        await taskMgmtOp.createTimerCategories();
                                                    }

                                                    // Create tasks for milestones
                                                    const tasksPath = `./data/${dataGroup}/tasks.csv`;
                                                    if (fs.existsSync(tasksPath)) {
                                                        await taskMgmtOp.createTasksForMilestones(tasksPath, projectMappingsForAssignment, organizationId.toString());
                                                        socket.emit('log', { type: 'success', message: 'Task management setup completed\n' });
                                                        try {
                                                            await taskMgmtOp.addOwnerTrackedTime({
                                                                userId: authService.getUserId(),
                                                                totalHours: 40,
                                                                daysBack: 7,
                                                                timezone: 'Europe/Istanbul',
                                                                partnerId: organizationId.toString(),
                                                                defaultTimerCategoryIndex: 0
                                                            });
                                                            socket.emit('log', { type: 'success', message: '✓ Owner tracked time created\n' });
                                                        } catch (e: any) {
                                                            socket.emit('log', { type: 'warning', message: `Owner tracked time failed: ${e.message}\n` });
                                                        }

                                                        // Add tracked time for milestone assignees
                                                        try {
                                                            await taskMgmtOp.addMilestoneAssigneesTrackedTime({
                                                                timezone: 'Europe/Istanbul',
                                                                partnerId: organizationId.toString(),
                                                                defaultTimerCategoryIndex: 0
                                                            });
                                                            socket.emit('log', { type: 'success', message: '✓ Milestone assignees tracked time created\n' });
                                                        } catch (e: any) {
                                                            socket.emit('log', { type: 'warning', message: `Milestone assignees tracked time failed: ${e.message}\n` });
                                                        }
                                                    } else {
                                                        socket.emit('log', { type: 'warning', message: `Tasks CSV not found at ${tasksPath}, skipping task creation\n` });
                                                    }
                                                } catch (error: any) {
                                                    socket.emit('log', { type: 'error', message: `Task management setup failed: ${error.message}` });
                                                    socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                                }
                                            } catch (error: any) {
                                                socket.emit('log', { type: 'error', message: `Milestone PM assignment failed: ${error.message}` });
                                                socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                            }
                                        }
                                    } catch (error: any) {
                                        socket.emit('log', { type: 'error', message: `Milestone PM assignment failed: ${error.message}` });
                                        socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                                    }
                                }
                            } catch (error: any) {
                                socket.emit('log', { type: 'error', message: `Milestones creation failed: ${error.message}` });
                                socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                            }
                        }
                    } catch (error: any) {
                        socket.emit('log', { type: 'error', message: `Projects creation failed: ${error.message}` });
                        socket.emit('log', { type: 'warning', message: 'Continuing with next step\n' });
                    }
                }
            }

            // Upload employee avatars as the LAST step (after all user assignments)
            socket.emit('log', { type: 'info', message: '\n=== Uploading Employee Avatars (Final Step) ===' });
            const avatarMappingsPath = `./data/${dataGroup}/avatar-mappings.csv`;
            const avatarsDir = `./data/avatars/${dataGroup}`;
            if (fs.existsSync(avatarMappingsPath) && fs.existsSync(avatarsDir) && employeeMappings) {
                try {
                    const { EmployeeAvatarsOperation } = await import('../operations/hr/employees/employee-avatars');
                    const avatarsOp = new EmployeeAvatarsOperation(hrApiClient);
                    await avatarsOp.uploadAvatars(avatarsDir, avatarMappingsPath, employeeMappings);
                    socket.emit('log', { type: 'success', message: '✓ Employee avatars uploaded successfully\n' });
                } catch (error: any) {
                    socket.emit('log', { type: 'error', message: `Avatar upload failed: ${error.message}` });
                    socket.emit('log', { type: 'warning', message: 'Continuing\n' });
                }
            } else {
                socket.emit('log', { type: 'warning', message: 'No avatar mappings or directory found, skipping\n' });
            }
        }

        socket.emit('complete');

    } catch (error: any) {
        socket.emit('log', { type: 'error', message: `Fatal Error: ${error.message}` });
        socket.emit('error', { message: error.message });
    } finally {
        // Restore console
        restoreConsole();
    }
}
