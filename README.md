# Demo Account Creator

A TypeScript application for automated creation and population of demo accounts for Clusterix HR system.

## Overview

This tool automates the setup of complete demo environments by creating organizational structures, employee records, projects, and related data. It supports multiple languages and environments (testing/production), and can be customized through CSV data files.

## Features

- **Multi-environment support** (Testing/Production)
- **Multi-language support** (English/German)
- **Automated employee and user creation**
- **Project and milestone management**
- **Work package scheduling with time periods**
- **Department and team hierarchy creation**
- **Employee contract and salary management**
- **Avatar upload support**
- **Web-based UI** with step-by-step or bulk execution modes
- **Type-safe codebase** with comprehensive error handling

## Prerequisites

- Node.js 18+
- npm or yarn
- **Redis** (required for job queue management)
- Access to Clusterix API endpoints

## Installation

1. Clone the repository

2. Install dependencies:
```bash
npm install
```

3. **Start Redis** (required for the application to work):
```bash
# macOS (using Homebrew)
brew services start redis

# Or start manually in background
redis-server --daemonize yes

# Verify Redis is running
redis-cli ping
# Should return: PONG
```

4. Configure environment variables:
```bash
cp .env.example .env
```

5. Update `.env` with your credentials:

**Option 1: Multi-Environment Setup (Recommended)**
```env
# Testing Environment
TESTING_EMAIL=your-testing-email@example.com
TESTING_PASSWORD=YourTestingPassword123!
TESTING_LOGIN_URL=https://api-testing.innoscripta.com/auth/login
TESTING_API_BASE_URL=https://api-testing.innoscripta.com
TESTING_HR_API_BASE_URL=https://innos-hr-backend-testing.innoscripta.com
TESTING_TASK_MANAGEMENT_API_BASE_URL=https://task-management-backend-testing.innoscripta.com
TESTING_IMS_CUSTOMERS_API_BASE_URL=https://ims-customers-testing.innoscripta.com

# Production Environment
PROD_EMAIL=your-prod-email@example.com
PROD_PASSWORD=YourProdPassword123!
PROD_LOGIN_URL=https://api.innoscripta.com/auth/login
PROD_API_BASE_URL=https://api.innoscripta.com
PROD_HR_API_BASE_URL=https://innos-hr-backend.innoscripta.com
PROD_TASK_MANAGEMENT_API_BASE_URL=https://task-management-backend.innoscripta.com
PROD_IMS_CUSTOMERS_API_BASE_URL=https://ims-customers.innoscripta.com
```

**Option 2: Legacy Setup (Still Supported)**
```env
LOGIN_URL=https://api.innoscripta.com/auth/login
EMAIL=your-email@example.com
PASSWORD=your-password

API_BASE_URL=https://api.innoscripta.com
HR_API_BASE_URL=https://innos-hr-backend.innoscripta.com
TASK_MANAGEMENT_API_BASE_URL=https://task-management-backend.innoscripta.com
IMS_CUSTOMERS_API_BASE_URL=https://ims-customers.innoscripta.com
```

> **Note:** If using the legacy setup, you'll see a warning message suggesting to migrate to the new environment-based format.

## Usage

### Web Interface (Recommended)

1. **Make sure Redis is running** (see Installation step 3)

2. Start the web UI:
```bash
npm run ui
```

3. Open http://localhost:3000 in your browser

**Features:**
- **Environment Selection:** Choose between Testing or Production
- **Two Execution Modes:**
  - **Bulk Mode:** Runs all steps automatically
  - **Step-by-Step Mode:** Control each step manually with detailed logs
- **Real-time Progress:** Live logs and progress tracking
- **Visual Feedback:** Animated UI with status indicators

### Command Line

Run directly from terminal:
```bash
npm run dev <data-group> <email-domain> [environment]
```

**Parameters:**
- `data-group`: Data folder name (e.g., `data-en`, `data-de`)
- `email-domain`: Email domain for employees (e.g., `company-demo.com`)
- `environment`: Optional. Either `testing` or `production` (defaults to `testing`)

**Examples:**
```bash
# Using testing environment (default)
npm run dev data-en company-demo.com

# Explicitly specify testing
npm run dev data-en company-demo.com testing

# Use production environment
npm run dev data-en company-demo.com production
```

