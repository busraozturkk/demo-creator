import * as fs from 'fs';
import * as path from 'path';

interface WorkPackage {
  project_short_title: string;
  milestone_title: string;
  work_package_title: string;
}

interface Project {
  type_id: string;
  short_title: string;
  title: string;
  started_at: string;
  finished_at: string;
  description?: string;
  scope?: string;
}

const TASK_TYPES = ['Task', 'Bug', 'Feature', 'Documentation'];

// Project descriptions and scopes for context
const PROJECT_CONTEXTS: { [key: string]: { description: string, scope: string } } = {
  'AI Assistant': {
    description: 'Advanced AI-Powered Customer Service Assistant',
    scope: 'Natural language processing, machine learning models, customer support automation, multi-turn conversations, sentiment analysis'
  },
  'Smart Analytics': {
    description: 'Real-time Data Analytics and Visualization Platform',
    scope: 'Data processing pipelines, interactive dashboards, real-time streaming, business intelligence, data warehousing'
  },
  'IoT Security': {
    description: 'IoT Device Security and Management System',
    scope: 'Device authentication, encryption, security protocols, vulnerability management, access control, monitoring'
  },
  'Cloud Migration': {
    description: 'Enterprise Cloud Infrastructure Migration Framework',
    scope: 'Infrastructure assessment, cloud architecture, data migration, application modernization, cost optimization'
  },
  'ML Pipeline': {
    description: 'Automated Machine Learning Pipeline for Predictive Analytics',
    scope: 'Data preprocessing, feature engineering, model training, hyperparameter tuning, deployment automation, monitoring'
  },
  'Blockchain ID': {
    description: 'Blockchain-based Digital Identity Verification System',
    scope: 'Smart contracts, identity schema, cryptographic verification, decentralized storage, privacy preservation'
  },
  'Edge Computing': {
    description: 'Edge Computing Platform for Industrial IoT Applications',
    scope: 'Distributed computing, low-latency processing, device management, data synchronization, offline capabilities'
  },
  'Green Energy': {
    description: 'AI-Driven Energy Optimization for Smart Buildings',
    scope: 'IoT sensors, energy prediction models, optimization algorithms, building automation, consumption analytics'
  }
};

// German translations
const PROJECT_CONTEXTS_DE: { [key: string]: { description: string, scope: string } } = {
  'KI-Assistent': {
    description: 'Fortgeschrittener KI-gesteuerter Kundenservice-Assistent',
    scope: 'Natürliche Sprachverarbeitung, Machine-Learning-Modelle, Kundensupport-Automatisierung, mehrstufige Konversationen, Sentimentanalyse'
  },
  'Smart Analytics': {
    description: 'Echtzeit-Datenanalyse- und Visualisierungsplattform',
    scope: 'Datenverarbeitungs-Pipelines, interaktive Dashboards, Echtzeit-Streaming, Business Intelligence, Data Warehousing'
  },
  'IoT-Sicherheit': {
    description: 'IoT-Gerätesicherheits- und Verwaltungssystem',
    scope: 'Geräteauthentifizierung, Verschlüsselung, Sicherheitsprotokolle, Schwachstellenmanagement, Zugriffskontrolle, Überwachung'
  },
  'Cloud-Migration': {
    description: 'Enterprise-Cloud-Infrastruktur-Migrationsframework',
    scope: 'Infrastrukturbewertung, Cloud-Architektur, Datenmigration, Anwendungsmodernisierung, Kostenoptimierung'
  },
  'ML-Pipeline': {
    description: 'Automatisierte Machine-Learning-Pipeline für prädiktive Analytik',
    scope: 'Datenvorverarbeitung, Feature-Engineering, Modelltraining, Hyperparameter-Tuning, Bereitstellungsautomatisierung, Überwachung'
  },
  'Blockchain-ID': {
    description: 'Blockchain-basiertes digitales Identitätsverifizierungssystem',
    scope: 'Smart Contracts, Identitätsschema, kryptografische Verifizierung, dezentrale Speicherung, Datenschutz'
  },
  'Edge Computing': {
    description: 'Edge-Computing-Plattform für industrielle IoT-Anwendungen',
    scope: 'Verteiltes Computing, Verarbeitung mit niedriger Latenz, Geräteverwaltung, Datensynchronisierung, Offline-Funktionen'
  },
  'Grüne Energie': {
    description: 'KI-gesteuerte Energieoptimierung für intelligente Gebäude',
    scope: 'IoT-Sensoren, Energievorhersagemodelle, Optimierungsalgorithmen, Gebäudeautomatisierung, Verbrauchsanalytik'
  }
};

