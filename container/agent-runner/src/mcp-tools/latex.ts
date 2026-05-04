/**
 * LaTeX PDF MCP tools: compile_latex, list_cv_templates, generate_cv.
 *
 * Requires the latex sidecar running on LATEX_URL (default http://localhost:9003).
 * Start with: docker compose -f docker-compose.latex.yml up -d
 *
 * PDFs are saved to /workspace/agent/ — use send_file to deliver to chat.
 */
import fs from 'fs';
import path from 'path';

import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools/latex] ${msg}`);
}

const LATEX_URL = process.env.LATEX_URL ?? 'http://localhost:9003';
const OUTPUT_DIR = '/workspace/agent';

const NOT_RUNNING_HINT =
  'Is the latex sidecar running? Start with: docker compose -f docker-compose.latex.yml up -d';

async function fetchPdf(url: string, init: RequestInit): Promise<Buffer | string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return `Error ${res.status}: ${detail}`;
  }
  return Buffer.from(await res.arrayBuffer());
}

function savePdf(buf: Buffer, filename: string): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

// ── compile_latex ─────────────────────────────────────────────────────────────

export const compileLaTeX: McpToolDefinition = {
  tool: {
    name: 'compile_latex',
    description:
      'Compile a raw LaTeX document to PDF. Saves the PDF to /workspace/agent/ and returns the file path. Use send_file to deliver it to chat.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latex_source: {
          type: 'string',
          description: 'Complete LaTeX document source (must include \\documentclass and \\begin{document})',
        },
        filename: {
          type: 'string',
          description: 'Output filename without .pdf extension (optional, default: "document")',
        },
        engine: {
          type: 'string',
          enum: ['xelatex', 'pdflatex'],
          description: 'LaTeX engine (default: xelatex — better Unicode/font support)',
        },
      },
      required: ['latex_source'],
    },
  },
  async handler(args) {
    const latex = (args.latex_source as string)?.trim();
    if (!latex)
      return { content: [{ type: 'text' as const, text: 'Error: latex_source is required' }], isError: true };

    const base = ((args.filename as string) ?? 'document').trim().replace(/\.pdf$/i, '');
    const filename = `${base}_${Date.now()}.pdf`;
    const engine = (args.engine as string) || 'xelatex';

    try {
      const result = await fetchPdf(`${LATEX_URL}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, engine }),
      });
      if (typeof result === 'string')
        return { content: [{ type: 'text' as const, text: result }], isError: true };

      const outPath = savePdf(result, filename);
      log(`compile_latex → ${outPath} (${result.length} bytes)`);
      return { content: [{ type: 'text' as const, text: `PDF saved to ${outPath}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`compile_latex error: ${msg}`);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}\n${NOT_RUNNING_HINT}` }],
        isError: true,
      };
    }
  },
};

// ── list_cv_templates ─────────────────────────────────────────────────────────

export const listCvTemplates: McpToolDefinition = {
  tool: {
    name: 'list_cv_templates',
    description: 'List the bundled CV templates available for use with generate_cv.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  async handler(_args) {
    try {
      const res = await fetch(`${LATEX_URL}/templates`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok)
        return { content: [{ type: 'text' as const, text: `Error: ${res.statusText}` }], isError: true };
      const data = (await res.json()) as { templates: Array<{ name: string; description: string }> };
      const list = data.templates.map((t) => `- **${t.name}**: ${t.description}`).join('\n');
      return { content: [{ type: 'text' as const, text: `Available CV templates:\n${list}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}\n${NOT_RUNNING_HINT}` }],
        isError: true,
      };
    }
  },
};

// ── generate_cv ───────────────────────────────────────────────────────────────

export const generateCv: McpToolDefinition = {
  tool: {
    name: 'generate_cv',
    description:
      'Generate a professional CV as a PDF from structured data using a LaTeX template. Saves to /workspace/agent/ and returns the file path. Use send_file to deliver it to chat.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: {
          type: 'string',
          description: 'Template name — use list_cv_templates to see options (e.g. "modern", "sidebar")',
        },
        output_filename: {
          type: 'string',
          description: 'Output filename without .pdf extension (optional, default: "cv")',
        },
        personal: {
          type: 'object',
          description: 'Personal / contact information',
          properties: {
            name:     { type: 'string' },
            email:    { type: 'string' },
            phone:    { type: 'string' },
            location: { type: 'string', description: 'City, Country' },
            website:  { type: 'string', description: 'Full URL including https://' },
            linkedin: { type: 'string', description: 'Full LinkedIn profile URL' },
            github:   { type: 'string', description: 'Full GitHub profile URL' },
          },
          required: ['name', 'email'],
        },
        summary: {
          type: 'string',
          description: 'Professional summary or objective (optional)',
        },
        experience: {
          type: 'array',
          description: 'Work experience, most recent first',
          items: {
            type: 'object',
            properties: {
              company:  { type: 'string' },
              role:     { type: 'string' },
              start:    { type: 'string', description: 'e.g. "Jan 2022"' },
              end:      { type: 'string', description: 'e.g. "Mar 2024" — omit for current position' },
              location: { type: 'string' },
              bullets:  { type: 'array', items: { type: 'string' }, description: 'Achievement bullet points' },
            },
            required: ['company', 'role', 'start'],
          },
        },
        education: {
          type: 'array',
          description: 'Education entries, most recent first',
          items: {
            type: 'object',
            properties: {
              institution: { type: 'string' },
              degree:      { type: 'string', description: 'e.g. "Bachelor of Science"' },
              field:       { type: 'string', description: 'e.g. "Computer Science"' },
              start:       { type: 'string' },
              end:         { type: 'string' },
              gpa:         { type: 'string' },
            },
            required: ['institution', 'degree'],
          },
        },
        skills: {
          type: 'object',
          description: 'Skills grouped by category, e.g. {"Languages": ["Python", "TypeScript"]}',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        projects: {
          type: 'array',
          description: 'Notable projects (optional)',
          items: {
            type: 'object',
            properties: {
              name:        { type: 'string' },
              description: { type: 'string' },
              url:         { type: 'string', description: 'Full URL including https://' },
              tech:        { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'description'],
          },
        },
      },
      required: ['template', 'personal', 'experience', 'education'],
    },
  },
  async handler(args) {
    const template = (args.template as string)?.trim();
    if (!template)
      return { content: [{ type: 'text' as const, text: 'Error: template is required' }], isError: true };

    const base = ((args.output_filename as string) ?? 'cv').trim().replace(/\.pdf$/i, '');
    const filename = `${base}_${Date.now()}.pdf`;

    try {
      const result = await fetchPdf(`${LATEX_URL}/render-cv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (typeof result === 'string')
        return { content: [{ type: 'text' as const, text: result }], isError: true };

      const outPath = savePdf(result, filename);
      log(`generate_cv → ${outPath} (${result.length} bytes)`);
      return { content: [{ type: 'text' as const, text: `CV PDF saved to ${outPath}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`generate_cv error: ${msg}`);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}\n${NOT_RUNNING_HINT}` }],
        isError: true,
      };
    }
  },
};

registerTools([compileLaTeX, listCvTemplates, generateCv]);
