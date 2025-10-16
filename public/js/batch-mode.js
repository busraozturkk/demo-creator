/**
 * Batch Mode Handler
 * Manages multiple demo creations in sequence
 */

class BatchModeHandler {
    constructor(socket) {
        this.socket = socket;
        this.batchQueue = [];
        this.isRunning = false;
        this.currentIndex = 0;

        this.initializeElements();
        this.attachEventListeners();
        this.initializeCustomSelects();
    }

    initializeElements() {
        // Mode tabs
        this.singleModeTab = document.getElementById('singleModeTab');
        this.batchModeTab = document.getElementById('batchModeTab');
        this.singleModeContent = document.getElementById('singleModeContent');
        this.batchModeContent = document.getElementById('batchModeContent');

        // Batch form elements
        this.batchForm = document.getElementById('batchForm');
        this.batchItems = document.getElementById('batchItems');
        this.batchCount = document.getElementById('batchCount');
        this.runBatchCount = document.getElementById('runBatchCount');

        // Batch buttons
        this.addToBatchBtn = document.getElementById('addToBatchBtn');
        this.runBatchBtn = document.getElementById('runBatchBtn');
        this.clearAllBatchBtn = document.getElementById('clearAllBatch');

        // Progress elements
        this.batchProgressContainer = document.getElementById('batchProgressContainer');
        this.batchProgressItems = document.getElementById('batchProgressItems');
        this.batchProgressCurrent = document.getElementById('batchProgressCurrent');
        this.batchProgressTotal = document.getElementById('batchProgressTotal');
    }

    attachEventListeners() {
        // Tab switching
        this.singleModeTab.addEventListener('click', () => this.switchMode('single'));
        this.batchModeTab.addEventListener('click', () => this.switchMode('batch'));

        // Batch actions
        this.addToBatchBtn.addEventListener('click', () => this.addToBatch());
        this.runBatchBtn.addEventListener('click', () => this.runBatch());
        this.clearAllBatchBtn.addEventListener('click', () => this.clearAll());

        // Form submission prevention
        this.batchForm.addEventListener('submit', (e) => e.preventDefault());
    }