## Data Structure

### Data Groups

Organize your data in language-specific folders:
- `data/data-en/` - English data
- `data/data-de/` - German data

### CSV Files

Each data group contains:

| File | Description |
|------|-------------|
| `qualification-groups.csv` | Educational qualification categories |
| `occupation-groups.csv` | Job role categories |
| `occupations.csv` | Specific job positions |
| `titles.csv` | Academic/professional titles |
| `employees.csv` | Employee master data |
| `employee-details.csv` | Additional employee information |
| `employee-contracts.csv` | Contract details |
| `employee-salaries.csv` | Salary information |
| `offices.csv` | Office locations |
| `legal-requirements.csv` | Compliance requirements |
| `departments.csv` | Department structure |
| `teams.csv` | Team assignments |
| `c-level.csv` | Executive assignments |
| `projects.csv` | R&D projects |
| `milestones.csv` | Project milestones |
| `work-packages.csv` | Detailed work items |
| `avatar-mappings.csv` | Avatar assignments |

## Execution Flow

The application follows this sequence:

1. **Authentication** - Login and obtain access token
2. **Organization Setup** - Fetch organization ID for API requests
3. **Data Cleanup** - Remove default system data
4. **Reference Data** - Create qualification groups, occupation groups, occupations, and titles
5. **Settings** - Configure system defaults
6. **Locations** - Set up offices
7. **Legal** - Create legal requirements
8. **HR Reference** - Fetch and cache HR metadata
9. **Employees** - Create employee records and user accounts
10. **Employee Details** - Update with additional information
11. **Contracts** - Assign employment contracts
12. **Avatars** - Upload employee photos
13. **Compensation** - Set up salary records
14. **Time Off** - Create vacation and sick day records
15. **Organization** - Build department and team structure
16. **Projects** - Create projects, milestones, and work packages

## API Integration

The tool integrates with multiple Clusterix API endpoints:

- **Auth API** - User authentication and settings
- **HR API** - Employee and organizational management
- **Task Management API** - Legal compliance tracking
- **IMS Customers API** - Project and customer data

All endpoints are configurable via environment variables.

## Project Structure

```
demo-creator/
├── src/
│   ├── operations/          # Business logic modules
│   │   ├── base-operation.ts    # Base class with common functionality
│   │   ├── employees.ts         # Employee creation and management
│   │   ├── departments.ts       # Department operations
│   │   └── ...                  # Other operation modules
│   ├── utils/              # Helper utilities
│   │   └── iban-generator.ts    # IBAN generation
│   ├── auth.ts             # Authentication service
│   ├── api-client.ts       # HTTP client with error handling
│   ├── config.ts           # Configuration (supports legacy + new format)
│   ├── environment.ts      # Environment management (NEW)
│   ├── types.ts            # TypeScript type definitions
│   ├── constants.ts        # Application constants (NEW)
│   ├── csv-loader.ts       # CSV file parser
│   ├── index.ts            # CLI entry point
│   └── ui-server.ts        # Web UI server
├── data/
│   ├── data-en/            # English data files
│   ├── data-de/            # German data files
│   ├── avatars/            # Employee photos
│   └── cache/              # Runtime cache (auto-generated, git-ignored)
├── public/                 # Web UI assets
│   ├── js/                 # JavaScript files
│   └── css/                # Stylesheets
├── views/                  # EJS templates
│   └── index.ejs           # Main UI template
└── .env                    # Environment configuration (git-ignored)
```

## Development

### Prerequisites for Development
Make sure Redis is running before starting development:
```bash
redis-server --daemonize yes
```

Build the project:
```bash
npm run build
```

Run in development mode:
```bash
npm run dev
```

Start web interface:
```bash
npm run ui
```

### Common Issues

**"No logs appearing in UI"**
- Make sure Redis is running: `redis-cli ping` should return `PONG`
- Check browser console for JavaScript errors
- Verify the server started successfully

**"Connection refused" errors**
- Start Redis: `redis-server --daemonize yes`
- Restart the application

## Deployment

### Git Branching Strategy

The project uses two main branches:
- **`development`** - Active development branch, deployed to development environment
- **`main`** - Production-ready branch, deployed to production environment

### Deployment Workflow

