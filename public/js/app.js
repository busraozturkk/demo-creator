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
let estimatedTotalSteps = 2500; // Approximate number of log messages expected
let currentMode = 'bulk';
/** @type {SessionData|null} */
let sessionData = null;
let timerInterval = null;
let startTime = null;
let currentJobId = null; // Track current running job

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
        e.stopPropagation();

        // Close other dropdowns
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu !== selectItems) {
                menu.classList.remove('show');
            }
        });
        document.querySelectorAll('.select-selected').forEach(select => {
            if (select !== selectSelected) {
                select.classList.remove('select-arrow-active');
            }
        });

        // Toggle this dropdown
        selectItems.classList.toggle('show');
        this.classList.toggle('select-arrow-active');
    });

    // Select item
    const items = selectItems.getElementsByTagName('div');
    for (let i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function(e) {
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

            // Load project-management when data group is selected
            if (inputId === 'dataGroup') {
                loadProjects(this.getAttribute('data-value'));
            }
        });
    }
}

/**
 * Load project-management from CSV based on selected data group
 * @param {string} dataGroup - Selected data group
 */
async function loadProjects(dataGroup) {
    const projectSelectionBox = document.getElementById('projectSelectionBox');
    const projectList = document.getElementById('projectList');

    if (!dataGroup) {
        projectSelectionBox.style.display = 'none';
        return;
    }

    // Show the project selection box
    projectSelectionBox.style.display = 'block';

    // Show loading state
    projectList.innerHTML = '<div class="loading-projects">Loading projects...</div>';

    try {
        const response = await fetch(`/api/projects/${dataGroup}`);
        const data = await response.json();

        if (!response.ok || !data.projects) {
            throw new Error('Failed to load projects');
        }

        // Render projects
        renderProjects(data.projects);
    } catch (error) {
        projectList.innerHTML = '<div class="loading-projects">Error loading project-management</div>';
        console.error('Error loading project-management:', error);
    }
}

/**
 * Render project checkboxes
 * @param {Array} projects - Array of project objects
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

    // Initialize select all checkbox
    const selectAllCheckbox = document.getElementById('selectAllProjects');
    selectAllCheckbox.checked = false;

    selectAllCheckbox.addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.project-checkbox');
        checkboxes.forEach(cb => cb.checked = this.checked);
        updateSelectedProjects();
    });

    // Add ripple effect to select all container
    const selectAllContainer = document.querySelector('.project-select-all');
    if (selectAllContainer) {
        selectAllContainer.addEventListener('mousedown', createRipple);
    }

    // Add change listeners to project checkboxes
    document.querySelectorAll('.project-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateSelectedProjects);
    });

    // Add ripple effect to newly created project items
    document.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('mousedown', createRipple);
    });
}

/**
 * Update hidden input with selected project short titles
 */
