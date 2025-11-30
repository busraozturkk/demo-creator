/**
 * Step Runner - Step-by-step execution mode
 *
 * This module contains the logic for running individual steps
 * in step-by-step mode, allowing users to execute operations one at a time.
 */

import * as fs from 'fs';

export async function runSingleStep(stepId: string, session: any) {
    const { AuthService } = await import('../auth');
    const { ApiClient } = await import('../api-client');
    const { parseEnvironment, getEnvironmentConfig, getCredentials } = await import('../environment');

    // Get environment config
    const environment = session.environment || 'testing';
    const env = parseEnvironment(environment);
    const envConfig = getEnvironmentConfig(env);
    const credentials = getCredentials(env);

    // Initialize clients if needed
    if (!session.authService) {
        session.authService = new AuthService(envConfig.loginUrl);
    }

    switch (stepId) {
        case 'create-company':
            console.log('Creating company');
            if (session.companyName) {
                const { CompanyCreationOperation } = await import('../operations/setup/company-creation');
                const companyCreationOp = new CompanyCreationOperation();
                session.companyId = await companyCreationOp.createCompany(session.companyName);
                console.log(`Company created successfully with ID: ${session.companyId}`);
            } else {
                console.log('No company name provided, skipping company creation');
            }
            break;

        case 'register-account':
            console.log('Registering account');
            if (session.companyId && session.email && session.password && session.companyName) {
                const { AccountRegistrationOperation } = await import('../operations/setup/account-registration');
                const registrationOp = new AccountRegistrationOperation();

                // Use default German female name and valid German phone number
                const defaultFirstName = 'Anna';
                const defaultLastName = 'Schmidt';
                const defaultPhoneNumber = '+49 30 12345678'; // Valid German phone number (Berlin area code)

                await registrationOp.registerAccount(
                    session.email,
                    session.password,
                    defaultFirstName,
                    defaultLastName,
                    defaultPhoneNumber,
                    session.companyName,
                    session.companyId
                );
                console.log('Account registered successfully');
            } else {
                throw new Error('Missing required registration data. Please complete company creation first.');
            }
            break;

        case 'activate-account':
            console.log('Activating account via Yopmail');
            if (session.email) {
                const { EmailActivationOperation } = await import('../operations/setup/email-activation');
                const activationOp = new EmailActivationOperation();
                await activationOp.activateAccount(session.email);
                console.log('Account activated successfully');
            } else {
                throw new Error('Email not found in session');
            }
            break;

        case 'login':
            console.log(`Environment: ${environment.toUpperCase()}`);
            console.log(`API Base: ${envConfig.apiBaseUrl}`);
            console.log('Logging in with provided credentials');

            // Use provided credentials or fall back to .env credentials
            const loginEmail = session.email || credentials.email;
            const loginPassword = session.password || credentials.password;

            await session.authService.login(loginEmail, loginPassword);
            console.log('Successfully authenticated');

            // Approve user consent for device information
            console.log('Fetching organization ID for consent approval');
            const { OrganizationIdOperation: OrgIdOp } = await import('../operations/setup/organization-id');
            const tempApiClient = new ApiClient(session.authService, envConfig.apiBaseUrl);
            const orgIdOp = new OrgIdOp(tempApiClient, session.authService);
            const partnerId = await orgIdOp.fetchAndCache();
            await session.authService.approveUserConsent(partnerId.toString());

            console.log('Initializing API clients');
            session.apiClient = new ApiClient(session.authService, envConfig.apiBaseUrl);
            session.hrApiClient = new ApiClient(session.authService, envConfig.hrApiBaseUrl);
            session.taskManagementApiClient = new ApiClient(session.authService, envConfig.taskManagementApiBaseUrl);
            session.imsCustomersApiClient = new ApiClient(session.authService, envConfig.imsCustomersApiBaseUrl);
            console.log('API clients initialized successfully');

            // Fetch current user information
            console.log('Fetching current user information');
            const userInfo: any = await session.apiClient.executeRequest('GET', `/auth/users/${session.authService.getUserId()}`);
            session.currentUser = {
                id: userInfo.id || userInfo.data?.id,
                name: userInfo.name || userInfo.data?.name,
                email: userInfo.email || userInfo.data?.email
            };
            console.log(`Current user: ${session.currentUser.name} (ID: ${session.currentUser.id})`);
            break;

        case 'clean-defaults':
            console.log('Fetching organization ID');
            const { OrganizationIdOperation } = await import('../operations/setup/organization-id');
            if (!session.organizationId) {
                const organizationIdOp = new OrganizationIdOperation(session.apiClient, session.authService);
                session.organizationId = await organizationIdOp.fetchAndCache();
                console.log(`Organization ID: ${session.organizationId}`);
            }

            // Set partner ID for all API clients
            session.apiClient.setPartnerId(session.organizationId.toString());
            session.taskManagementApiClient.setPartnerId(session.organizationId.toString());
            session.imsCustomersApiClient.setPartnerId(session.organizationId.toString());

            console.log('Removing default occupation groups, occupations, and titles');
            const { CleanDefaultsFromModuleOperation } = await import('../operations/utilities/clean-defaults-from-module');
            const cleanDefaultsOp = new CleanDefaultsFromModuleOperation(session.apiClient, '3');
            await cleanDefaultsOp.deleteAllDefaults();
            console.log('Default data cleaned successfully');
            break;

        case 'location-ids':
            console.log('Fetching and caching location IDs');
            const { LocationIdsOperation } = await import('../operations/hr/hr-settings/location-ids');
            const locationIdsOp = new LocationIdsOperation(session.apiClient);
            const cachedLocations = locationIdsOp.getLocationData();
            if (!cachedLocations) {
                await locationIdsOp.fetchAndCacheLocationIds();
                console.log('Location IDs cached successfully');
            } else {
                console.log('Using cached location IDs');
            }
            break;

        case 'qualification-groups':
            console.log('Creating qualification groups from CSV data');
            const qualificationGroupsPath = `./data/${session.dataGroup}/qualification-groups.csv`;
            if (fs.existsSync(qualificationGroupsPath)) {
                const { QualificationGroupsOperation } = await import('../operations/hr/hr-settings/qualification-groups');
                const qualificationGroupsOp = new QualificationGroupsOperation(session.apiClient, '3');
                await qualificationGroupsOp.createQualificationGroups(qualificationGroupsPath);
                console.log('Qualification groups created successfully');
            } else {
                console.log('No qualification groups CSV found, skipping');
            }
            break;

        case 'occupation-groups':
            console.log('Occupation groups step removed - departments are now created in the departments step');
            break;

        case 'occupations':
            console.log('Creating occupations (roles) and linking to departments');
            const occupationsPath = `./data/${session.dataGroup}/occupations.csv`;
            if (fs.existsSync(occupationsPath)) {
                if (session.departmentMappings?.length > 0) {
                    const { OccupationsOperation } = await import('../operations/hr/hr-settings/occupations');
                    const occupationsOp = new OccupationsOperation(session.apiClient, '3');
                    await occupationsOp.createOccupations(occupationsPath, session.departmentMappings);
                    console.log('Occupations created successfully');
                } else {
                    console.log('No department mappings available. You must run the "departments" step first.');
                }
            } else {
                console.log('No occupations CSV found, skipping');
            }
            break;

        case 'titles':
            console.log('Creating job titles from CSV data');
            const titlesPath = `./data/${session.dataGroup}/titles.csv`;
            if (fs.existsSync(titlesPath)) {
                const { TitlesOperation } = await import('../operations/hr/hr-settings/titles');
                const titlesOp = new TitlesOperation(session.apiClient, '3');
                await titlesOp.createTitles(titlesPath);
                console.log('Job titles created successfully');
            } else {
                console.log('No titles CSV found, skipping');
            }
            break;

        case 'reference-data':
            console.log('Fetching and caching reference data');
            const { ReferenceDataOperation } = await import('../operations/hr/hr-settings/reference-data');
            session.referenceDataOp = new ReferenceDataOperation(session.apiClient, '3');
            await session.referenceDataOp.fetchAndCache();
            console.log('Reference data cached successfully');
            break;

        case 'settings':
            console.log('Updating settings');
            const { SettingsOperation } = await import('../operations/setup/settings');
            const settingsOp = new SettingsOperation(session.apiClient, '3');
            await settingsOp.updateSetting('default_days_off_number', '24');
            console.log('Settings updated successfully');
            break;

        case 'offices':
            console.log('Creating office locations');
            const officesPath = `./data/${session.dataGroup}/offices.csv`;
            const { OfficesOperation } = await import('../operations/hr/hr-settings/offices');
            session.officesOp = new OfficesOperation(session.hrApiClient);
            if (fs.existsSync(officesPath)) {
                await session.officesOp.createOffices(officesPath);
                console.log('Office locations created successfully');
            } else {
                console.log('No offices CSV found, skipping');
            }
            break;

        case 'legal-requirements':
            console.log('Creating legal requirements');
            const legalRequirementsPath = `./data/${session.dataGroup}/legal-requirements.csv`;
            const { LegalRequirementsOperation } = await import('../operations/time-tracking/legal-requirements');
            session.legalRequirementsOp = new LegalRequirementsOperation(session.taskManagementApiClient);
            if (fs.existsSync(legalRequirementsPath)) {
                await session.legalRequirementsOp.createLegalRequirements(legalRequirementsPath);
                console.log('Legal requirements created successfully');
            } else {
                console.log('No legal requirements CSV found, skipping');
            }
            break;

        case 'hr-reference-data':
            console.log('Fetching HR reference data');
            const { HrReferenceDataOperation } = await import('../operations/hr/hr-settings/hr-reference-data');
            session.hrReferenceDataOp = new HrReferenceDataOperation(session.hrApiClient, session.referenceDataOp);
            await session.hrReferenceDataOp.fetchAndCache();
            console.log('HR reference data cached successfully');

            console.log('Fetching day-off types');
            const { DayOffTypesOperation } = await import('../operations/hr/hr-settings/day-off-types');
            session.dayOffTypesOp = new DayOffTypesOperation(session.hrApiClient);
            await session.dayOffTypesOp.fetchAndCache();
            console.log('Day-off types cached successfully');
            break;

        case 'owner-employee':
            console.log('Creating owner employee');
            const { OwnerEmployeeOperation } = await import('../operations/hr/employees/owner-employee');
            const ownerEmployeeOp = new OwnerEmployeeOperation(session.apiClient, session.hrApiClient, session.authService);
            session.ownerEmployeeId = await ownerEmployeeOp.createOwnerEmployee();
            console.log('Owner employee created successfully');

            // Update owner employee details
            console.log('Updating owner employee details');
            await ownerEmployeeOp.updateOwnerEmployeeDetails(session.hrReferenceDataOp);
            console.log('Owner employee details updated successfully');
            break;

        case 'employees':
            console.log('Creating employee records and user accounts');
            const employeesPath = `./data/${session.dataGroup}/employees.csv`;
            if (fs.existsSync(employeesPath)) {
                const { EmployeesOperation } = await import('../operations/hr/employees/employees');
                session.employeesOp = new EmployeesOperation(session.hrApiClient, session.hrReferenceDataOp, session.officesOp, session.apiClient);
                await session.employeesOp.createEmployees(employeesPath, session.emailDomain, { ownerEmail: loginEmail });
                console.log('Employees created successfully');
            } else {
                console.log('No employees CSV found, skipping');
            }
            break;

        case 'employee-details':
            console.log('Updating employee details');
            const employeeDetailsPath = `./data/${session.dataGroup}/employee-details.csv`;
            if (fs.existsSync(employeeDetailsPath)) {
                await session.employeesOp.updateEmployeeDetails(employeeDetailsPath, session.emailDomain);
                console.log('Employee details updated successfully');
            } else {
                console.log('No employee details CSV found, skipping');
            }
            break;

        case 'employee-contracts':
            console.log('Updating employee contract information');
            const employeeContractsPath = `./data/${session.dataGroup}/employee-contracts.csv`;
            if (fs.existsSync(employeeContractsPath)) {
                const employeeMappings = session.employeesOp.getMappings();
                if (employeeMappings) {
                    const { EmployeeContractsOperation } = await import('../operations/hr/employees/employee-contracts');
                    const employeeContractsOp = new EmployeeContractsOperation(session.hrApiClient, session.hrReferenceDataOp, session.legalRequirementsOp);
                    await employeeContractsOp.updateEmployeeContracts(employeeContractsPath, employeeMappings, `./data/${session.dataGroup}/employee-details.csv`);
                    console.log('Employee contracts updated successfully');
                } else {
                    console.log('No employee mappings available, skipping');
                }
            } else {
                console.log('No employee contracts CSV found, skipping');
            }
            break;

        case 'avatars':
            console.log('Uploading employee profile pictures');

            // Determine language from dataset (all datasets end with -en or -de)
            const isGerman = session.dataGroup.endsWith('-de');
            const languageSuffix = isGerman ? 'de' : 'en';

            // Use shared avatar mappings based on language
            const avatarMappingsPath = `./data/sff-data-${languageSuffix}/avatar-mappings.csv`;
            const avatarsDir = `./data/avatars/sff-data-${languageSuffix}`;

            if (fs.existsSync(avatarMappingsPath) && fs.existsSync(avatarsDir)) {
                const { EmployeeAvatarsOperation } = await import('../operations/hr/employees/employee-avatars');
                const avatarsOp = new EmployeeAvatarsOperation(session.hrApiClient);
                const employeeMappings = session.employeesOp.getMappings();
                if (employeeMappings) {
                    await avatarsOp.uploadAvatars(avatarsDir, avatarMappingsPath, employeeMappings);
                    console.log('Employee avatars uploaded successfully');
                } else {
                    console.log('No employee mappings available, skipping');
                }
            } else {
                console.log('No avatar mappings or directory found, skipping');
            }
            break;
        case 'salary':
            console.log('Processing salary and contributions');
            const employeeMappings = session.employeesOp?.getMappings();
            if (employeeMappings && employeeMappings.length > 0) {
                const { EmployeeSalaryPrefillOperation } = await import('../operations/hr/employees/employee-salary-prefill');
                const salaryPrefillOp = new EmployeeSalaryPrefillOperation(session.hrApiClient);
                const salariesPath = `./data/${session.dataGroup}/employee-salaries.csv`;
                await salaryPrefillOp.loadSalaryData(salariesPath);
                console.log('Prefilling salary records');
                await salaryPrefillOp.prefillSalaryRecords(employeeMappings);
                console.log('Prefilling employer contributions');
                await salaryPrefillOp.prefillEmployerContributions(employeeMappings);

                console.log('Creating days-off records');
                const { EmployeeDaysOffOperation } = await import('../operations/hr/employees/employee-days-off');
                const daysOffOp = new EmployeeDaysOffOperation(session.hrApiClient, session.dayOffTypesOp);
                await daysOffOp.createDaysOff(employeeMappings);
                console.log('Salary and days-off processing completed successfully');
            } else {
                console.log('No employee mappings available, skipping');
            }
            break;

        case 'departments':
            console.log('Creating departments with leaders');
            const departmentsPath = `./data/${session.dataGroup}/departments.csv`;
            if (fs.existsSync(departmentsPath)) {
                const employeeMappingsForDept = session.employeesOp?.getMappings();
                if (employeeMappingsForDept) {
                    const { DepartmentsOperation } = await import('../operations/hr/hr-settings/departments');
                    const departmentsOp = new DepartmentsOperation(session.hrApiClient);
                    session.departmentMappings = await departmentsOp.createDepartments(
                        departmentsPath,
                        employeeMappingsForDept,
                        session.emailDomain
                    );
                    console.log(`Departments created: ${session.departmentMappings?.length || 0}`);
                    console.log('Note: These departments can now be used for occupation/role linking');
                } else {
                    console.log('No employee mappings available, skipping');
                }
            } else {
                console.log('No departments CSV found, skipping');
            }
            break;

        case 'teams':
            console.log('Creating teams');
            const teamsPath = `./data/${session.dataGroup}/teams.csv`;
            if (fs.existsSync(teamsPath) && session.departmentMappings?.length > 0) {
                const employeeMappingsForTeams = session.employeesOp?.getMappings();
                if (employeeMappingsForTeams) {
                    const { TeamsOperation } = await import('../operations/hr/hr-settings/teams');
                    const teamsOp = new TeamsOperation(session.hrApiClient);
                    await teamsOp.createTeams(
                        teamsPath,
                        employeeMappingsForTeams,
                        session.departmentMappings,
                        session.emailDomain
                    );
                    console.log('Teams created successfully');
                } else {
                    console.log('No employee mappings available, skipping');
                }
            } else {
                console.log('No teams CSV found or no departments created, skipping');
            }
            break;

        case 'c-level':
            console.log('Assigning C-level executives');
            const cLevelPath = `./data/${session.dataGroup}/c-level.csv`;
            if (fs.existsSync(cLevelPath) && session.departmentMappings?.length > 0) {
                const employeeMappingsForCLevel = session.employeesOp?.getMappings();
                if (employeeMappingsForCLevel) {
                    const { CLevelOperation } = await import('../operations/hr/employees/c-level');
                    const cLevelOp = new CLevelOperation(session.hrApiClient);
                    await cLevelOp.assignCLevel(
                        cLevelPath,
                        employeeMappingsForCLevel,
                        session.departmentMappings,
                        session.emailDomain
                    );
                    console.log('C-level executives assigned successfully');
                } else {
                    console.log('No employee mappings available, skipping');
                }
            } else {
                console.log('No c-level CSV found or no departments created, skipping');
            }
            break;

        case 'projects':
            console.log('Creating project-management');
            const projectsPath = `./data/${session.dataGroup}/projects.csv`;
            if (fs.existsSync(projectsPath)) {
                const { ProjectsOperation } = await import('../operations/project-management/projects');
                const projectsOp = new ProjectsOperation(session.imsCustomersApiClient, session.apiClient);
                const selectedProjects = session.selectedProjects || [];
                session.projectMappings = await projectsOp.createProjects(projectsPath, undefined, selectedProjects, session.projectType);
                session.projectsData = projectsOp.getProjectsData();
                console.log(`Projects created: ${session.projectMappings?.length || 0}`);

                // Move projects to appropriate statuses
                if (session.projectMappings?.length > 0 && session.projectType) {
                    console.log('\nMoving projects to workflow statuses...');
                    try {
                        const { ProjectStatusOperation } = await import('../operations/project-management/project-status');
                        const projectStatusOp = new ProjectStatusOperation(session.apiClient, session.authService);
                        await projectStatusOp.moveProjectsToStatuses(
                            session.projectMappings,
                            session.projectType,
                            session.organizationId
                        );
                        console.log('✓ Projects moved to appropriate statuses');
                    } catch (error: any) {
                        console.error(`Project status update failed: ${error.message}`);
                        console.log('Continuing with next step');
                    }
                }
            } else {
                console.log('No project-management CSV found, skipping');
            }
            break;

        case 'milestones':
            console.log('Creating milestones');
            const milestonesPath = `./data/${session.dataGroup}/milestones.csv`;
            if (fs.existsSync(milestonesPath) && session.projectMappings?.length > 0) {
                const { MilestonesOperation } = await import('../operations/project-management/milestones');
                const milestonesOp = new MilestonesOperation(session.apiClient);
                session.milestoneMappings = await milestonesOp.createMilestones(milestonesPath, session.projectMappings);
                console.log(`Milestones created: ${session.milestoneMappings?.length || 0}`);
            } else {
                console.log('No milestones CSV found or no project-management created, skipping');
            }
            break;

        case 'work-packages':
            if (session.includeWorkPackages === false) {
                console.log('Work packages skipped (includeWorkPackages = false)');
                break;
            }
            console.log('Creating work packages with time periods');
            const workPackagesPath = `./data/${session.dataGroup}/work-packages.csv`;
            if (fs.existsSync(workPackagesPath) && session.milestoneMappings?.length > 0 && session.projectsData) {
                const { WorkPackagesOperation } = await import('../operations/project-management/work-packages');
                const workPackagesOp = new WorkPackagesOperation(session.apiClient);
                await workPackagesOp.createWorkPackages(workPackagesPath, session.milestoneMappings, session.projectsData);
                console.log('Work packages created successfully');
            } else {
                console.log('No work packages CSV found or no milestones created, skipping');
            }
            break;

        case 'yearly-pm':
            if (session.includeWorkPackages === false) {
                console.log('Yearly PM calculation skipped (includeWorkPackages = false)');
                break;
            }
            console.log('Calculating yearly max PM for employees participating in project-management');
            const { EmployeeYearlyPmOperation } = await import('../operations/hr/employees/employee-yearly-pm');
            const yearlyPmOp = new EmployeeYearlyPmOperation(session.hrApiClient);
            await yearlyPmOp.calculateYearlyMaxPm();
            console.log('Yearly max PM calculation completed');
            break;

        case 'project-assignments':
            if (session.includeWorkPackages === false) {
                console.log('Project assignments skipped (includeWorkPackages = false)');
                break;
            }
            console.log('Assigning employees to project-management');
            if (session.projectMappings && session.projectMappings.length > 0) {
                const { EmployeeYearlyPmOperation: YearlyPmOp } = await import('../operations/hr/employees/employee-yearly-pm');
                const assignmentOp = new YearlyPmOp(session.hrApiClient);
                await assignmentOp.assignEmployeesToProjects(session.projectMappings, session.apiClient, session.organizationId);
                console.log('Employee project assignments completed');

                // Assign PM to work packages
                console.log('Assigning PM to work packages');
                const { WorkPackagePmAssignmentOperation: WpPmAssignmentOp } = await import('../operations/project-management/work-package-pm-assignment');
                const wpPmAssignmentOp = new WpPmAssignmentOp(session.apiClient);
                await wpPmAssignmentOp.assignPmToWorkPackages(session.projectMappings, session.organizationId);
                console.log('Work package PM assignments completed');

                // Assign employees to work packages
                console.log('Assigning employees to work packages');
                const { EmployeeWorkPackageAssignmentOperation: EmpWpAssignmentOp } = await import('../operations/hr/employees/employee-work-package-assignment');
                const empWpAssignmentOp = new EmpWpAssignmentOp(session.apiClient);
                await empWpAssignmentOp.assignEmployeesToWorkPackages(session.projectMappings, session.organizationId);
                console.log('Employee-work package assignments completed');
            } else {
                console.log('No project-management found for employee assignment');
            }
            break;

        case 'task-management':
            if (session.includeWorkPackages === false) {
                console.log('Task Management skipped (includeWorkPackages = false)');
                break;
            }
            console.log('Setting up Task Management');
            if (session.projectMappings && session.projectMappings.length > 0) {
                const { TaskManagementOperation } = await import('../operations/task-management/task-management');
                const taskMgmtOp = new TaskManagementOperation(session.authService);

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

                // Fetch and cache task management structure (folders, boards, statuses)
                await taskMgmtOp.fetchAndCacheTaskManagementStructure(session.projectMappings);

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

                // Create tasks for work packages
                const tasksCsvPath = `./data/${session.dataGroup}/tasks.csv`;
                await taskMgmtOp.createTasksForWorkPackages(tasksCsvPath);

                console.log('Task Management setup completed');
            } else {
                console.log('No project-management found for task management setup');
            }
            break;

        default:
            throw new Error(`Unknown step: ${stepId}`);
    }
}
