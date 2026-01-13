/**
 * @typedef {Object} Step
 * @property {string} id - Step identifier
 * @property {string} name - Display name
 * @property {string} description - Step description
 */

/**
 * @typedef {Object} SessionData
 * @property {string} [companyName] - Company name
 * @property {string} [email] - User email
 * @property {string} [firstName] - User first name
 * @property {string} [lastName] - User last name
 * @property {string} [phoneNumber] - User phone number
 * @property {string} [password] - User password
 * @property {string} [dataGroup] - Data group name
 * @property {string} [emailDomain] - Email domain
 * @property {string} [environment] - Environment (testing/production)
 * @property {number} [organizationId] - Organization ID
 * @property {number} [companyId] - Company ID
 */

/**
 * @typedef {Object} LogData
 * @property {string} type - Log type (info/error/success/warning)
 * @property {string} message - Log message
 */

const socket = io();
let isCreating = false;
let totalLogs = 0;
let estimatedTotalSteps = 1500;
let currentMode = 'bulk';
/** @type {SessionData|null} */
let sessionData = null;
let timerInterval = null;
let startTime = null;
let currentJobId = null; // Track current running job
// Demo lifecycle state: 'idle' | 'running' | 'completed' | 'stopped' | 'failed'
let demoState = 'idle';
// Child companies array
let childCompanies = [];
let childCompanyCounter = 0;

/** Helper: force-collapse any open custom dropdowns */
function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => menu.classList.remove('show'));
    document.querySelectorAll('.select-selected.select-arrow-active').forEach(sel => sel.classList.remove('select-arrow-active'));
    // Optional aria for accessibility
    document.querySelectorAll('.select-selected').forEach(sel => sel.setAttribute('aria-expanded', 'false'));
}

/** @type {Step[]} */
const STEPS = [
    { id: 'create-company', name: 'Create Company', description: 'Create company in the system' },
    { id: 'register-account', name: 'Register Account', description: 'Register new account with company information' },
    { id: 'activate-account', name: 'Activate Account', description: 'Activate account via Yopmail confirmation email' },
    { id: 'login', name: 'Login', description: 'Authenticate with your account credentials and initialize API clients' },
    { id: 'clean-defaults', name: 'Clean Defaults', description: 'Remove all default occupation groups, occupations, and titles from fresh account' },
    { id: 'location-ids', name: 'Location IDs', description: 'Fetch and cache location IDs for countries and cities' },
    { id: 'qualification-groups', name: 'Qualification Groups', description: 'Create qualification groups from CSV data' },
    { id: 'occupation-groups', name: 'Occupation Groups', description: 'Create occupation groups and store mappings for later use' },
    { id: 'occupations', name: 'Occupations', description: 'Create occupations/roles and link them to occupation groups' },
    { id: 'titles', name: 'Titles', description: 'Create job titles from CSV data' },
    { id: 'reference-data', name: 'Reference Data', description: 'Fetch and cache all reference data (titles, occupations, etc.)' },
    { id: 'settings', name: 'Settings', description: 'Update system settings like default days-off number' },
    { id: 'offices', name: 'Offices', description: 'Create office locations and store mappings' },
    { id: 'legal-requirements', name: 'Legal Requirements', description: 'Create legal requirements for task management' },
    { id: 'hr-reference-data', name: 'HR Reference Data', description: 'Fetch HR-specific reference data including day-off types' },
    { id: 'owner-employee', name: 'Owner Employee', description: 'Create employee record for account owner and assign to existing user' },
    { id: 'employees', name: 'Employees', description: 'Create employee records, user accounts, and link them together' },
    { id: 'employee-details', name: 'Employee Details', description: 'Update employee details including gender, birthdate, office, etc.' },
    { id: 'employee-contracts', name: 'Employee Contracts', description: 'Update employee contract information' },
    { id: 'avatars', name: 'Avatars', description: 'Upload employee profile pictures from avatar directory' },
    { id: 'salary', name: 'Salary & Contributions', description: 'Prefill salary records, employer contributions, and create days-off' },
    { id: 'departments', name: 'Departments', description: 'Create departments and assign department heads from employees' },
    { id: 'teams', name: 'Teams', description: 'Create teams under departments and assign team leaders' },
    { id: 'c-level', name: 'C-Level', description: 'Assign C-level executives to departments' },
    { id: 'projects', name: 'Projects', description: 'Create projects for customer management' },
    { id: 'milestones', name: 'Milestones', description: 'Create milestones for projects with timelines' },
    { id: 'work-packages', name: 'Work Packages', description: 'Create work packages with time periods for milestones' },
    { id: 'yearly-pm', name: 'Yearly Max PM', description: 'Calculate and set yearly maximum person-months for employees based on contract data' },
    { id: 'project-assignments', name: 'Project Assignments', description: 'Randomly assign employees to projects for resource allocation' },
    { id: 'task-management', name: 'Task Management', description: 'Create tasks for work packages with assignees, statuses, and details' }
];

/**
 * Initialize custom dropdowns
 */
function initCustomDropdown() {
    initDropdown('projectTypeSelect', 'projectTypeItems', 'projectType');
    initDropdown('dataGroupSelect', 'dataGroupItems', 'dataGroup');
    initDropdown('environmentSelect', 'environmentItems', 'environment');
}

/**
 * Initialize a single dropdown
 * @param {string} selectId - Selected display element ID
 * @param {string} itemsId - Items container element ID
 * @param {string} inputId - Hidden input element ID
 */
