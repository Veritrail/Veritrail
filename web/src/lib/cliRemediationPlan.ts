import {
  applyCliPlaceholders,
  buildCliPlaceholders,
  formatCliStepSpacing,
  injectEc2RegionFlags,
  type CliFinding,
} from "./cliRemediation";

export type CliRemediationStep = {
  id: string;
  title: string;
  description: string;
  commands: string[];
  recommended?: boolean;
};

export type CliRemediationPlan = {
  summary: string;
  steps: CliRemediationStep[];
};

const STEP_OPTION = /^#\s*Option\s+([A-Z])\s*[—–-]\s*(.+)$/i;
const STEP_NUMBER = /^#\s*(\d+)\.\s*(.+)$/;
const STEP_LABEL = /^#\s*Step\s+(\d+):\s*(.+)$/i;

function commandsOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitCommandBlocks(text: string): string[] {
  const stripped = commandsOnly(text);
  if (!stripped) return [];
  const blocks = stripped.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length > 0) return blocks;
  return [stripped];
}

function leadingCommentSummary(lines: string[]): string {
  const comments = lines
    .filter((line) => line.trimStart().startsWith("#"))
    .map((line) => line.replace(/^#\s?/, "").trim())
    .filter((line) => !STEP_OPTION.test(`# ${line}`) && !STEP_NUMBER.test(`# ${line}`) && !STEP_LABEL.test(`# ${line}`));
  return comments.join(" ").trim();
}

function parseDelimitedCli(cli: string): CliRemediationStep[] {
  const lines = cli.split("\n");
  type Section = { id?: string; title?: string; lines: string[] };
  const sections: Section[] = [{ lines: [] }];

  for (const line of lines) {
    const option = line.match(STEP_OPTION);
    const numbered = line.match(STEP_NUMBER);
    const labeled = line.match(STEP_LABEL);
    if (option) {
      sections.push({ id: option[1], title: option[2].trim(), lines: [] });
    } else if (numbered) {
      sections.push({ id: numbered[1], title: numbered[2].trim(), lines: [] });
    } else if (labeled) {
      sections.push({ id: labeled[1], title: labeled[2].trim(), lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const titled = sections.filter((section, index) => index === 0 || section.title);
  if (titled.length <= 1 && !titled[0]?.title) {
    const commands = splitCommandBlocks(cli);
    if (commands.length === 0) return [];
    if (commands.length === 1) {
      return [
        {
          id: "1",
          title: "Run command",
          description: leadingCommentSummary(lines),
          commands,
        },
      ];
    }
    return commands.map((command, index) => ({
      id: String(index + 1),
      title: `Step ${index + 1}`,
      description: "",
      commands: [command],
    }));
  }

  return titled
    .map((section, index) => {
      const rawTitle = section.title ?? `Step ${index + 1}`;
      const recommended = /\brecommended\b/i.test(rawTitle);
      const title = rawTitle.replace(/\s*\(recommended\)\s*/gi, "").trim();
      const body = section.lines.join("\n");
      return {
        id: section.id ?? String.fromCharCode(65 + index),
        title,
        description: leadingCommentSummary(section.lines),
        recommended,
        commands: splitCommandBlocks(body),
      };
    })
    .filter((step) => step.commands.length > 0);
}

function leastPrivilegePolicyPlan(roleName: string): CliRemediationPlan {
  return {
    summary:
      "Generates a least-privilege policy from observed usage and attaches it to the role, or replaces the role's inline policy if you choose.",
    steps: [
      {
        id: "A",
        title: "Generate & attach as new managed policy",
        description:
          "Creates a new least-privilege policy from the proposal and attaches it to the role.",
        recommended: true,
        commands: [
          `aws iam put-role-policy \\
  --role-name ${roleName} \\
  --policy-name least-privilege-proposal \\
  --policy-document file://scoped-policy.json`,
        ],
      },
      {
        id: "B",
        title: "Review the policy",
        description: "List policies attached to the role and the newly generated policy document.",
        recommended: true,
        commands: [
          `aws iam list-attached-role-policies \\
  --role-name ${roleName}`,
          `aws iam get-role-policy \\
  --role-name ${roleName} \\
  --policy-name least-privilege-proposal \\
  --query 'PolicyDocument' \\
  --output json`,
        ],
      },
      {
        id: "C",
        title: "Replace existing inline policy",
        description: "Replaces the current inline policy with the least-privilege proposal.",
        commands: [
          `aws iam put-role-policy \\
  --role-name ${roleName} \\
  --policy-name <policy-name> \\
  --policy-document file://scoped-policy.json`,
        ],
      },
    ],
  };
}

function unusedServicesRolePlan(roleName: string, roleArn: string): CliRemediationPlan {
  return {
    summary:
      "Review attached and inline policies, then scope or remove permissions for services with no recent usage.",
    steps: [
      {
        id: "A",
        title: "See what's attached",
        description: "List managed policies currently attached to the role.",
        recommended: true,
        commands: [`aws iam list-attached-role-policies --role-name ${roleName}`],
      },
      {
        id: "B",
        title: "Review each attached policy",
        description: "Fetch the policy document for each attached policy ARN from step A.",
        commands: [
          `aws iam get-policy-version \\
  --policy-arn <policy-arn> \\
  --version-id v1`,
        ],
      },
      {
        id: "C",
        title: "Start CloudTrail policy generation",
        description: "Optional — generate a least-privilege policy from CloudTrail activity for this role.",
        commands: [
          `aws accessanalyzer start-policy-generation \\
  --policy-generation-details '{"principalArn":"${roleArn}"}' \\
  --cloud-trail-details '{"trails":["<trail-arn>"]}'`,
          `aws accessanalyzer get-generated-policy --job-id <job-id>`,
        ],
      },
    ],
  };
}

export function buildCliRemediationPlan(
  finding: CliFinding,
  rawCli: string,
  why: string,
  clientIp?: string | null,
): CliRemediationPlan {
  const placeholders = buildCliPlaceholders(finding, clientIp);
  const roleName = placeholders["<role-name>"];

  if (finding.check_id === "iam.role.least_privilege_policy" && roleName && roleName !== "<role-name>") {
    return leastPrivilegePolicyPlan(roleName);
  }

  const removable = finding.evidence.removable_statements as unknown[] | undefined;
  const hasInline = Array.isArray(removable) && removable.length > 0;
  if (finding.check_id === "iam.role.unused_services_90d" && !hasInline && roleName && roleName !== "<role-name>") {
    return unusedServicesRolePlan(roleName, finding.resource_arn);
  }

  let cli = applyCliPlaceholders(rawCli, placeholders);
  cli = injectEc2RegionFlags(cli, placeholders["<region>"]);
  cli = formatCliStepSpacing(cli);

  const steps = parseDelimitedCli(cli);

  if (steps.length === 0) {
    const fallback = commandsOnly(cli);
    return {
      summary: why,
      steps: fallback
        ? [{ id: "1", title: "Commands", description: "", commands: [fallback] }]
        : [],
    };
  }

  return {
    summary: why,
    steps,
  };
}

export function allExecutableCommands(plan: CliRemediationPlan): string {
  return plan.steps
    .flatMap((step) => step.commands)
    .join("\n\n")
    .trim();
}
