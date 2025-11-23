import { ApiClient } from '../../api-client';
import { AuthService } from '../../auth';
import { ProjectMapping } from './projects';

interface WorkflowNode {
  id: number;
  name: string;
  workflow_id: number;
  order: number;
  color?: string;
}

interface WorkflowLink {
  id: number;
  source_node_id: number;
  target_node_id: number;
  workflow_id: number;
  forms?: WorkflowForm[];
}

interface WorkflowForm {
  id: number;
  name: string;
  inputs?: FormInput[];
}

interface FormInput {
  id: number;
  name: string;
  type: string;
  required: boolean;
  section_number?: number;
}

interface ProjectType {
  id: number;
  name: string;
  workflow?: {
    id: number;
    nodes: WorkflowNode[];
    links: WorkflowLink[];
  };
}

interface StatusPhase {
  name: string;
  nodes: WorkflowNode[];
}

export class ProjectStatusOperation {
  private apiClient: ApiClient;
  private authService: AuthService;
  private projectTypes: ProjectType[] = [];

  constructor(apiClient: ApiClient, authService: AuthService) {
    this.apiClient = apiClient;
    this.authService = authService;
  }

  /**
   * Fetch project types and their workflows
   */
  async fetchProjectTypes(): Promise<void> {
    console.log('Fetching project types and workflows...');

    const response = await this.apiClient.executeRequest('GET', '/api/projects/types');
    this.projectTypes = response.data || response;

    console.log(`✓ Fetched ${this.projectTypes.length} project types`);
  }

  /**
   * Get workflow for a specific project type
   */
  private getWorkflowForProjectType(projectTypeId: number): ProjectType['workflow'] | null {
    const projectType = this.projectTypes.find(pt => pt.id === projectTypeId);
    return projectType?.workflow || null;
  }

  /**
   * Organize workflow nodes into phases based on naming patterns
   * For SFF (German), the phases are:
   * - PLANUNG (Planning)
   * - IN PRÜFUNG (In Review)
   * - PROJEKT LÄUFT (Project Running)
   * - ABGESCHLOSSEN (Closed)
   */
  private organizeNodesIntoPhases(nodes: WorkflowNode[]): StatusPhase[] {
    // SFF-specific phase detection
    const planungKeywords = ['fragestelle', 'koordination', 'skizze', 'erd'];
    const pruefungKeywords = ['rückfragen', 'effizienz', 'bescheid', 'ablehnung', 'widerspruch'];
    const lauftKeywords = ['bewilligt'];
    const abgeschlossenKeywords = ['abgeschlossen'];

    const phases: StatusPhase[] = [
      { name: 'PLANUNG', nodes: [] },
      { name: 'IN_PRÜFUNG', nodes: [] },
      { name: 'PROJEKT_LÄUFT', nodes: [] },
      { name: 'ABGESCHLOSSEN', nodes: [] },
    ];

    nodes.forEach(node => {
      const nameLower = node.name.toLowerCase();

      if (abgeschlossenKeywords.some(kw => nameLower.includes(kw))) {
        phases[3].nodes.push(node);
      } else if (lauftKeywords.some(kw => nameLower.includes(kw))) {
        phases[2].nodes.push(node);
      } else if (pruefungKeywords.some(kw => nameLower.includes(kw))) {
        phases[1].nodes.push(node);
      } else if (planungKeywords.some(kw => nameLower.includes(kw))) {
        phases[0].nodes.push(node);
      }
    });

    // Filter out empty phases
    return phases.filter(phase => phase.nodes.length > 0);
  }