function initDropdown(selectId, itemsId, inputId) {
    const selectSelected = document.getElementById(selectId);
    const selectItems = document.getElementById(itemsId);
    const hiddenInput = document.getElementById(inputId);

    if (!selectSelected || !selectItems || !hiddenInput) return;

    // Toggle dropdown
    selectSelected.addEventListener('click', function(e) {
        if (isCreating) return; // locked: do nothing
        e.stopPropagation();

        // Close other dropdowns
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu !== selectItems) menu.classList.remove('show');
        });
        document.querySelectorAll('.select-selected').forEach(select => {
            if (select !== selectSelected) select.classList.remove('select-arrow-active');
        });

        // Toggle this dropdown
        selectItems.classList.toggle('show');
        this.classList.toggle('select-arrow-active');
        this.setAttribute('aria-expanded', selectItems.classList.contains('show') ? 'true' : 'false');
    });

    // Select item
    const items = selectItems.getElementsByTagName('div');
    for (let i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function(e) {
            if (isCreating) return; // locked: do nothing

            // Skip if this is a group label
            if (this.classList.contains('select-group-label')) {
                return;
            }

            e.stopPropagation();

            // Remove previous selection
            const siblings = this.parentNode.getElementsByTagName('div');
            for (let j = 0; j < siblings.length; j++) {
                siblings[j].classList.remove('selected');
            }

            // Set new selection
            this.classList.add('selected');
            selectSelected.textContent = this.textContent;
            selectSelected.style.color = '';
            hiddenInput.value = this.getAttribute('data-value');

            // Close dropdown
            selectItems.classList.remove('show');
            selectSelected.classList.remove('select-arrow-active');
            selectSelected.setAttribute('aria-expanded', 'false');

            // Load projects when data group is selected
            if (inputId === 'dataGroup') {
                const projectType = document.getElementById('projectType').value;
                loadProjects(this.getAttribute('data-value'), projectType);
            }

            // Load projects when project type is selected
            if (inputId === 'projectType') {
                const dataGroup = document.getElementById('dataGroup').value;
                loadProjects(dataGroup, this.getAttribute('data-value'));
            }
        });
    }
}

/**
 * Load projects from CSV based on selected data group and project type
 * @param {string} dataGroup
 * @param {string} projectType - Optional project type ID to filter
 */