function updateSelectedProjects() {
    const selectedCheckboxes = document.querySelectorAll('.project-checkbox:checked');
    const selectedTitles = Array.from(selectedCheckboxes).map(cb => cb.getAttribute('data-short-title'));
    document.getElementById('selectedProjects').value = JSON.stringify(selectedTitles);

    // Update select all checkbox state
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
        document.querySelectorAll('.step-button').forEach((btn, index) => {
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

    setTimeout(() => {
        heart.remove();
    }, 2000);
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
    const spells = [
        "Lumos",
        "Nox",
        "Alohomora",
        "Expelliarmus",
        "Expecto Patronum",
        "Wingardium Leviosa",
        "Stupefy",
        "Accio"
    ];

    const animations = ['spellFloat', 'spellFloat2', 'spellFloat3'];

    const spell = document.createElement('div');
    spell.className = 'animated-spell';
    spell.textContent = spells[Math.floor(Math.random() * spells.length)];
    spell.style.left = x + 'px';
    spell.style.top = y + 'px';
    spell.style.animationName = animations[Math.floor(Math.random() * animations.length)];

    document.getElementById('mainContainer').appendChild(spell);

    setTimeout(() => {
        spell.remove();
    }, 2000);
}

// Magic wand icon hover effect
document.addEventListener('DOMContentLoaded', () => {
    const magicIcon = document.querySelector('.animation-character');
    if (magicIcon) {
        magicIcon.addEventListener('mouseenter', (e) => {
            const rect = e.target.getBoundingClientRect();
            const spellsCount = 3;

            // Get center point of the magic icon
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            for (let i = 0; i < spellsCount; i++) {
                setTimeout(() => {
                    createAnimatedSpell(centerX, centerY);
                }, i * 150);
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

// Create demo
document.getElementById('createBtn').addEventListener('click', async () => {
    if (isCreating) return;

    clearAllErrors();

    // Get current mode
    currentMode = document.querySelector('input[name="mode"]:checked').value;

    const companyName = document.getElementById('companyName').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const passwordConfirm = document.getElementById('passwordConfirm').value.trim();
    const dataGroup = document.getElementById('dataGroup').value;
    const emailDomain = document.getElementById('emailDomain').value.trim();
    const environment = document.getElementById('environment').value || 'testing';

    let hasError = false;

    // Validation - all fields
    if (!companyName) {
        showValidationError('Company name is required');
        hasError = true;
    }

    if (!email) {
        showValidationError('Email is required');
        hasError = true;
    } else if (!validateEmail(email)) {
        showValidationError('Invalid email format');
        hasError = true;
    } else if (!email.endsWith('@yopmail.com')) {
        showValidationError('Email must be a yopmail.com address');
        hasError = true;
    }

    if (!password) {
        showValidationError('Password is required');
        hasError = true;
    } else if (password.length < 8) {
        showValidationError('Password must be at least 8 characters');
        hasError = true;
    }

    if (!passwordConfirm) {
        showValidationError('Password confirmation is required');
        hasError = true;
    } else if (password !== passwordConfirm) {
        showValidationError('Passwords do not match');
        hasError = true;
    }

    if (!dataGroup) {
        showValidationError('Data selection is required');
        hasError = true;
    }

    if (!emailDomain) {
        showValidationError('Email domain is required');
        hasError = true;
    }

    if (!environment) {
        showValidationError('Environment selection is required');
        hasError = true;
    }

    const selectedProjectsValue = document.getElementById('selectedProjects').value;
    const selectedProjects = selectedProjectsValue ? JSON.parse(selectedProjectsValue) : [];
    if (selectedProjects.length === 0) {
        showValidationError('Please select at least one project');
        hasError = true;
    }

    if (hasError) {
        return;
    }

    // For step-by-step mode, show the steps and logs panel
    if (currentMode === 'step') {
        document.getElementById('stepByStepContainer').style.display = 'flex';
        document.getElementById('stepLogContent').innerHTML = '';
        renderSteps();
        return;
    }

    // For bulk mode, show confirmation modal
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

    isCreating = true;
    totalLogs = 0;
    document.getElementById('createBtn').disabled = true;
    document.getElementById('createBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> IN PROGRESS <i class="fa-solid fa-spinner fa-spin"></i>';

    // Disable form inputs while job is running
    disableFormInputs();

    // Show force stop button
    showForceStopButton();

    document.getElementById('logContainer').style.display = 'block';
    document.getElementById('progressBar').style.display = 'block';
    document.getElementById('timerContainer').style.display = 'flex';
    // Don't clear logs - keep them persistent
    // document.getElementById('logContent').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';

    // Start timer
    startTimer();

    // Show dancing girl
    document.getElementById('animationCharacter').classList.add('show');

    // Notify server that demo creation started
    socket.emit('demo-started');

    try {
        const response = await fetch('/api/create-demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName,
                email,
                password,
                dataGroup,
                emailDomain,
                environment,
                selectedProjects,
                includeWorkPackages,
                socketId: socket.id
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to start demo creation');
        }

        // Store job ID for force stop
        currentJobId = data.jobId;
        addLog('info', `📋 Job queued with ID: ${data.jobId}`);

    } catch (error) {
        addLog('error', `${error.message}`);
        resetButton();
        enableFormInputs();
        hideForceStopButton();
    }
});

// Socket events
socket.on('log', (data) => {
    addLog(data.type, data.message);
    updateProgress();
});

socket.on('complete', () => {
    addLog('success', 'Completed!');
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();
    currentJobId = null;

    // Show "Create New Demo Account" button
    showCreateNewButton();

    // Notify server that demo creation completed
    socket.emit('demo-completed');
});

socket.on('error', (data) => {
    addLog('error', `${data.message}`);
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();
    currentJobId = null;

    // Show "Create New Demo Account" button
    showCreateNewButton();

    // Notify server that demo creation completed (with error)
    socket.emit('demo-completed');
});

socket.on('demo-complete', (data) => {
    if (data.success) {
        addLog('success', '✨ Demo creation completed successfully!');
    } else {
        addLog('error', `❌ Demo creation failed: ${data.error || 'Unknown error'}`);
    }
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('animationCharacter').classList.remove('show');
    stopTimer();
    hideForceStopButton();
    currentJobId = null;

    // Show "Create New Demo Account" button
    showCreateNewButton();

    socket.emit('demo-completed');
});

// Track if user has manually scrolled up
let isUserScrolledUp = false;

// Detect when user scrolls in log content
document.addEventListener('DOMContentLoaded', () => {
    const logContent = document.getElementById('logContent');
    if (logContent) {
        logContent.addEventListener('scroll', () => {
            // Check if user is at the bottom (with small threshold for rounding)
            const isAtBottom = logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight < 10;
            isUserScrolledUp = !isAtBottom;
        });
    }

    // Add ripple effect to all clickable elements
    addRippleEffect();
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

    // Remove ripple after animation
    setTimeout(() => {
        ripple.remove();
    }, 600);
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

    // Only auto-scroll if user hasn't manually scrolled up
    if (!isUserScrolledUp) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function updateProgress() {
    totalLogs++;
    const progressFill = document.getElementById('progressFill');

    // Calculate progress based on actual logs received
    // Cap at 95% until completion
    const progressPercent = Math.min((totalLogs / estimatedTotalSteps) * 100, 95);

    // Smooth transition
    progressFill.style.width = progressPercent + '%';
}

function resetButton() {
    isCreating = false;
    document.getElementById('createBtn').disabled = false;
    document.getElementById('createBtn').innerHTML = '<span class="button-text"><i class="fa-solid fa-sparkles"></i> CREATE DEMO <i class="fa-solid fa-sparkles"></i></span>';
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
    const inputs = document.querySelectorAll('#demoForm input, #demoForm button, .select-selected');
    inputs.forEach(input => {
        input.disabled = true;
        input.style.opacity = '0.5';
        input.style.cursor = 'not-allowed';
    });
}

function enableFormInputs() {
    const inputs = document.querySelectorAll('#demoForm input, #demoForm button, .select-selected');
    inputs.forEach(input => {
        input.disabled = false;
        input.style.opacity = '';
        input.style.cursor = '';
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

        // Insert after the create button
        const createBtn = document.getElementById('createBtn');
        createBtn.parentNode.insertBefore(stopBtn, createBtn.nextSibling);
    }
    stopBtn.style.display = 'block';
}

function hideForceStopButton() {
    const stopBtn = document.getElementById('forceStopBtn');
    if (stopBtn) {
        stopBtn.style.display = 'none';
    }
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
        const response = await fetch(`/api/job/${currentJobId}/stop`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            addLog('warning', '⚠️ Job stopped by user');
        } else {
            addLog('error', `Failed to stop job: ${data.error}`);
        }
    } catch (error) {
        addLog('error', `Error stopping job: ${error.message}`);
    } finally {
        hideForceStopButton();
        stopTimer();
        document.getElementById('animationCharacter').classList.remove('show');
        currentJobId = null;

        // Show "Create New Demo Account" button instead of resetting immediately
        showCreateNewButton();
    }
}

// Show/Hide Create New Demo Account button
function showCreateNewButton() {
    document.getElementById('createBtn').style.display = 'none';
    document.getElementById('createNewBtn').style.display = 'block';
}

function hideCreateNewButton() {
    document.getElementById('createBtn').style.display = 'block';
    document.getElementById('createNewBtn').style.display = 'none';
}

// Reset everything for new demo creation
function resetForNewDemo() {
    // Clear logs
    document.getElementById('logContent').innerHTML = '';

    // Hide log container, progress bar, timer
    document.getElementById('logContainer').style.display = 'none';
    document.getElementById('progressBar').style.display = 'none';
    document.getElementById('timerContainer').style.display = 'none';

    // Reset progress
    document.getElementById('progressFill').style.width = '0%';
    totalLogs = 0;

    // Enable form inputs
    enableFormInputs();

    // Hide create new button, show create button
    hideCreateNewButton();

    // Reset button state
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
});

// Version checking removed