**1. Development Deployment (development branch → dev server):**
```bash
# Make sure you're on development branch
git checkout development

# Deploy to development server
./deploy-dev.sh
```

**2. Production Deployment (main branch → prod server):**
```bash
# Merge development to main
git checkout main
git merge development
git push origin main

# Deploy to production server
./deploy-prod.sh
```

### Server Deployment

The application is deployed on the company server at `10.30.1.201:3000` (VPN access required).

**Deployment Scripts:**

Each script automatically:
1. Verifies you're on the correct branch
2. Builds TypeScript code
3. Packages necessary files
4. Uploads to server via SCP
5. Extracts files and restarts PM2 process
6. Cleans up temporary files

**Prerequisites:**
- VPN connection to company network
- SSH access configured for `ubuntu@10.30.1.201`
- Server already set up with Node.js, PM2, and initial deployment

**Manual Deployment:**

If you need to deploy manually:

```bash
# 1. Build the project
npm run build

# 2. Create deployment package
tar -czf demo-creator-update.tar.gz dist/ public/ views/ data/ package.json package-lock.json .env.example

# 3. Upload to server
scp demo-creator-update.tar.gz ubuntu@10.30.1.201:~/

# 4. SSH to server and extract
ssh ubuntu@10.30.1.201
cd ~/demo-creator
tar -xzf ~/demo-creator-update.tar.gz
pm2 restart demo-creator
rm ~/demo-creator-update.tar.gz
```

**Viewing Server Logs:**
```bash
ssh ubuntu@10.30.1.201
pm2 logs demo-creator
```

**Server Status:**
```bash
ssh ubuntu@10.30.1.201
pm2 status
```

## Cache Management

The application caches reference data in `data/cache/` to improve performance:
- `location-ids.json` - Country/city/state mappings
- `reference-data.json` - Titles, occupations, groups
- `hr-reference-data.json` - HR system metadata
- `employee-mappings.json` - Created employee IDs
- `department-mappings.json` - Created department IDs
- `office-mappings.json` - Created office IDs
- `day-off-types.json` - Day-off type mappings
- `organization-id.json` - Organization/Partner ID

This cache is automatically managed and excluded from version control.

## Environment System

The application supports multiple environments with different configurations:

### Environment Types
- **Testing:** For development and testing purposes
- **Production:** For production deployments

### Environment Configuration
Each environment can have its own:
- Authentication credentials (email/password)
- API base URLs (if different from defaults)
- Login endpoints

### Environment Selection

**Via Web UI:**
- Select from the "Environment" dropdown
- Defaults to Testing

**Via CLI:**
- Pass as third argument: `npm run dev data-en company.com testing`
- Omit for default (testing): `npm run dev data-en company.com`

**Via .env File:**
```env
# Both environments can be configured
TESTING_EMAIL=...
TESTING_PASSWORD=...
PROD_EMAIL=...
PROD_PASSWORD=...
```

### Backward Compatibility
The legacy single-environment `.env` format is still supported:
```env
LOGIN_URL=...
EMAIL=...
PASSWORD=...
```

When detected, the system will show a migration warning but continue to work normally.

## Error Handling

The application features robust error handling:

- **Type-safe operations** with TypeScript strict mode
- **Custom error classes:**
  - `ApiError` - API request failures with status codes
  - `AuthError` - Authentication failures
  - `CsvLoadError` - CSV parsing errors with line numbers
- **Graceful degradation** - Failed operations log errors but don't halt execution
- **Detailed error messages** for debugging
- **Automatic retry logic** where applicable

## Code Quality

The codebase follows modern TypeScript best practices:

- **Type Safety:** Strict TypeScript with comprehensive type definitions
- **Code Organization:**
  - Base classes to reduce duplication
  - Centralized constants
  - Modular operation classes
- **Error Handling:** Custom error types with context
- **Maintainability:**
  - Clear separation of concerns
  - Comprehensive inline documentation
  - Consistent naming conventions

## Recent Improvements

- ✅ Multi-environment support (Testing/Production)
- ✅ Improved type safety with strict TypeScript
- ✅ Custom error classes for better error handling
- ✅ BaseOperation class to reduce code duplication
- ✅ Centralized constants management
- ✅ Enhanced CSV loader with better error messages
- ✅ Backward compatibility with legacy configuration

## License

Proprietary - Internal use only
