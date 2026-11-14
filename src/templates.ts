// Spec template library - pre-built templates for common API vendors
import { BreakingChangeSpec } from "./types.js";
import { buildSpec, type SpecWizardInput } from "./create-spec.js";

export interface SpecTemplate {
  id: string;
  vendor: string;
  api: string;
  title: string;
  description: string;
  languages: string[];
  rulesCount: number;
  tags: string[];
}

export interface TemplateLibrary {
  templates: SpecTemplate[];
  totalTemplates: number;
}

const TEMPLATE_INPUTS: SpecWizardInput[] = [
  {
    vendor: "stripe",
    api: "stripe-node",
    version: "TEMPLATE",
    title: "Stripe Node.js SDK breaking changes",
    languages: ["javascript", "typescript"],
    docsUrl: "https://stripe.com/docs/changelog",
    rules: [
      {
        severity: "breaking",
        title: "API method renamed",
        patterns: ["stripe\\.(?:customers|charges|subscriptions)\\.[a-z]+"],
        guidance: "Check Stripe changelog for renamed methods and update calls accordingly",
        before: "stripe.customers.retrieve(id)",
        after: "stripe.customers.get(id)",
      },
      {
        severity: "deprecation",
        title: "Deprecated parameter usage",
        patterns: ["source[\"']?\\s*:", "token[\"']?\\s*:"],
        guidance: "Migrate from legacy source/token params to PaymentMethod",
      },
    ],
  },
  {
    vendor: "openai",
    api: "openai-node",
    version: "TEMPLATE",
    title: "OpenAI Node.js SDK breaking changes",
    languages: ["javascript", "typescript"],
    docsUrl: "https://platform.openai.com/docs/changelog",
    rules: [
      {
        severity: "breaking",
        title: "Chat completions API change",
        patterns: ["openai\\.createChatCompletion", "openai\\.createCompletion"],
        guidance: "Use openai.chat.completions.create() in v4+",
        before: "openai.createChatCompletion({...})",
        after: "openai.chat.completions.create({...})",
      },
      {
        severity: "breaking",
        title: "Configuration constructor change",
        patterns: ["new Configuration\\(", "new OpenAIApi\\("],
        guidance: "Use new OpenAI() constructor in v4+",
        before: "new OpenAIApi(new Configuration({apiKey}))",
        after: "new OpenAI({apiKey})",
      },
    ],
  },
  {
    vendor: "aws",
    api: "aws-sdk-js",
    version: "TEMPLATE",
    title: "AWS SDK for JavaScript v2 to v3 migration",
    languages: ["javascript", "typescript"],
    docsUrl: "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrating.html",
    rules: [
      {
        severity: "breaking",
        title: "AWS SDK v2 service client import",
        patterns: ["require\\([\"']aws-sdk[\"']\\)", "from [\"']aws-sdk[\"']"],
        guidance: "Import individual service clients from @aws-sdk/client-*",
        before: "const AWS = require('aws-sdk')",
        after: "const { S3Client } = require('@aws-sdk/client-s3')",
      },
      {
        severity: "breaking",
        title: "AWS SDK v2 service constructor",
        patterns: ["new AWS\\.[A-Z]\\w+\\("],
        guidance: "Use modular client constructors from @aws-sdk/client-*",
        before: "new AWS.S3({region: 'us-east-1'})",
        after: "new S3Client({region: 'us-east-1'})",
      },
    ],
  },
  {
    vendor: "firebase",
    api: "firebase-js",
    version: "TEMPLATE",
    title: "Firebase JS SDK v8 to v9+ modular migration",
    languages: ["javascript", "typescript"],
    docsUrl: "https://firebase.google.com/docs/web/modular-upgrade",
    rules: [
      {
        severity: "breaking",
        title: "Firebase compat import",
        patterns: ["firebase/app", "firebase\\.initializeApp"],
        guidance: "Use modular imports from firebase/app",
        before: "import firebase from 'firebase/app'",
        after: "import { initializeApp } from 'firebase/app'",
      },
      {
        severity: "breaking",
        title: "Firebase service method chaining",
        patterns: ["firebase\\.firestore\\(\\)", "firebase\\.auth\\(\\)", "firebase\\.storage\\(\\)"],
        guidance: "Use getFirestore(), getAuth(), getStorage() functional API",
        before: "firebase.firestore().collection('users')",
        after: "collection(getFirestore(), 'users')",
      },
    ],
  },
  {
    vendor: "react",
    api: "react",
    version: "TEMPLATE",
    title: "React class component to hooks migration",
    languages: ["javascript", "typescript"],
    docsUrl: "https://react.dev/reference/react",
    rules: [
      {
        severity: "deprecation",
        title: "Class component lifecycle methods",
        patterns: ["componentDidMount", "componentWillUnmount", "componentDidUpdate", "componentWillReceiveProps"],
        guidance: "Migrate to functional components with useEffect hook",
      },
      {
        severity: "deprecation",
        title: "Legacy context API",
        patterns: ["contextTypes", "childContextTypes", "getChildContext"],
        guidance: "Use React.createContext and useContext hook",
      },
    ],
  },
  {
    vendor: "prisma",
    api: "prisma-client",
    version: "TEMPLATE",
    title: "Prisma Client breaking changes",
    languages: ["javascript", "typescript"],
    docsUrl: "https://www.prisma.io/docs/guides/upgrade-guides",
    rules: [
      {
        severity: "breaking",
        title: "Prisma Client import change",
        patterns: ["@prisma/client"],
        guidance: "Check Prisma upgrade guide for breaking import/constructor changes",
      },
      {
        severity: "breaking",
        title: "Prisma query API changes",
        patterns: ["\\.findOne\\(", "\\.upsert\\("],
        guidance: "findOne was renamed to findUnique in Prisma 2.12+",
        before: "prisma.user.findOne({where: {id}})",
        after: "prisma.user.findUnique({where: {id}})",
      },
    ],
  },
];