async function loadProjects(dataGroup, projectType = null) {
    const projectSelectionBox = document.getElementById('projectSelectionBox');
    const projectList = document.getElementById('projectList');

    if (!dataGroup) {
        projectSelectionBox.style.display = 'none';
        return;
    }

    // If no project type selected, show message
    if (!projectType) {
        projectSelectionBox.style.display = 'block';
        projectList.innerHTML = '<div class="loading-projects">Please select a project type first</div>';
        return;
    }

    projectSelectionBox.style.display = 'block';
    projectList.innerHTML = '<div class="loading-projects">Loading projects...</div>';

    try {
        const url = `/api/projects/${dataGroup}?projectType=${projectType}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || !data.projects) {
            throw new Error('Failed to load projects');
        }

        if (data.projects.length === 0) {
            projectList.innerHTML = '<div class="loading-projects">No projects found for selected project type</div>';
            return;
        }

        renderProjects(data.projects);
    } catch (error) {
        projectList.innerHTML = '<div class="loading-projects">Error loading projects</div>';
        console.error('Error loading projects:', error);
    }
}

/**
 * Render project checkboxes
 * @param {Array} projects
 */
function renderProjects(projects) {
    const projectList = document.getElementById('projectList');

    if (!projects || projects.length === 0) {
        projectList.innerHTML = '<div class="loading-projects">No project-management found</div>';
        return;
    }

    projectList.innerHTML = projects.map((project, index) => `
        <div class="project-item">
            <label>
                <input type="checkbox" class="project-checkbox" data-short-title="${project.short_title}" data-index="${index}">
                <div class="project-item-content">
                    <div class="project-item-title">${project.title}</div>
                    <div class="project-item-details">${project.short_title} | ${project.started_at} - ${project.finished_at}</div>
                </div>
            </label>
        </div>
    `).join('');

    const selectAllCheckbox = document.getElementById('selectAllProjects');
    selectAllCheckbox.checked = false;

    selectAllCheckbox.addEventListener('change', function() {
        if (isCreating) { this.checked = this.checked && false; return; }
        const checkboxes = document.querySelectorAll('.project-checkbox');
        checkboxes.forEach(cb => cb.checked = this.checked);
        updateSelectedProjects();
    });

    const selectAllContainer = document.querySelector('.project-select-all');
    if (selectAllContainer) {
        selectAllContainer.addEventListener('mousedown', createRipple);
    }

    document.querySelectorAll('.project-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (isCreating) { this.checked = !this.checked; return; }
            updateSelectedProjects();
        });
    });

    document.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('mousedown', createRipple);
    });
}

/** Update hidden input with selected project short titles */
function updateSelectedProjects() {
    const selectedCheckboxes = document.querySelectorAll('.project-checkbox:checked');
    const selectedTitles = Array.from(selectedCheckboxes).map(cb => cb.getAttribute('data-short-title'));
    document.getElementById('selectedProjects').value = JSON.stringify(selectedTitles);

    const allCheckboxes = document.querySelectorAll('.project-checkbox');
    const selectAllCheckbox = document.getElementById('selectAllProjects');
    selectAllCheckbox.checked = allCheckboxes.length > 0 && selectedCheckboxes.length === allCheckboxes.length;
}

// Close dropdown when clicking outside
document.addEventListener('click', function() {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
    });
    document.querySelectorAll('.select-selected').forEach(select => {
        select.classList.remove('select-arrow-active');
        select.setAttribute('aria-expanded', 'false');
    });
});

// Mode selection
document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', function() {
        currentMode = this.value;
    });
});

function renderSteps() {
    const stepsList = document.getElementById('stepsList');
    stepsList.innerHTML = '';

    STEPS.forEach(step => {
        const stepItem = document.createElement('div');
        stepItem.className = 'step-item pending';
        stepItem.id = `step-${step.id}`;

        stepItem.innerHTML = `
            <div class="step-status">[·]</div>
            <div class="step-info">
                <div class="step-name">${step.name}</div>
                <div class="step-description">${step.description}</div>
            </div>
            <div class="step-action">
                <button class="step-button" onclick="runStep('${step.id}')">RUN</button>
            </div>
        `;

        stepsList.appendChild(stepItem);
    });
}

async function runStep(stepId) {
    const stepElement = document.getElementById(`step-${stepId}`);
    const statusIcon = stepElement.querySelector('.step-status');
    const button = stepElement.querySelector('.step-button');
    const stepLogContent = document.getElementById('stepLogContent');

    // Disable all buttons
    document.querySelectorAll('.step-button').forEach(btn => btn.disabled = true);

    // Mark as running
    stepElement.className = 'step-item running';
    statusIcon.textContent = '[~]';
    button.disabled = true;

    // Add separator in log
    const separator = document.createElement('div');
    separator.className = 'step-log-entry';
    separator.style.color = '#ff69b4';
    separator.textContent = `\n>>> Running: ${STEPS.find(s => s.id === stepId).name} <<<\n`;
    stepLogContent.appendChild(separator);

    // Remove any previous error message
    const existingError = stepElement.querySelector('.step-error-message');
    if (existingError) {
        existingError.remove();
    }

    // Setup socket listener for this step
    const logHandler = (data) => {
        const logEntry = document.createElement('div');
        logEntry.className = `step-log-entry log-${data.type}`;
        logEntry.textContent = data.message;
        stepLogContent.appendChild(logEntry);
        stepLogContent.scrollTop = stepLogContent.scrollHeight;
    };

    socket.on('step-log', logHandler);

    try {
        const response = await fetch('/api/run-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stepId,
                sessionData: sessionData || {
                    companyName: document.getElementById('companyName').value.trim(),
                    email: document.getElementById('email').value.trim(),
                    password: document.getElementById('password').value.trim(),
                    projectType: document.getElementById('projectType').value,
                    dataGroup: document.getElementById('dataGroup').value,
                    emailDomain: document.getElementById('emailDomain').value.trim(),
                    environment: document.getElementById('environment').value || 'testing',
                    selectedProjects: JSON.parse(document.getElementById('selectedProjects').value || '[]'),
                    includeWorkPackages: document.querySelector('input[name="workPackages"]:checked').value === 'yes'
                },
                socketId: socket.id
            })
        });

        const data = await response.json();

        if (data.success) {
            stepElement.className = 'step-item success';
            statusIcon.textContent = '[✓]';
            sessionData = data.sessionData;
        } else {
            throw new Error(data.error || 'Step failed');
        }
    } catch (error) {
        stepElement.className = 'step-item error';
        statusIcon.textContent = '[!]';

        const errorDiv = document.createElement('div');
        errorDiv.className = 'step-error-message';
        errorDiv.textContent = error.message;
        stepElement.querySelector('.step-info').appendChild(errorDiv);
    } finally {
        socket.off('step-log', logHandler);

        // Re-enable all buttons that are not successful
        document.querySelectorAll('.step-button').forEach((btn) => {
            const stepItem = btn.closest('.step-item');
            if (!stepItem.classList.contains('success')) {
                btn.disabled = false;
            }
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initCustomDropdown();
});

// Animated heart
function createAnimatedHeart(x, y) {
    const heart = document.createElement('div');
    heart.className = 'animated-heart';
    heart.textContent = '♥';
    heart.style.left = x + 'px';
    heart.style.top = y + 'px';
    document.getElementById('mainContainer').appendChild(heart);
    setTimeout(() => heart.remove(), 2000);
}

// Button hover effect
document.getElementById('createBtn').addEventListener('mouseenter', (e) => {
    const rect = e.target.getBoundingClientRect();
    const heartsCount = 5;
    for (let i = 0; i < heartsCount; i++) {
        setTimeout(() => {
            const x = rect.left + Math.random() * rect.width;
            const y = rect.top + Math.random() * rect.height;
            createAnimatedHeart(x, y);
        }, i * 100);
    }
});

// Animated spell text
function createAnimatedSpell(x, y) {
    const spells = ["Lumos","Nox","Alohomora","Expelliarmus","Expecto Patronum","Wingardium Leviosa","Stupefy","Accio"];
    const animations = ['spellFloat', 'spellFloat2', 'spellFloat3'];
    const spell = document.createElement('div');
    spell.className = 'animated-spell';
    spell.textContent = spells[Math.floor(Math.random() * spells.length)];
    spell.style.left = x + 'px';
    spell.style.top = y + 'px';
    spell.style.animationName = animations[Math.floor(Math.random() * animations.length)];
    document.getElementById('mainContainer').appendChild(spell);
    setTimeout(() => spell.remove(), 2000);
}

// Magic wand icon hover effect
document.addEventListener('DOMContentLoaded', () => {
    const magicIcon = document.querySelector('.animation-character');
    if (magicIcon) {
        magicIcon.addEventListener('mouseenter', (e) => {
            const rect = e.target.getBoundingClientRect();
            const spellsCount = 3;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            for (let i = 0; i < spellsCount; i++) {
                setTimeout(() => createAnimatedSpell(centerX, centerY), i * 150);
            }
        });
    }
});

// Validation
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
function clearAllErrors() {
    const container = document.getElementById('validationErrors');
    container.innerHTML = '';
}
function showValidationError(message) {
    const container = document.getElementById('validationErrors');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'validation-error';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
}

// Password toggle functionality
document.getElementById('passwordToggle').addEventListener('click', function() {
    const passwordInput = document.getElementById('password');
    const icon = this.querySelector('i');
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});
document.getElementById('passwordConfirmToggle').addEventListener('click', function() {
    const passwordConfirmInput = document.getElementById('passwordConfirm');
    const icon = this.querySelector('i');
    if (passwordConfirmInput.type === 'password') {
        passwordConfirmInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passwordConfirmInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});

// ============================================
// CHILD COMPANIES MANAGEMENT
// ============================================

/**
 * Add a new child company form
 */
function addChildCompany() {
    if (isCreating) return;

    const childId = ++childCompanyCounter;
    const childData = {
        id: childId,
        companyName: '',
        email: '',
        useMainPassword: true,
        password: '',
        dataGroup: '',
        emailDomain: '',
        projectType: '',
        selectedProjects: [],
        includeWorkPackages: true
    };

    childCompanies.push(childData);
    renderChildCompany(childData);
}

/**
 * Remove a child company
 */
function removeChildCompany(childId) {
    if (isCreating) return;

    childCompanies = childCompanies.filter(c => c.id !== childId);
    document.getElementById(`childCompany-${childId}`)?.remove();
}

/**
 * Render a child company form
 */
function renderChildCompany(childData) {
    const container = document.getElementById('childCompaniesList');
    const childDiv = document.createElement('div');
    childDiv.className = 'child-company-card';
    childDiv.id = `childCompany-${childData.id}`;

    childDiv.innerHTML = `
        <div class="child-company-header">
            <h3>Child Company #${childData.id}</h3>
            <button type="button" class="btn-remove-child" onclick="removeChildCompany(${childData.id})">
                <i class="fa-solid fa-trash"></i> Remove
            </button>
        </div>

        <div class="child-company-fields">
            <div class="form-box">
                <label class="form-label">Company Name</label>
                <input type="text"
                    class="form-input child-company-name"
                    data-child-id="${childData.id}"
                    placeholder="Child Company Name">
            </div>

            <div class="form-box">
                <label class="form-label">Email (Yopmail required)</label>
                <input type="email"
                    class="form-input child-email"
                    data-child-id="${childData.id}"
                    placeholder="child@yopmail.com">
            </div>

            <div class="form-box">
                <label class="form-label">Password</label>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <input type="checkbox"
                        class="child-use-main-password"
                        data-child-id="${childData.id}"
                        checked>
                    <span>Use main password</span>
                </div>
                <input type="password"
                    class="form-input child-password"
                    data-child-id="${childData.id}"
                    placeholder="••••••••"
                    disabled>
            </div>

            <div class="form-box">
                <label class="form-label">Email Domain</label>
                <input type="text"
                    class="form-input child-email-domain"
                    data-child-id="${childData.id}"
                    placeholder="child-company.com">
            </div>

            <div class="form-box">
                <label class="form-label">Project Type</label>
                <select class="form-input child-project-type" data-child-id="${childData.id}">
                    <option value="">Select project type</option>
                    <option value="29">SFF (German)</option>
                    <option value="46">WBSO (Dutch)</option>
                    <option value="119">Forschungsprämie (Austrian)</option>
                    <option value="120">HMRC R&D Tax Relief (UK)</option>
                    <option value="171">IRC41 (US)</option>
                </select>
            </div>

            <div class="form-box">
                <label class="form-label">Data</label>
                <select class="form-input child-data-group" data-child-id="${childData.id}">
                    <option value="">Select data</option>
                    <optgroup label="English">
                        <option value="manufacturing-en">Manufacturing & Product Development</option>
                        <option value="healthcare-en">Healthcare & Pharmaceuticals</option>
                        <option value="financial-en">Financial Services</option>
                        <option value="consulting-en">Services & Consulting</option>
                        <option value="energy-en">Energy & Utilities</option>
                        <option value="government-en">Government & Public Sector</option>
                        <option value="construction-en">Construction & Infrastructure</option>
                        <option value="media-en">Media & Telecommunications</option>
                    </optgroup>
                    <optgroup label="Deutsch">
                        <option value="manufacturing-de">Fertigung & Produktentwicklung</option>
                        <option value="healthcare-de">Gesundheitswesen & Pharmazeutika</option>
                        <option value="financial-de">Finanzdienstleistungen</option>
                        <option value="consulting-de">Dienstleistungen & Beratung</option>
                        <option value="energy-de">Energie & Versorgung</option>
                        <option value="government-de">Verwaltung & Öffentlicher Sektor</option>
                        <option value="construction-de">Bau & Infrastruktur</option>
                        <option value="media-de">Medien & Telekommunikation</option>
                    </optgroup>
                </select>
            </div>

            <div class="form-box child-project-box-${childData.id}" style="display: none;">
                <label class="form-label">Select Projects</label>
                <div class="project-selection-container">
                    <div class="project-select-all">
                        <label>
                            <input type="checkbox" class="child-select-all-projects" data-child-id="${childData.id}">
                            <span>Select All</span>
                        </label>
                    </div>
                    <div class="project-list child-project-list-${childData.id}">
                        <div class="loading-projects">Select a data group first</div>
                    </div>
                </div>
            </div>

            <div class="form-box">
                <label class="form-label">Include Work Packages?</label>
                <div class="mode-toggle">
                    <input type="radio"
                        id="childWorkPackagesYes-${childData.id}"
                        name="childWorkPackages-${childData.id}"
                        value="yes"
                        checked>
                    <label for="childWorkPackagesYes-${childData.id}" class="mode-option">Yes</label>

                    <input type="radio"
                        id="childWorkPackagesNo-${childData.id}"
                        name="childWorkPackages-${childData.id}"
                        value="no">
                    <label for="childWorkPackagesNo-${childData.id}" class="mode-option">No</label>
                </div>
            </div>
        </div>
    `;

    container.appendChild(childDiv);
    attachChildCompanyListeners(childData.id);
}

/**
 * Attach event listeners to child company form
 */
function attachChildCompanyListeners(childId) {
    // Use main password toggle
    const useMainPasswordCheckbox = document.querySelector(`.child-use-main-password[data-child-id="${childId}"]`);
    const childPasswordInput = document.querySelector(`.child-password[data-child-id="${childId}"]`);

    useMainPasswordCheckbox.addEventListener('change', function() {
        childPasswordInput.disabled = this.checked;
        if (this.checked) {
            childPasswordInput.value = '';
        }
    });

    // Helper function to load projects for this child
    const loadChildProjects = async () => {
        const dataGroup = document.querySelector(`.child-data-group[data-child-id="${childId}"]`)?.value;
        const projectType = document.querySelector(`.child-project-type[data-child-id="${childId}"]`)?.value;
        const projectBox = document.querySelector(`.child-project-box-${childId}`);
        const projectList = document.querySelector(`.child-project-list-${childId}`);

        if (!dataGroup) {
            projectBox.style.display = 'none';
            return;
        }

        if (!projectType) {
            projectBox.style.display = 'block';
            projectList.innerHTML = '<div class="loading-projects">Please select a project type first</div>';
            return;
        }

        projectBox.style.display = 'block';
        projectList.innerHTML = '<div class="loading-projects">Loading projects...</div>';

        try {
            const response = await fetch(`/api/projects/${dataGroup}?projectType=${projectType}`);
            const data = await response.json();

            if (data.projects && data.projects.length > 0) {
                projectList.innerHTML = data.projects.map((project, index) => `
                    <div class="project-item">
                        <label>
                            <input type="checkbox"
                                class="project-checkbox child-project-checkbox-${childId}"
                                data-child-id="${childId}"
                                data-short-title="${project.short_title}">
                            <div class="project-item-content">
                                <div class="project-item-title">${project.title}</div>
                                <div class="project-item-details">${project.short_title} | ${project.started_at} - ${project.finished_at}</div>
                            </div>
                        </label>
                    </div>
                `).join('');

                // Select all checkbox
                const selectAllCheckbox = document.querySelector(`.child-select-all-projects[data-child-id="${childId}"]`);
                selectAllCheckbox.addEventListener('change', function() {
                    const checkboxes = document.querySelectorAll(`.child-project-checkbox-${childId}`);
                    checkboxes.forEach(cb => cb.checked = this.checked);
                });
            } else {
                projectList.innerHTML = '<div class="loading-projects">No projects found for selected project type</div>';
            }
        } catch (error) {
            projectList.innerHTML = '<div class="loading-projects">Failed to load projects</div>';
        }
    };

    // Data group change - load projects
    const dataGroupSelect = document.querySelector(`.child-data-group[data-child-id="${childId}"]`);
    dataGroupSelect.addEventListener('change', loadChildProjects);

    // Project type change - load projects
    const projectTypeSelect = document.querySelector(`.child-project-type[data-child-id="${childId}"]`);
    projectTypeSelect.addEventListener('change', loadChildProjects);
}

/**
 * Collect all child companies data
 */
function collectChildCompanies() {
    const mainPassword = document.getElementById('password').value.trim();

    return childCompanies.map(child => {
        const companyName = document.querySelector(`.child-company-name[data-child-id="${child.id}"]`)?.value.trim();
        const email = document.querySelector(`.child-email[data-child-id="${child.id}"]`)?.value.trim();
        const useMainPassword = document.querySelector(`.child-use-main-password[data-child-id="${child.id}"]`)?.checked;
        const password = useMainPassword ? mainPassword : document.querySelector(`.child-password[data-child-id="${child.id}"]`)?.value.trim();
        const emailDomain = document.querySelector(`.child-email-domain[data-child-id="${child.id}"]`)?.value.trim();
        const projectType = document.querySelector(`.child-project-type[data-child-id="${child.id}"]`)?.value;
        const dataGroup = document.querySelector(`.child-data-group[data-child-id="${child.id}"]`)?.value;
        const includeWorkPackages = document.querySelector(`input[name="childWorkPackages-${child.id}"]:checked`)?.value === 'yes';

        const selectedCheckboxes = document.querySelectorAll(`.child-project-checkbox-${child.id}:checked`);
        const selectedProjects = Array.from(selectedCheckboxes).map(cb => cb.getAttribute('data-short-title'));

        return {
            companyName,
            email,
            password,
            emailDomain,
            projectType: projectType ? parseInt(projectType) : undefined,
            dataGroup,
            selectedProjects,
            includeWorkPackages
        };
    });
}

// Add child company button
document.getElementById('addChildCompanyBtn').addEventListener('click', addChildCompany);

// Create demo
document.getElementById('createBtn').addEventListener('click', async () => {
    clearAllErrors();
    currentMode = document.querySelector('input[name="mode"]:checked').value;

    const companyName = document.getElementById('companyName').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const passwordConfirm = document.getElementById('passwordConfirm').value.trim();
    const dataGroup = document.getElementById('dataGroup').value;
    const emailDomain = document.getElementById('emailDomain').value.trim();
    const environment = document.getElementById('environment').value || 'testing';
    const projectType = document.getElementById('projectType').value;

    let hasError = false;

    // Main company validation
    if (!companyName) { showValidationError('Company name is required'); hasError = true; }
    if (!email) { showValidationError('Email is required'); hasError = true; }
    else if (!validateEmail(email)) { showValidationError('Invalid email format'); hasError = true; }
    else if (!email.endsWith('@yopmail.com')) { showValidationError('Email must be a yopmail.com address'); hasError = true; }

    if (!password) { showValidationError('Password is required'); hasError = true; }
    else if (password.length < 8) { showValidationError('Password must be at least 8 characters'); hasError = true; }

    if (!passwordConfirm) { showValidationError('Password confirmation is required'); hasError = true; }
    else if (password !== passwordConfirm) { showValidationError('Passwords do not match'); hasError = true; }

    if (!projectType) { showValidationError('Project type is required'); hasError = true; }
    if (!dataGroup) { showValidationError('Data selection is required'); hasError = true; }
    if (!emailDomain) { showValidationError('Email domain is required'); hasError = true; }
    if (!environment) { showValidationError('Environment selection is required'); hasError = true; }

    const selectedProjectsValue = document.getElementById('selectedProjects').value;
    const selectedProjects = selectedProjectsValue ? JSON.parse(selectedProjectsValue) : [];
    if (selectedProjects.length === 0) { showValidationError('Please select at least one project'); hasError = true; }

    // Child companies validation
    const childCompaniesData = collectChildCompanies();
    childCompaniesData.forEach((child, index) => {
        if (!child.companyName) { showValidationError(`Child Company #${index + 1}: Company name is required`); hasError = true; }
        if (!child.email) { showValidationError(`Child Company #${index + 1}: Email is required`); hasError = true; }
        else if (!validateEmail(child.email)) { showValidationError(`Child Company #${index + 1}: Invalid email format`); hasError = true; }
        else if (!child.email.endsWith('@yopmail.com')) { showValidationError(`Child Company #${index + 1}: Email must be a yopmail.com address`); hasError = true; }
        if (!child.projectType) { showValidationError(`Child Company #${index + 1}: Project type is required`); hasError = true; }
        if (!child.dataGroup) { showValidationError(`Child Company #${index + 1}: Data selection is required`); hasError = true; }
        if (!child.emailDomain) { showValidationError(`Child Company #${index + 1}: Email domain is required`); hasError = true; }
        if (!child.selectedProjects || child.selectedProjects.length === 0) { showValidationError(`Child Company #${index + 1}: Please select at least one project`); hasError = true; }
    });

    if (hasError) return;

    if (currentMode === 'step') {
        document.getElementById('stepByStepContainer').style.display = 'flex';
        document.getElementById('stepLogContent').innerHTML = '';
        renderSteps();
        return;
    }

    document.getElementById('confirmationOverlay').classList.add('show');
});