    initializeCustomSelects() {
        // Batch Data Group Select
        const batchDataGroupSelect = document.getElementById('batchDataGroupSelect');
        const batchDataGroupItems = document.getElementById('batchDataGroupItems');
        const batchDataGroupHidden = document.getElementById('batchDataGroup');

        if (batchDataGroupSelect && batchDataGroupItems) {
            batchDataGroupSelect.addEventListener('click', (e) => {
                e.stopPropagation();
                batchDataGroupItems.classList.toggle('show');
                batchDataGroupSelect.classList.toggle('select-arrow-active');
            });

            batchDataGroupItems.querySelectorAll('div').forEach(item => {
                item.addEventListener('click', () => {
                    const value = item.getAttribute('data-value');
                    const label = item.textContent.trim();

                    batchDataGroupHidden.value = value;
                    batchDataGroupSelect.textContent = label;
                    batchDataGroupSelect.style.color = '#e8e8e8';

                    batchDataGroupItems.classList.remove('show');
                    batchDataGroupSelect.classList.remove('select-arrow-active');

                    // Load projects when data group is selected
                    this.loadBatchProjects(value);
                });
            });
        }

        // Batch Environment Select
        const batchEnvironmentSelect = document.getElementById('batchEnvironmentSelect');
        const batchEnvironmentItems = document.getElementById('batchEnvironmentItems');
        const batchEnvironmentHidden = document.getElementById('batchEnvironment');

        if (batchEnvironmentSelect && batchEnvironmentItems) {
            batchEnvironmentSelect.addEventListener('click', (e) => {
                e.stopPropagation();
                batchEnvironmentItems.classList.toggle('show');
                batchEnvironmentSelect.classList.toggle('select-arrow-active');
            });

            batchEnvironmentItems.querySelectorAll('div').forEach(item => {
                item.addEventListener('click', () => {
                    const value = item.getAttribute('data-value');
                    const label = item.textContent.trim();

                    batchEnvironmentHidden.value = value;
                    batchEnvironmentSelect.textContent = label;
                    batchEnvironmentSelect.style.color = '#e8e8e8';

                    batchEnvironmentItems.classList.remove('show');
                    batchEnvironmentSelect.classList.remove('select-arrow-active');
                });
            });
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-menu.show').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
            document.querySelectorAll('.select-arrow-active').forEach(select => {
                select.classList.remove('select-arrow-active');
            });
        });
    }

    switchMode(mode) {
        if (mode === 'single') {
            this.singleModeTab.classList.add('active');
            this.batchModeTab.classList.remove('active');
            this.singleModeContent.style.display = 'block';
            this.batchModeContent.style.display = 'none';
        } else {
            this.singleModeTab.classList.remove('active');
            this.batchModeTab.classList.add('active');
            this.singleModeContent.style.display = 'none';
            this.batchModeContent.style.display = 'block';
        }
    }

    validateBatchForm() {
        const demoName = document.getElementById('batchDemoName').value.trim();
        const companyName = document.getElementById('batchCompanyName').value.trim();
        const email = document.getElementById('batchEmail').value.trim();
        const password = document.getElementById('batchPassword').value.trim();
        const emailDomain = document.getElementById('batchEmailDomain').value.trim();
        const dataGroup = document.getElementById('batchDataGroup').value;
        const environment = document.getElementById('batchEnvironment').value;
        const selectedProjects = this.getSelectedBatchProjects();

        const errors = [];

        if (!demoName) errors.push('Demo Name is required');
        if (!companyName) errors.push('Company Name is required');
        if (!email) errors.push('Email is required');
        else if (!email.includes('@yopmail.com')) errors.push('Email must be @yopmail.com');
        if (!password) errors.push('Password is required');
        if (!emailDomain) errors.push('Email Domain is required');
        if (!dataGroup) errors.push('Data selection is required');
        if (selectedProjects.length === 0) errors.push('At least one project must be selected');
        if (!environment) errors.push('Environment selection is required');

        if (errors.length > 0) {
            alert(errors.join('\n'));
            return false;
        }

        return true;
    }

    addToBatch() {
        if (!this.validateBatchForm()) return;

        const workPackages = document.querySelector('input[name="batchWorkPackages"]:checked').value;
        const selectedProjects = this.getSelectedBatchProjects();

        const demo = {
            id: Date.now(),
            name: document.getElementById('batchDemoName').value.trim(),
            companyName: document.getElementById('batchCompanyName').value.trim(),
            email: document.getElementById('batchEmail').value.trim(),
            password: document.getElementById('batchPassword').value.trim(),
            emailDomain: document.getElementById('batchEmailDomain').value.trim(),
            dataGroup: document.getElementById('batchDataGroup').value,
            dataGroupLabel: document.getElementById('batchDataGroupSelect').textContent.trim(),
            environment: document.getElementById('batchEnvironment').value,
            workPackages: workPackages === 'yes',
            selectedProjects: selectedProjects
        };

        this.batchQueue.push(demo);
        this.renderBatchQueue();
        this.clearBatchForm();
        this.updateButtons();
    }

    loadBatchProjects(dataGroup) {
        const projectSelectionBox = document.getElementById('batchProjectSelectionBox');
        const projectList = document.getElementById('batchProjectList');
        const selectAllCheckbox = document.getElementById('batchSelectAllProjects');

        if (!projectSelectionBox || !projectList) return;

        // Show loading
        projectList.innerHTML = '<div class="loading-projects">Loading projects...</div>';
        projectSelectionBox.style.display = 'block';

        // Fetch projects from server
        fetch(`/api/projects/${dataGroup}`)
            .then(response => response.json())
            .then(projects => {
                if (projects.length === 0) {
                    projectList.innerHTML = '<div class="loading-projects">No projects available</div>';
                    return;
                }

                projectList.innerHTML = projects.map(project => `
                    <label class="project-checkbox">
                        <input type="checkbox" class="batch-project-checkbox" value="${project.value}" data-title="${project.title}">
                        <span>${project.title}</span>
                    </label>
                `).join('');

                // Setup select all checkbox
                selectAllCheckbox.checked = false;
                selectAllCheckbox.addEventListener('change', (e) => {
                    const checkboxes = projectList.querySelectorAll('.batch-project-checkbox');
                    checkboxes.forEach(cb => cb.checked = e.target.checked);
                });

                // Update select all when individual checkboxes change
                projectList.querySelectorAll('.batch-project-checkbox').forEach(cb => {
                    cb.addEventListener('change', () => {
                        const allCheckboxes = projectList.querySelectorAll('.batch-project-checkbox');
                        const allChecked = Array.from(allCheckboxes).every(checkbox => checkbox.checked);
                        selectAllCheckbox.checked = allChecked;
                    });
                });
            })
            .catch(error => {
                console.error('Failed to load projects:', error);
                projectList.innerHTML = '<div class="loading-projects">Failed to load projects</div>';
            });
    }

    getSelectedBatchProjects() {
        const projectList = document.getElementById('batchProjectList');
        if (!projectList) return [];

        const checkboxes = projectList.querySelectorAll('.batch-project-checkbox:checked');
        return Array.from(checkboxes).map(cb => ({
            value: cb.value,
            title: cb.getAttribute('data-title')
        }));
    }

    clearBatchForm() {
        document.getElementById('batchDemoName').value = '';
        document.getElementById('batchCompanyName').value = '';
        document.getElementById('batchEmail').value = '';
        document.getElementById('batchPassword').value = '';
        document.getElementById('batchEmailDomain').value = '';
        document.getElementById('batchDataGroup').value = '';
        document.getElementById('batchDataGroupSelect').textContent = 'Please select data';
        document.getElementById('batchDataGroupSelect').style.color = '#6b7280';
        document.getElementById('batchEnvironment').value = '';
        document.getElementById('batchEnvironmentSelect').textContent = 'Please select environment';
        document.getElementById('batchEnvironmentSelect').style.color = '#6b7280';

        // Clear project selection
        const projectSelectionBox = document.getElementById('batchProjectSelectionBox');
        if (projectSelectionBox) {
            projectSelectionBox.style.display = 'none';
        }
        const selectAllCheckbox = document.getElementById('batchSelectAllProjects');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
        }
    }

    renderBatchQueue() {
        if (this.batchQueue.length === 0) {
            this.batchItems.innerHTML = '<div class="empty-batch-message">No demos added yet. Use the form below to add your first demo.</div>';
            this.batchCount.textContent = '0';
            return;
        }

        this.batchItems.innerHTML = this.batchQueue.map(demo => `
            <div class="batch-item" data-id="${demo.id}">
                <div class="batch-item-icon">
                    <i class="fa-solid fa-sparkles"></i>
                </div>
                <div class="batch-item-info">
                    <div class="batch-item-name">${demo.name}</div>
                    <div class="batch-item-details">
                        <span class="batch-item-detail">
                            <i class="fa-solid fa-building"></i>
                            ${demo.companyName}
                        </span>
                        <span class="batch-item-detail">
                            <i class="fa-solid fa-envelope"></i>
                            ${demo.email}
                        </span>
                        <span class="batch-item-detail">
                            <i class="fa-solid fa-database"></i>
                            ${demo.dataGroupLabel}
                        </span>
                        <span class="batch-item-detail">
                            <i class="fa-solid fa-folder"></i>
                            ${demo.selectedProjects ? demo.selectedProjects.length : 0} projects
                        </span>
                    </div>
                </div>
                <div class="batch-item-actions">
                    <button class="batch-item-btn delete" onclick="batchModeHandler.removeFromBatch(${demo.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        this.batchCount.textContent = this.batchQueue.length;
        this.runBatchCount.textContent = this.batchQueue.length;
    }

    removeFromBatch(id) {
        this.batchQueue = this.batchQueue.filter(demo => demo.id !== id);
        this.renderBatchQueue();
        this.updateButtons();
    }

    clearAll() {
        if (!confirm('Are you sure you want to clear all demos from the queue?')) return;

        this.batchQueue = [];
        this.renderBatchQueue();
        this.updateButtons();
    }

    updateButtons() {
        if (this.batchQueue.length > 0) {
            this.runBatchBtn.style.display = 'block';
            this.clearAllBatchBtn.style.display = 'block';
        } else {
            this.runBatchBtn.style.display = 'none';
            this.clearAllBatchBtn.style.display = 'none';
        }
    }

    async runBatch() {
        if (this.batchQueue.length === 0) {
            alert('No demos in queue!');
            return;
        }

        if (this.isRunning) {
            alert('Batch is already running!');
            return;
        }

        if (!confirm(`Start batch creation of ${this.batchQueue.length} demos?\n\nThis will run sequentially and may take a while.`)) {
            return;
        }

        this.isRunning = true;
        this.currentIndex = 0;

        // Hide batch form, show progress
        this.batchForm.style.display = 'none';
        document.getElementById('batchDemosList').style.display = 'none';
        this.runBatchBtn.style.display = 'none';
        this.batchProgressContainer.style.display = 'block';

        // Initialize progress items
        this.initializeBatchProgress();

        // Run demos sequentially
        for (let i = 0; i < this.batchQueue.length; i++) {
            this.currentIndex = i;
            this.batchProgressCurrent.textContent = i + 1;

            await this.runSingleDemo(this.batchQueue[i], i);

            // Wait 3 seconds between demos
            if (i < this.batchQueue.length - 1) {
                await this.sleep(3000);
            }
        }

        // Batch complete
        this.isRunning = false;
        alert('Batch creation complete!');

        // Reset
        this.batchQueue = [];
        this.renderBatchQueue();
        this.updateButtons();

        // Show form again
        this.batchForm.style.display = 'block';
        document.getElementById('batchDemosList').style.display = 'block';
        this.batchProgressContainer.style.display = 'none';
    }

    initializeBatchProgress() {
        this.batchProgressTotal.textContent = this.batchQueue.length;
        this.batchProgressCurrent.textContent = '0';

        this.batchProgressItems.innerHTML = this.batchQueue.map((demo, index) => `
            <div class="batch-progress-item pending" id="batchProgress${index}">
                <div class="batch-progress-item-header">
                    <div class="batch-progress-status">
                        <i class="fa-solid fa-clock"></i>
                    </div>
                    <div class="batch-progress-info">
                        <div class="batch-progress-name">${demo.name}</div>
                        <div class="batch-progress-message">Waiting...</div>
                    </div>
                </div>
                <div class="batch-progress-bar">
                    <div class="batch-progress-bar-fill" style="width: 0%"></div>
                </div>
            </div>
        `).join('');
    }

    async runSingleDemo(demo, index) {
        const progressItem = document.getElementById(`batchProgress${index}`);
        const progressStatus = progressItem.querySelector('.batch-progress-status');
        const progressMessage = progressItem.querySelector('.batch-progress-message');
        const progressBarFill = progressItem.querySelector('.batch-progress-bar-fill');

        try {
            // Update to running
            progressItem.classList.remove('pending');
            progressItem.classList.add('running');
            progressStatus.innerHTML = '<i class="fa-solid fa-spinner"></i>';
            progressMessage.textContent = 'Creating demo...';

            // Emit demo creation request
            return new Promise((resolve, reject) => {
                const sessionId = `batch-${demo.id}`;

                this.socket.emit('create-demo', {
                    organizationName: demo.companyName,
                    email: demo.email,
                    password: demo.password,
                    emailDomain: demo.emailDomain,
                    dataGroup: demo.dataGroup,
                    selectedProjects: demo.selectedProjects || [],
                    environment: demo.environment,
                    workPackages: demo.workPackages,
                    mode: 'bulk',
                    sessionId
                });

                // Listen for progress
                const progressHandler = (data) => {
                    if (data.sessionId === sessionId) {
                        progressMessage.textContent = data.message;

                        // Estimate progress (rough)
                        const progress = Math.min(90, (data.step || 0) * 10);
                        progressBarFill.style.width = `${progress}%`;
                    }
                };

                const completeHandler = (data) => {
                    if (data.sessionId === sessionId) {
                        // Update to completed
                        progressItem.classList.remove('running');
                        progressItem.classList.add('completed');
                        progressStatus.innerHTML = '<i class="fa-solid fa-check"></i>';
                        progressMessage.textContent = 'Completed successfully!';
                        progressBarFill.style.width = '100%';

                        // Cleanup listeners
                        this.socket.off('demo-progress', progressHandler);
                        this.socket.off('demo-complete', completeHandler);
                        this.socket.off('demo-error', errorHandler);

                        resolve();
                    }
                };

                const errorHandler = (data) => {
                    if (data.sessionId === sessionId) {
                        // Update to failed
                        progressItem.classList.remove('running');
                        progressItem.classList.add('failed');
                        progressStatus.innerHTML = '<i class="fa-solid fa-times"></i>';
                        progressMessage.textContent = `Failed: ${data.error}`;
                        progressBarFill.style.width = '100%';

                        // Cleanup listeners
                        this.socket.off('demo-progress', progressHandler);
                        this.socket.off('demo-complete', completeHandler);
                        this.socket.off('demo-error', errorHandler);

                        resolve(); // Don't reject, continue with next demo
                    }
                };

                this.socket.on('demo-progress', progressHandler);
                this.socket.on('demo-complete', completeHandler);
                this.socket.on('demo-error', errorHandler);

                // Timeout after 15 minutes
                setTimeout(() => {
                    progressItem.classList.remove('running');
                    progressItem.classList.add('failed');
                    progressStatus.innerHTML = '<i class="fa-solid fa-times"></i>';
                    progressMessage.textContent = 'Timeout after 15 minutes';

                    this.socket.off('demo-progress', progressHandler);
                    this.socket.off('demo-complete', completeHandler);
                    this.socket.off('demo-error', errorHandler);

                    resolve();
                }, 15 * 60 * 1000);
            });
        } catch (error) {
            console.error('Demo creation error:', error);

            progressItem.classList.remove('running');
            progressItem.classList.add('failed');
            progressStatus.innerHTML = '<i class="fa-solid fa-times"></i>';
            progressMessage.textContent = `Error: ${error.message}`;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof io !== 'undefined' && typeof socket !== 'undefined') {
        window.batchModeHandler = new BatchModeHandler(socket);
    }
});