export function listTemplates(options?: { language?: string; vendor?: string; tag?: string }): TemplateLibrary {
  let inputs = TEMPLATE_INPUTS;

  if (options?.language) {
    inputs = inputs.filter((t) => t.languages.includes(options.language!));
  }
  if (options?.vendor) {
    inputs = inputs.filter((t) => t.vendor === options.vendor);
  }

  const templates: SpecTemplate[] = inputs.map((input) => ({
    id: `${input.vendor}/${input.api}`,
    vendor: input.vendor,
    api: input.api,
    title: input.title ?? `${input.vendor}/${input.api} breaking changes`,
    description: input.rules.map((r) => r.title).join(", "),
    languages: input.languages,
    rulesCount: input.rules.length,
    tags: [input.vendor, ...input.languages],
  }));

  if (options?.tag) {
    const tag = options.tag.toLowerCase();
    return { templates: templates.filter((t) => t.tags.some((tg) => tg.includes(tag))), totalTemplates: templates.length };
  }

  return { templates, totalTemplates: templates.length };
}

export function getTemplate(templateId: string): SpecWizardInput | null {
  const input = TEMPLATE_INPUTS.find((t) => `${t.vendor}/${t.api}` === templateId);
  return input ?? null;
}

export function instantiateTemplate(templateId: string, version: string, overrides?: Partial<SpecWizardInput>): BreakingChangeSpec {
  const input = getTemplate(templateId);
  if (!input) throw new Error(`Template not found: ${templateId}`);

  const merged: SpecWizardInput = {
    ...input,
    version,
    ...overrides,
    rules: overrides?.rules ?? input.rules,
    languages: overrides?.languages ?? input.languages,
  };

  return buildSpec(merged);
}

export function formatTemplateLibrary(lib: TemplateLibrary): string {
  if (lib.templates.length === 0) return "No templates match the given filters.";

  const lines: string[] = [
    `Spec Template Library (${lib.templates.length} template${lib.templates.length > 1 ? "s" : ""}):`,
    "─".repeat(60),
  ];

  for (const t of lib.templates) {
    lines.push(`  ${t.id}`);
    lines.push(`    ${t.title}`);
    lines.push(`    Languages: ${t.languages.join(", ")} | Rules: ${t.rulesCount}`);
    lines.push(`    ${t.description}`);
    lines.push("");
  }

  lines.push("To use: evergreen from-template <id> --version <ver> [--out <file>]");

  return lines.join("\n");
}