// Confirmation handlers
document.getElementById('confirmNo').addEventListener('click', () => {
    document.getElementById('confirmationOverlay').classList.remove('show');
});

document.getElementById('confirmYes').addEventListener('click', async () => {
    document.getElementById('confirmationOverlay').classList.remove('show');

    const companyName = document.getElementById('companyName').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const dataGroup = document.getElementById('dataGroup').value;
    const emailDomain = document.getElementById('emailDomain').value.trim();
    const environment = document.getElementById('environment').value || 'testing';
    const selectedProjectsValue = document.getElementById('selectedProjects').value;
    const selectedProjects = selectedProjectsValue ? JSON.parse(selectedProjectsValue) : [];
    const includeWorkPackages = document.querySelector('input[name="workPackages"]:checked').value === 'yes';
    const childCompaniesData = collectChildCompanies();

    const createBtn = document.getElementById('createBtn');
    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ADDING TO QUEUE <i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const response = await fetch('/api/create-demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName,
                email,
                password,
                projectType: document.getElementById('projectType').value,
                dataGroup,
                emailDomain,
                environment,
                selectedProjects,
                includeWorkPackages,
                childCompanies: childCompaniesData,
                socketId: socket.id
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to add job to queue');
        }

        // Show success message
        showSuccessMessage(`Job added to queue! (ID: ${data.jobId})`);

        // Clear form for next entry
        clearFormForNextJob();

        // Refresh job dashboard
        renderJobsDashboard();
    } catch (error) {
        showValidationError(`Error: ${error.message}`);
    } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = '<span class="button-text"><i class="fa-solid fa-plus"></i> ADD TO QUEUE <i class="fa-solid fa-plus"></i></span>';
    }
});