  /**
   * Distribute projects across workflow phases based on project count
   */
  private distributeProjectsAcrossPhases(
    projectCount: number,
    phases: StatusPhase[]
  ): { phaseIndex: number; statusNode: WorkflowNode }[] {
    const distribution: { phaseIndex: number; statusNode: WorkflowNode }[] = [];

    if (projectCount === 1) {
      // 1 project → PLANUNG
      const planungPhase = phases.find(p => p.name === 'PLANUNG');
      if (planungPhase && planungPhase.nodes.length > 0) {
        const randomNode = planungPhase.nodes[Math.floor(Math.random() * planungPhase.nodes.length)];
        distribution.push({ phaseIndex: 0, statusNode: randomNode });
      }
    } else if (projectCount === 2) {
      // 2 projects → 1 PLANUNG, 1 IN_PRÜFUNG
      const planungPhase = phases.find(p => p.name === 'PLANUNG');
      const pruefungPhase = phases.find(p => p.name === 'IN_PRÜFUNG');

      if (planungPhase && planungPhase.nodes.length > 0) {
        const randomNode = planungPhase.nodes[Math.floor(Math.random() * planungPhase.nodes.length)];
        distribution.push({ phaseIndex: 0, statusNode: randomNode });
      }

      if (pruefungPhase && pruefungPhase.nodes.length > 0) {
        const randomNode = pruefungPhase.nodes[Math.floor(Math.random() * pruefungPhase.nodes.length)];
        distribution.push({ phaseIndex: 1, statusNode: randomNode });
      }
    } else if (projectCount === 3) {
      // 3 projects → 1 PLANUNG, 1 PROJEKT_LÄUFT, 1 ABGESCHLOSSEN
      const planungPhase = phases.find(p => p.name === 'PLANUNG');
      const lauftPhase = phases.find(p => p.name === 'PROJEKT_LÄUFT');
      const abgeschlossenPhase = phases.find(p => p.name === 'ABGESCHLOSSEN');

      if (planungPhase && planungPhase.nodes.length > 0) {
        const randomNode = planungPhase.nodes[Math.floor(Math.random() * planungPhase.nodes.length)];
        distribution.push({ phaseIndex: 0, statusNode: randomNode });
      }

      if (lauftPhase && lauftPhase.nodes.length > 0) {
        const randomNode = lauftPhase.nodes[Math.floor(Math.random() * lauftPhase.nodes.length)];
        distribution.push({ phaseIndex: 2, statusNode: randomNode });
      }

      if (abgeschlossenPhase && abgeschlossenPhase.nodes.length > 0) {
        const randomNode = abgeschlossenPhase.nodes[Math.floor(Math.random() * abgeschlossenPhase.nodes.length)];
        distribution.push({ phaseIndex: 3, statusNode: randomNode });
      }
    } else {
      // 4+ projects → Distribute evenly across all phases
      const activePhases = phases.filter(p => p.name !== 'ABGELEHNT');

      for (let i = 0; i < projectCount; i++) {
        const phaseIndex = i % activePhases.length;
        const phase = activePhases[phaseIndex];

        if (phase && phase.nodes.length > 0) {
          const randomNode = phase.nodes[Math.floor(Math.random() * phase.nodes.length)];
          distribution.push({ phaseIndex, statusNode: randomNode });
        }
      }
    }

    return distribution;
  }

  /**
   * Find the link that connects to the target node
   */
  private findLinkToNode(
    targetNodeId: number,
    links: WorkflowLink[]
  ): WorkflowLink | null {
    // Find any link that leads to this node
    return links.find(link => link.target_node_id === targetNodeId) || null;
  }