function generateTaskTitle(wpTitle: string, index: number, isGerman: boolean): string {
  const verbs = isGerman ?
    ['Implementieren', 'Entwickeln', 'Erstellen', 'Testen', 'Überprüfen', 'Optimieren', 'Dokumentieren', 'Analysieren', 'Validieren', 'Konfigurieren'] :
    ['Implement', 'Develop', 'Create', 'Test', 'Review', 'Optimize', 'Document', 'Analyze', 'Validate', 'Configure'];

  const nouns = isGerman ?
    ['Komponente', 'Modul', 'Schnittstelle', 'Service', 'System', 'Framework', 'Mechanismus', 'Prozess', 'Funktion', 'Feature'] :
    ['Component', 'Module', 'Interface', 'Service', 'System', 'Framework', 'Mechanism', 'Process', 'Function', 'Feature'];

  const aspects = isGerman ?
    ['für Kernfunktionalität', 'mit Fehlerbehandlung', 'für Leistung', 'mit Validierung', 'für Skalierbarkeit', 'mit Sicherheit', 'für Integration', 'mit Überwachung'] :
    ['for Core Functionality', 'with Error Handling', 'for Performance', 'with Validation', 'for Scalability', 'with Security', 'for Integration', 'with Monitoring'];

  const verb = verbs[index % verbs.length];
  const noun = nouns[index % nouns.length];
  const aspect = aspects[index % aspects.length];

  // Extract key terms from work package title
  const wpWords = wpTitle.split(' ').filter(w => w.length > 4);
  const keyTerm = wpWords[index % wpWords.length] || (isGerman ? 'System' : 'System');

  return `${verb} ${keyTerm} ${noun} ${aspect}`;
}