/**
 * Clear form fields for next job
 */
function clearFormForNextJob() {
    // Clear text inputs
    document.getElementById('companyName').value = '';
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
    document.getElementById('passwordConfirm').value = '';
    document.getElementById('emailDomain').value = '';

    // Clear project selection
    document.getElementById('selectedProjects').value = '';
    const projectCheckboxes = document.querySelectorAll('.project-checkbox');
    projectCheckboxes.forEach(cb => cb.checked = false);
    const selectAllCheckbox = document.getElementById('selectAllProjects');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;

    // Clear child companies
    childCompanies = [];
    childCompanyCounter = 0;
    document.getElementById('childCompaniesList').innerHTML = '';

    // Keep data group, environment, project type, and work packages selections
}

/**
 * Show success message
 */
function showSuccessMessage(message) {
    const errorContainer = document.getElementById('validationErrors');
    errorContainer.innerHTML = `
        <div class="validation-error" style="border-left-color: #4caf50; color: #4caf50; background: rgba(76, 175, 80, 0.1);">
            <i class="fa-solid fa-check-circle"></i> ${message}
        </div>
    `;

    // Auto-hide after 3 seconds
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 3000);
}

// Socket events
socket.on('log', (data) => {
    // Handle job-specific logs
    if (data.jobId) {
        addJobLog(data.jobId, data.type, data.message);
    }
    // Also show in main log if it's the current job
    addLog(data.type, data.message);
    updateProgress();
});