  /**
   * Fetch detailed workflow information including forms
   */
  private async fetchWorkflowDetails(workflowId: number, partnerToken: string): Promise<any> {
    try {
      console.log(`  Fetching workflow details for workflow ${workflowId}...`);

      const response = await fetch(
        `https://workflow-backend.innoscripta.com/api/workflows/${workflowId}?id=${workflowId}`,
        {
          method: 'GET',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en',
            'authorization': `Bearer ${partnerToken}`,
            'content-language': 'en',
            'use-translations': '1',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`  Failed to fetch workflow details: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate dummy data based on field type
   */
  private generateDummyValue(input: FormInput): string {
    const type = input.type?.toLowerCase() || '';
    const name = input.name?.toLowerCase() || '';

    // Generate based on field name patterns
    if (name.includes('email')) {
      return 'demo@example.com';
    }
    if (name.includes('phone') || name.includes('telefon')) {
      return '+49 30 12345678';
    }
    if (name.includes('date') || name.includes('datum')) {
      const date = new Date();
      date.setDate(date.getDate() + Math.floor(Math.random() * 365));
      return date.toISOString().split('T')[0];
    }
    if (name.includes('url') || name.includes('website')) {
      return 'https://example.com';
    }
    if (name.includes('cost') || name.includes('kosten') || name.includes('amount') || name.includes('betrag')) {
      return (50000 + Math.floor(Math.random() * 150000)).toString();
    }
    if (name.includes('percentage') || name.includes('prozent')) {
      return (10 + Math.floor(Math.random() * 30)).toString();
    }

    // Generate based on field type
    if (type.includes('number') || type.includes('integer')) {
      return Math.floor(Math.random() * 1000000).toString();
    }
    if (type.includes('email')) {
      return 'demo@example.com';
    }
    if (type.includes('date')) {
      const date = new Date();
      date.setDate(date.getDate() + Math.floor(Math.random() * 365));
      return date.toISOString().split('T')[0];
    }
    if (type.includes('boolean') || type.includes('checkbox')) {
      return Math.random() > 0.5 ? '1' : '0';
    }

    // Default: random text
    const adjectives = ['Advanced', 'Innovative', 'Next-Generation', 'Revolutionary', 'Cutting-Edge'];
    const nouns = ['Technology', 'Solution', 'System', 'Platform', 'Framework'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
  }

  /**
   * Fill and submit form for a workflow link
   */
  private async fillAndSubmitForm(
    formId: number,
    linkId: number,
    workflowId: number,
    projectId: number,
    formInputs: FormInput[],
    partnerToken: string,
    organizationId: number
  ): Promise<void> {
    try {
      console.log(`    Filling form ${formId} with ${formInputs.length} fields...`);

      // Generate form values
      const values = formInputs.map(input => ({
        input_id: input.id,
        value: this.generateDummyValue(input),
        section_number: input.section_number || 1,
      }));

      // Step 1: Submit form results
      const formResultResponse = await fetch(
        'https://innos-forms.innoscripta.com/api/forms/' + formId + '/results',
        {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'accept-language': 'en',
            'authorization': `Bearer ${partnerToken}`,
            'content-language': 'en',
            'content-type': 'application/json',
            'partner-id': organizationId.toString(),
            'timezone': 'Europe/Istanbul',
          },
          body: JSON.stringify({
            form_result_id: null,
            workflow_link_id: linkId,
            searchable_entities: [
              {
                entity_id: projectId,
                entity_type: 'workflow.project',
              },
            ],
            values: values,
          }),
        }
      );

      if (!formResultResponse.ok) {
        const errorText = await formResultResponse.text();
        throw new Error(`Form result submission failed: ${formResultResponse.status} - ${errorText}`);
      }

      console.log(`    ✓ Form data submitted`);

      // Step 2: Submit restricted result
      const restrictedResultResponse = await fetch(
        'https://workflow-backend.innoscripta.com/api/forms/restricted-result',
        {
          method: 'POST',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en',
            'authorization': `Bearer ${partnerToken}`,
            'content-language': 'en',
            'content-type': 'application/json',
            'use-translations': '1',
          },
          body: JSON.stringify({
            form_id: formId,
            link_id: linkId,
            workflow_id: workflowId,
            skipped_data_rules_ids: [],
          }),
        }
      );

      if (!restrictedResultResponse.ok) {
        const errorText = await restrictedResultResponse.text();
        throw new Error(`Restricted result submission failed: ${restrictedResultResponse.status} - ${errorText}`);
      }

      console.log(`    ✓ Form submitted successfully`);
    } catch (error: any) {
      console.error(`    ✗ Form submission failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Move projects to appropriate statuses based on project count
   */
  async moveProjectsToStatuses(
    projectMappings: ProjectMapping[],
    projectTypeId: number,
    organizationId: number
  ): Promise<void> {
    console.log('\n=== Moving Projects to Appropriate Statuses ===');

    // Fetch project types if not already loaded
    if (this.projectTypes.length === 0) {
      await this.fetchProjectTypes();
    }

    const workflow = this.getWorkflowForProjectType(projectTypeId);

    if (!workflow) {
      console.log(`⚠ No workflow found for project type ${projectTypeId}, skipping status change`);
      return;
    }

    console.log(`Workflow ID: ${workflow.id}`);
    console.log(`Total nodes: ${workflow.nodes.length}`);
    console.log(`Total links: ${workflow.links.length}`);

    // Organize nodes into phases
    const phases = this.organizeNodesIntoPhases(workflow.nodes);
    console.log(`\nOrganized into ${phases.length} phases:`);
    phases.forEach(phase => {
      console.log(`  ${phase.name}: ${phase.nodes.length} statuses`);
    });

    // Distribute projects across phases
    const distribution = this.distributeProjectsAcrossPhases(projectMappings.length, phases);

    console.log(`\nDistribution plan for ${projectMappings.length} projects:`);
    distribution.forEach((dist, idx) => {
      console.log(`  Project ${idx + 1}: ${dist.statusNode.name}`);
    });

    // Generate partner token for API calls
    // Use the main API base URL (the token generation endpoint is on the main API)
    const apiBaseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api.innoscripta.com'
      : 'https://api-testing.innoscripta.com';
    const partnerToken = await this.authService.generatePartnerToken(organizationId, apiBaseUrl);

    // Fetch detailed workflow with forms
    const workflowDetails = await this.fetchWorkflowDetails(workflow.id, partnerToken);

    // Move each project to its assigned status
    for (let i = 0; i < projectMappings.length; i++) {
      const project = projectMappings[i];
      const targetStatus = distribution[i];

      if (!targetStatus) {
        console.log(`  [${i + 1}/${projectMappings.length}] ${project.short_title}: No status assigned, skipping`);
        continue;
      }

      try {
        console.log(`\n[${i + 1}/${projectMappings.length}] Moving: ${project.short_title}`);
        console.log(`  Target status: ${targetStatus.statusNode.name}`);

        // Find link to the target node
        const link = this.findLinkToNode(targetStatus.statusNode.id, workflow.links);

        if (!link) {
          console.log(`  ⚠ No link found to status "${targetStatus.statusNode.name}", skipping`);
          continue;
        }

        // Make the API call to move the project
        const moveResponse = await this.apiClient.executeRequest(
          'POST',
          'https://after-sales-service.innoscripta.com/api/projects/move',
          {
            project_id: project.id,
            target_node_id: targetStatus.statusNode.id,
            link_id: link.id,
            workflow_id: workflow.id,
            partner_id: organizationId,
            token: partnerToken,
          }
        );

        console.log(`  ✓ Successfully moved to: ${targetStatus.statusNode.name}`);

        // Check if the link has forms and fill them
        if (workflowDetails && workflowDetails.links) {
          const linkWithForms = workflowDetails.links.find((l: any) => l.id === link.id);

          if (linkWithForms && linkWithForms.forms && linkWithForms.forms.length > 0) {
            console.log(`  📝 Link has ${linkWithForms.forms.length} form(s), filling them...`);

            for (const form of linkWithForms.forms) {
              if (form.inputs && form.inputs.length > 0) {
                try {
                  await this.fillAndSubmitForm(
                    form.id,
                    link.id,
                    workflow.id,
                    project.id,
                    form.inputs,
                    partnerToken,
                    organizationId
                  );
                } catch (formError: any) {
                  console.error(`  ⚠ Form filling failed, but continuing: ${formError.message}`);
                }
              } else {
                console.log(`    ⓘ Form "${form.name}" has no inputs, skipping`);
              }
            }
          }
        }
      } catch (error: any) {
        console.error(`  ✗ Failed to move project: ${error.message}`);
      }
    }

    console.log(`\n✓ Project status updates completed\n`);
  }
}