function generateTaskDescription(
  projectTitle: string,
  wpTitle: string,
  taskTitle: string,
  taskType: string,
  isGerman: boolean
): string {
  const context = isGerman ? PROJECT_CONTEXTS_DE : PROJECT_CONTEXTS;
  const projectContext = context[projectTitle];

  if (!projectContext) {
    return isGerman ?
      `Detaillierte Beschreibung für ${taskTitle} im Rahmen des ${wpTitle}. Diese Aufgabe ist kritisch für den Projekterfolg und erfordert sorgfältige Planung und Ausführung. Es müssen Best Practices befolgt werden.` :
      `Detailed description for ${taskTitle} as part of ${wpTitle}. This task is critical for project success and requires careful planning and execution. Best practices must be followed.`;
  }

  const templates = isGerman ? [
    `Diese Aufgabe konzentriert sich auf ${taskTitle} im Kontext von ${wpTitle} für das Projekt "${projectContext.description}". Der Umfang umfasst ${projectContext.scope}. Die Implementierung erfordert eine gründliche Analyse der Anforderungen, das Design einer skalierbaren Lösung und die Sicherstellung der Integration mit bestehenden Systemen. Besondere Aufmerksamkeit muss auf Leistungsoptimierung, Fehlerbehandlung und Sicherheitsaspekte gelegt werden. Es müssen umfassende Tests durchgeführt werden, einschließlich Unit-Tests, Integrationstests und Leistungstests. Die Dokumentation sollte technische Spezifikationen, API-Dokumentation, Benutzerhandbücher und Wartungsanleitungen umfassen. Alle Arbeiten müssen den Unternehmensstandards entsprechen und Best Practices der Branche folgen. Regelmäßige Fortschrittsaktualisierungen und Stakeholder-Kommunikation sind während der gesamten Implementierung erforderlich. Qualitätssicherungsverfahren müssen strikt befolgt werden, um hohe Codequalität und Zuverlässigkeit sicherzustellen. Die Lösung muss für zukünftiges Wachstum und sich ändernde Anforderungen skalierbar sein. Sicherheits- und Datenschutzüberlegungen müssen in allen Aspekten des Designs und der Implementierung behandelt werden. Die endgültige Lösung erfordert eine gründliche Überprüfung und Genehmigung, bevor sie in die Produktion geht.`,
    `Diese kritische Aufgabe beinhaltet ${taskTitle}, ein wesentlicher Bestandteil von ${wpTitle} im ${projectContext.description}-Projekt. Der technische Umfang umfasst ${projectContext.scope}. Der Implementierungsplan erfordert detailliertes Design, Prototyping und iterative Entwicklung. Besonderer Fokus muss auf Systemarchitektur, Datenmodellierung und API-Design gelegt werden. Leistungsanforderungen müssen definiert und validiert werden durch umfassendes Benchmarking. Sicherheitsmaßnahmen, einschließlich Authentifizierung, Autorisierung und Verschlüsselung, müssen implementiert werden. Fehlerbehandlungsstrategien müssen robust sein und graceful degradation unterstützen. Monitoring und Logging-Funktionen müssen für Produktionssupport integriert werden. Code-Reviews und Qualitätsprüfungen sind während des gesamten Entwicklungszyklus obligatorisch. Automatisierte Tests müssen eine hohe Abdeckung erreichen und als Teil der CI/CD-Pipeline ausgeführt werden. Die Lösung muss Cloud-nativ sein und moderne Architekturmuster nutzen. Skalierbarkeit sowohl vertikal als auch horizontal muss berücksichtigt werden. Disaster Recovery und Business Continuity-Pläne müssen dokumentiert werden. Die Implementierung muss internationalisierungs- und lokalisierungsfreundlich sein.`,
    `Die Aufgabe ${taskTitle} ist ein fundamentaler Aspekt von ${wpTitle} für das Projekt "${projectContext.description}". Technisch umfasst dies ${projectContext.scope}. Die Entwicklung erfordert moderne Technologien und bewährte Softwareentwicklungspraktiken. Architektonische Entscheidungen müssen Wartbarkeit, Skalierbarkeit und Leistung priorisieren. Umfassende Anforderungsanalyse muss durchgeführt werden, um alle Funktions- und Nicht-Funktionsanforderungen zu erfassen. Das Design sollte Modularität und Wiederverwendbarkeit fördern, um zukünftige Erweiterungen zu ermöglichen. Implementierungsstandards müssen strikte Kodierungskonventionen und Best Practices befolgen. Kontinuierliche Integration und Deployment-Pipelines müssen eingerichtet werden. Sicherheitsbewertungen und Penetrationstests sollten während der Entwicklung durchgeführt werden. Leistungsprofilierung und Optimierung sind kritisch für Produktionsbereitschaft. Datenmigrations- und Rollback-Strategien müssen geplant und getestet werden. Umfangreiche Dokumentation, einschließlich Architektur-Diagrammen und Ablaufdiagrammen, ist erforderlich. Stakeholder-Demos und Feedback-Sitzungen sollten in regelmäßigen Abständen geplant werden. Die endgültige Implementierung erfordert Benutzerakzeptanztests und Produktionsvalidierung.`
  ] : [
    `This task focuses on ${taskTitle} in the context of ${wpTitle} for the "${projectContext.description}" project. The scope includes ${projectContext.scope}. Implementation requires thorough requirements analysis, designing a scalable solution, and ensuring integration with existing systems. Special attention must be paid to performance optimization, error handling, and security aspects. Comprehensive testing must be conducted including unit tests, integration tests, and performance tests. Documentation should include technical specifications, API documentation, user guides, and maintenance procedures. All work must comply with enterprise standards and follow industry best practices. Regular progress updates and stakeholder communication are required throughout the implementation. Quality assurance procedures must be strictly followed to ensure high code quality and reliability. The solution must be scalable for future growth and changing requirements. Security and privacy considerations must be addressed in all aspects of design and implementation. Final deliverable requires thorough review and approval before production deployment.`,
    `This critical task involves ${taskTitle}, an essential component of ${wpTitle} in the ${projectContext.description} project. The technical scope encompasses ${projectContext.scope}. The implementation plan requires detailed design, prototyping, and iterative development. Particular focus must be placed on system architecture, data modeling, and API design. Performance requirements must be defined and validated through comprehensive benchmarking. Security measures including authentication, authorization, and encryption must be implemented. Error handling strategies must be robust and support graceful degradation. Monitoring and logging capabilities must be integrated for production support. Code reviews and quality gates are mandatory throughout the development cycle. Automated testing must achieve high coverage and run as part of CI/CD pipeline. The solution must be cloud-native and leverage modern architectural patterns. Scalability both vertically and horizontally must be considered. Disaster recovery and business continuity plans must be documented. The implementation must be internationalization and localization-ready.`,
    `The task ${taskTitle} is a fundamental aspect of ${wpTitle} for the "${projectContext.description}" project. Technically, this includes ${projectContext.scope}. Development requires modern technologies and proven software development practices. Architectural decisions must prioritize maintainability, scalability, and performance. Comprehensive requirements analysis must be conducted to capture all functional and non-functional requirements. Design should promote modularity and reusability to enable future extensions. Implementation standards must follow strict coding conventions and best practices. Continuous integration and deployment pipelines must be established. Security assessments and penetration testing should be performed during development. Performance profiling and optimization are critical for production readiness. Data migration and rollback strategies must be planned and tested. Extensive documentation including architecture diagrams and flowcharts is required. Stakeholder demos and feedback sessions should be scheduled at regular intervals. Final implementation requires user acceptance testing and production validation.`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

function loadWorkPackages(filePath: string): WorkPackage[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const workPackages: WorkPackage[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 3) {
      workPackages.push({
        project_short_title: parts[0],
        milestone_title: parts[1],
        work_package_title: parts[2]
      });
    }
  }

  return workPackages;
}

function generateTasksForWorkPackage(
  wp: WorkPackage,
  projectTitle: string,
  isGerman: boolean
): string[] {
  const numTasks = Math.floor(Math.random() * 6) + 5; // 5-10 tasks
  const tasks: string[] = [];

  for (let i = 0; i < numTasks; i++) {
    const taskType = TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)];
    const taskTitle = generateTaskTitle(wp.work_package_title, i, isGerman);
    const taskDescription = generateTaskDescription(
      projectTitle,
      wp.work_package_title,
      taskTitle,
      taskType,
      isGerman
    );

    // Escape CSV special characters
    const escapedWpTitle = `"${wp.work_package_title.replace(/"/g, '""')}"`;
    const escapedTaskTitle = `"${taskTitle.replace(/"/g, '""')}"`;
    const escapedDescription = `"${taskDescription.replace(/"/g, '""')}"`;

    tasks.push(`${escapedWpTitle},${escapedTaskTitle},${escapedDescription},${taskType}`);
  }

  return tasks;
}

function generateTasksCSV(lang: 'en' | 'de') {
  const isGerman = lang === 'de';
  const wpFile = path.join(__dirname, `data/sff-data-${lang}/work-packages.csv`);
  const outputFile = path.join(__dirname, `data/sff-data-${lang}/tasks.csv`);

  console.log(`Generating ${lang.toUpperCase()} tasks from ${wpFile}...`);

  const workPackages = loadWorkPackages(wpFile);
  console.log(`Loaded ${workPackages.length} work packages`);

  const csvLines = ['work_package_title,task_title,task_description,task_type'];

  let totalTasks = 0;
  for (const wp of workPackages) {
    const tasks = generateTasksForWorkPackage(wp, wp.project_short_title, isGerman);
    csvLines.push(...tasks);
    totalTasks += tasks.length;
  }

  fs.writeFileSync(outputFile, csvLines.join('\n'), 'utf-8');
  console.log(`✓ Generated ${totalTasks} tasks to ${outputFile}\n`);
}

// Generate both English and German task files
console.log('=== Task CSV Generator ===\n');
generateTasksCSV('en');
generateTasksCSV('de');
console.log('Done!');