/**
 * Add log entry to specific job
 */
function addJobLog(jobId, type, message) {
    const jobIdStr = jobId.toString();

    if (!activeJobLogs.has(jobIdStr)) {
        activeJobLogs.set(jobIdStr, []);
    }

    const logs = activeJobLogs.get(jobIdStr);
    logs.push({ type, message, timestamp: new Date().toLocaleTimeString() });

    // Keep only last 500 logs to prevent memory issues
    if (logs.length > 500) {
        logs.shift();
    }

    // Update display if log is open (will be handled by next render cycle)
}

socket.on('complete', () => {
    addLog('success', 'Completed');
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();

    demoState = 'completed';
    isCreating = false;
    currentJobId = null;

    updateCreateNewButton();
    socket.emit('demo-completed');
});

socket.on('error', (data) => {
    addLog('error', `${data.message}`);
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();

    demoState = 'failed';
    isCreating = false;
    currentJobId = null;

    updateCreateNewButton();
    socket.emit('demo-completed');
});

socket.on('demo-complete', (data) => {
    if (data.success) {
        addLog('success', 'Completed');
        demoState = 'completed';
    } else {
        addLog('error', `Failed: ${data.error || 'Unknown error'}`);
        demoState = 'failed';
    }

    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();
    isCreating = false;
    currentJobId = null;

    updateCreateNewButton();
    socket.emit('demo-completed');
});

// Track if user has manually scrolled up
let isUserScrolledUp = false;

document.addEventListener('DOMContentLoaded', () => {
    const logContent = document.getElementById('logContent');
    if (logContent) {
        logContent.addEventListener('scroll', () => {
            const isAtBottom = logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight < 10;
            isUserScrolledUp = !isAtBottom;
        });
    }

    addRippleEffect();
    updateCreateNewButton();
});

// Ripple effect function
function createRipple(event) {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

function addRippleEffect() {
    const selectors = [
        'button',
        '.btn-primary',
        '.mode-option',
        '.confirmation-btn',
        '.step-button',
        '.project-select-all',
        '.select-selected',
        '.dropdown-menu div'
    ];

    selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.addEventListener('mousedown', createRipple);
        });
    });
}

function addLog(type, message) {
    const logContent = document.getElementById('logContent');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = message;
    logContent.appendChild(entry);

    if (!isUserScrolledUp) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function updateProgress() {
    totalLogs++;
    const progressFill = document.getElementById('progressFill');
    const progressPercent = Math.min((totalLogs / estimatedTotalSteps) * 100, 95);
    progressFill.style.width = progressPercent + '%';
}

function resetButton() {
    isCreating = false;
    const btn = document.getElementById('createBtn');
    btn.disabled = false;
    btn.innerHTML = 'CREATE DEMO';
}

function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = display;
}

// Disable/Enable form inputs
function disableFormInputs() {
    const form = document.getElementById('demoForm');
    if (form) form.classList.add('is-locked');

    // Collapse dropdowns visually
    closeAllDropdowns();

    const controls = document.querySelectorAll('#demoForm input, #demoForm button, .select-selected');
    controls.forEach(el => {
        if (el.id === 'forceStopBtn' || el.id === 'createNewBtn') return;
        if ('disabled' in el) el.disabled = true;
        if (el.classList && el.classList.contains('select-selected')) {
            el.setAttribute('aria-disabled', 'true');
        }
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';
    });
}

function enableFormInputs() {
    const form = document.getElementById('demoForm');
    if (form) form.classList.remove('is-locked');

    const controls = document.querySelectorAll('#demoForm input, #demoForm button, .select-selected');
    controls.forEach(el => {
        if ('disabled' in el) el.disabled = false;
        if (el.classList && el.classList.contains('select-selected')) {
            el.removeAttribute('aria-disabled');
        }
        el.style.opacity = '';
        el.style.cursor = '';
    });
}

// Force stop button
function showForceStopButton() {
    let stopBtn = document.getElementById('forceStopBtn');
    if (!stopBtn) {
        stopBtn = document.createElement('button');
        stopBtn.id = 'forceStopBtn';
        stopBtn.className = 'btn-danger';
        stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> FORCE STOP';
        stopBtn.onclick = forceStopJob;

        const createBtn = document.getElementById('createBtn');
        createBtn.parentNode.insertBefore(stopBtn, createBtn.nextSibling);
    }
    stopBtn.style.display = 'block';
}

function hideForceStopButton() {
    const stopBtn = document.getElementById('forceStopBtn');
    if (stopBtn) stopBtn.style.display = 'none';
}

async function forceStopJob() {
    if (!currentJobId) {
        addLog('warning', 'No active job to stop');
        return;
    }

    if (!confirm('Are you sure you want to force stop the current job? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/job/${currentJobId}/stop`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            addLog('warning', 'Job stopped by user');
            demoState = 'stopped';
        } else {
            addLog('error', `Failed to stop job: ${data.error}`);
        }
    } catch (error) {
        addLog('error', `Error stopping job: ${error.message}`);
    } finally {
        hideForceStopButton();
        stopTimer();
        document.getElementById('animationCharacter').classList.remove('show');

        if (demoState === 'stopped') {
            isCreating = false;
            currentJobId = null;
        }

        updateCreateNewButton();
    }
}

function updateCreateNewButton() {
    const createBtn = document.getElementById('createBtn');
    const createNewBtn = document.getElementById('createNewBtn');
    if (!createBtn || !createNewBtn) return;

    createNewBtn.style.display = 'none';
    createNewBtn.disabled = true;

    if (demoState === 'completed' || demoState === 'stopped') {
        createBtn.style.display = 'none';
        createNewBtn.style.display = 'block';
        createNewBtn.disabled = false;
        createNewBtn.style.opacity = '';
        createNewBtn.style.cursor = '';
    } else {
        createBtn.style.display = 'block';
        createNewBtn.style.display = 'none';
    }
}

// Reset everything for new demo creation
function resetForNewDemo() {
    demoState = 'idle';
    isCreating = false;
    currentJobId = null;

    enableFormInputs();

    document.getElementById('logContent').innerHTML = '';
    document.getElementById('logContainer').style.display = 'none';
    document.getElementById('progressBar').style.display = 'none';
    document.getElementById('timerContainer').style.display = 'none';

    document.getElementById('progressFill').style.width = '0%';
    totalLogs = 0;

    updateCreateNewButton();
    resetButton();
}

// Create New Demo Account button handler
document.addEventListener('DOMContentLoaded', () => {
    const createNewBtn = document.getElementById('createNewBtn');
    if (createNewBtn) {
        createNewBtn.addEventListener('click', () => {
            resetForNewDemo();
        });
    }

    // Start job polling
    startJobPolling();
});

// =========================
// JOB MANAGEMENT FUNCTIONS
// =========================

let jobPollingInterval = null;
const activeJobLogs = new Map(); // jobId -> logs array
const openJobLogs = new Set(); // Track which job logs are open

/**
 * Fetch all jobs from API
 */
async function fetchJobs() {
    try {
        const response = await fetch('/api/jobs');
        const data = await response.json();
        return data.jobs || [];
    } catch (error) {
        console.error('Error fetching jobs:', error);
        return [];
    }
}

/**
 * Render jobs dashboard
 */
async function renderJobsDashboard() {
    const jobs = await fetchJobs();
    const dashboard = document.getElementById('jobsDashboard');
    const jobsList = document.getElementById('jobsList');

    if (!dashboard || !jobsList) return;

    // Filter out completed and failed jobs older than 5 minutes
    const activeJobs = jobs.filter(job => {
        if (job.state === 'completed' || job.state === 'failed') {
            const finishedTime = job.finishedOn || Date.now();
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            return finishedTime > fiveMinutesAgo;
        }
        return true;
    });

    if (activeJobs.length === 0) {
        dashboard.style.display = 'none';
        return;
    }

    dashboard.style.display = 'block';

    // Save current scroll positions before re-rendering
    const scrollPositions = new Map();
    openJobLogs.forEach(jobId => {
        const logsContainer = document.getElementById(`logs-${jobId}`);
        if (logsContainer) {
            const isAtBottom = logsContainer.scrollHeight - logsContainer.scrollTop - logsContainer.clientHeight < 10;
            scrollPositions.set(jobId, {
                position: logsContainer.scrollTop,
                isAtBottom: isAtBottom
            });
        }
    });

    jobsList.innerHTML = activeJobs.map(job => {
        const progress = job.progress || { percentage: 0, message: '' };
        const message = progress.message || '';

        // Map data group names to display names
        const dataGroupNames = {
            'manufacturing-en': 'Manufacturing & Product Development',
            'healthcare-en': 'Healthcare & Pharmaceuticals',
            'financial-en': 'Financial Services',
            'consulting-en': 'Services & Consulting',
            'energy-en': 'Energy & Utilities',
            'government-en': 'Government & Public Sector',
            'construction-en': 'Construction & Infrastructure',
            'media-en': 'Media & Telecommunications',
            'manufacturing-de': 'Fertigung & Produktentwicklung',
            'healthcare-de': 'Gesundheitswesen & Pharmazeutika',
            'financial-de': 'Finanzdienstleistungen',
            'consulting-de': 'Dienstleistungen & Beratung',
            'energy-de': 'Energie & Versorgung',
            'government-de': 'Verwaltung & Öffentlicher Sektor',
            'construction-de': 'Bau & Infrastruktur',
            'media-de': 'Medien & Telekommunikation'
        };

        const dataGroupDisplay = dataGroupNames[job.data.dataGroup] || job.data.dataGroup;

        return `
            <div class="job-card ${job.state}" data-job-id="${job.id}">
                <div class="job-header">
                    <div class="job-title">
                        <i class="fa-solid fa-building"></i> ${job.data.companyName || 'Demo Account'}
                    </div>
                    <span class="job-status-badge ${job.state}">
                        ${job.state === 'waiting' ? '<i class="fa-solid fa-pause"></i> Queued' :
                          job.state === 'active' ? '<i class="fa-solid fa-spinner fa-spin"></i> Running' :
                          job.state === 'completed' ? '<i class="fa-solid fa-check"></i> Completed' :
                          job.state === 'failed' ? '<i class="fa-solid fa-times"></i> Failed' : job.state}
                    </span>
                </div>

                <div class="job-details">
                    <div class="job-detail">
                        <i class="fa-solid fa-envelope"></i> ${job.data.email || 'N/A'}
                    </div>
                    <div class="job-detail">
                        <i class="fa-solid fa-database"></i> ${dataGroupDisplay}
                    </div>
                    <div class="job-detail">
                        <i class="fa-solid fa-server"></i> ${job.data.environment || 'testing'}
                    </div>
                    <div class="job-detail">
                        <i class="fa-solid fa-hashtag"></i> Job ID: ${job.id}
                    </div>
                </div>

                ${job.state === 'active' ? `
                    <div class="job-progress-text">
                        <i class="fa-solid fa-spinner fa-spin"></i> ${message || 'Processing...'}
                    </div>
                ` : ''}

                ${job.state === 'failed' && job.failedReason ? `
                    <div class="job-progress-text" style="color: #ab47bc;">
                        <i class="fa-solid fa-exclamation-triangle"></i> ${job.failedReason}
                    </div>
                ` : ''}

                <div class="job-actions">
                    <button class="job-action-btn" onclick="toggleJobLogs('${job.id}')">
                        <i class="fa-solid fa-list"></i> Logs
                    </button>
                    ${job.state === 'waiting' || job.state === 'active' ? `
                        <button class="job-action-btn cancel" onclick="cancelJob('${job.id}')">
                            <i class="fa-solid fa-times"></i> Cancel
                        </button>
                    ` : ''}
                </div>

                <div class="job-logs ${openJobLogs.has(job.id.toString()) ? 'show' : ''}" id="logs-${job.id}" data-job-id="${job.id}">
                    ${renderJobLogs(job.id)}
                </div>
            </div>
        `;
    }).join('');

    // Restore scroll positions intelligently
    setTimeout(() => {
        openJobLogs.forEach(jobId => {
            const logsContainer = document.getElementById(`logs-${jobId}`);
            if (logsContainer) {
                const savedPosition = scrollPositions.get(jobId);
                if (savedPosition) {
                    // If user was at bottom, keep them at bottom (for new logs)
                    // Otherwise, restore their scroll position
                    if (savedPosition.isAtBottom) {
                        logsContainer.scrollTop = logsContainer.scrollHeight;
                    } else {
                        logsContainer.scrollTop = savedPosition.position;
                    }
                } else {
                    // First time opening logs, scroll to bottom
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                }
            }
        });
    }, 0);
}

/**
 * Render logs for a specific job
 */
function renderJobLogs(jobId) {
    const logs = activeJobLogs.get(jobId.toString());

    if (!logs || logs.length === 0) {
        return '<div style="color: var(--text-secondary); text-align: center; padding: 8px;">No logs yet...</div>';
    }

    return logs.map(log => {
        const colorMap = {
            'info': '#90caf9',
            'success': '#a5d6a7',
            'warning': '#ffcc80',
            'error': 'var(--accent-primary)'
        };
        const color = colorMap[log.type] || '#90caf9';

        return `<div class="log-entry" style="color: ${color}; margin-bottom: 4px;">
            <span style="color: var(--text-secondary);">[${log.timestamp}]</span> ${log.message}
        </div>`;
    }).join('');
}

/**
 * Toggle job logs visibility
 */
function toggleJobLogs(jobId) {
    if (openJobLogs.has(jobId)) {
        openJobLogs.delete(jobId);
    } else {
        openJobLogs.add(jobId);
        // Initialize logs if first time
        if (!activeJobLogs.has(jobId)) {
            activeJobLogs.set(jobId, []);
        }
    }

    // Re-render to update UI
    renderJobsDashboard();
}

/**
 * Cancel a job
 */
async function cancelJob(jobId) {
    if (!confirm('Are you sure you want to cancel this job?')) return;

    try {
        const response = await fetch(`/api/job/${jobId}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            addLog('info', `Job ${jobId} cancelled successfully`);
            renderJobsDashboard();
        } else {
            addLog('error', `Failed to cancel job: ${data.error}`);
        }
    } catch (error) {
        addLog('error', `Error cancelling job: ${error.message}`);
    }
}

/**
 * Clear completed jobs
 */
async function clearCompletedJobs() {
    const jobs = await fetchJobs();
    const completedJobs = jobs.filter(job => job.state === 'completed' || job.state === 'failed');

    console.log(`Clearing ${completedJobs.length} jobs:`, completedJobs.map(j => `${j.id} (${j.state})`));

    // Delete all jobs in parallel
    const deletePromises = completedJobs.map(async (job) => {
        try {
            const response = await fetch(`/api/job/${job.id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Remove from active logs
            activeJobLogs.delete(job.id.toString());
            openJobLogs.delete(job.id.toString());

            console.log(`✓ Cleared job ${job.id} (${job.state})`);
        } catch (error) {
            console.error(`✗ Error clearing job ${job.id}:`, error);
        }
    });

    // Wait for all deletions to complete
    await Promise.all(deletePromises);

    // Small delay to ensure backend processing is complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Re-render dashboard
    renderJobsDashboard();
}

// Clear completed button handler
document.addEventListener('DOMContentLoaded', () => {
    const clearBtn = document.getElementById('clearCompletedBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearCompletedJobs);
    }
});

/**
 * Start polling for job updates
 */
function startJobPolling() {
    // Update immediately
    renderJobsDashboard();

    // Then update every 2 seconds
    if (jobPollingInterval) {
        clearInterval(jobPollingInterval);
    }

    jobPollingInterval = setInterval(() => {
        renderJobsDashboard();
    }, 2000);
}

/**
 * Stop polling for job updates
 */
function stopJobPolling() {
    if (jobPollingInterval) {
        clearInterval(jobPollingInterval);
        jobPollingInterval = null;
    }
}
