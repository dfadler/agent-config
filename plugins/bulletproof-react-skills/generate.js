#!/usr/bin/env node
// Distills bulletproof-react's docs/*.md (installed as a pinned devDependency,
// see package.json) into this plugin's skills/*/SKILL.md. Mechanical only: it
// concatenates and rewrites links, it does not rewrite prose. #218's human
// review pass is what turns the mechanical draft into a polished skill; a
// re-run (after the pin is bumped) regenerates from source again, so any
// hand-editing done during that review does not survive untouched across a
// future re-run and needs re-reviewing each time — see NOTICE.md's "Updating".
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLUGIN_ROOT = __dirname;
const DOCS_DIR = path.join(PLUGIN_ROOT, 'node_modules', 'bulletproof-react', 'docs');
const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');
const MANIFEST_PATH = path.join(PLUGIN_ROOT, '.docs-manifest.json');
const PACKAGE_JSON_PATH = path.join(PLUGIN_ROOT, 'package.json');
const REPO_URL = 'https://github.com/alan2207/bulletproof-react';

// The 7 skills #215 scoped, each mapped to the whole source file(s) it's
// drawn from. Whole-file merging only (no section-level extraction): a
// section extracted by heading-text match would silently break the moment
// bulletproof-react renames or restructures that heading, which is exactly
// the kind of drift #215 was worried about. error-handling.md merges into
// state-and-data in full for the same reason, rather than trying to pull out
// just its "API Errors" section.
const SKILL_MAP = [
  {
    name: 'project-structure',
    description:
      'Project structure conventions from bulletproof-react: what lives in src/, ' +
      'the app/assets/components/features/hooks/lib/stores/testing/types/utils ' +
      'layout, and how features are organized to stay unidirectional. Use when ' +
      'scaffolding a new React project or deciding where a new file belongs.',
    sources: ['project-structure.md'],
  },
  {
    name: 'state-and-data',
    description:
      'State management and data-fetching conventions from bulletproof-react: ' +
      'component vs. application vs. server vs. form vs. URL state, a single ' +
      'shared API client instance, colocated request declarations paired with ' +
      'React Query hooks, and API/in-app error handling. Use when adding state, ' +
      'wiring up an API call, or handling request/render errors in a React app.',
    sources: ['state-management.md', 'api-layer.md', 'error-handling.md'],
  },
  {
    name: 'testing',
    description:
      'Testing conventions from bulletproof-react: the unit/integration/e2e/' +
      'static/visual-regression test types, mock API layers with MSW, and what ' +
      'to prioritize. Use when adding tests to a React app or deciding what kind ' +
      'of test a given piece of code needs.',
    sources: ['testing.md'],
  },
  {
    name: 'performance',
    description:
      'Performance conventions from bulletproof-react: code splitting, ' +
      'component/state update optimization, list virtualization, image ' +
      'optimization, and bundle analysis. Use when a React app feels slow or ' +
      'before shipping a feature that renders large lists or heavy assets.',
    sources: ['performance.md'],
  },
  {
    name: 'security',
    description:
      'Security conventions from bulletproof-react: token storage and ' +
      'authentication for SPAs, authorization patterns, and other client-side ' +
      'hardening practices. Use when implementing auth, authorization checks, ' +
      'or handling sensitive data in a React app.',
    sources: ['security.md'],
  },
  {
    name: 'components-and-styling',
    description:
      'Component and styling conventions from bulletproof-react: colocation, ' +
      'avoiding nested render functions, container/presentation separation, ' +
      'and composition-over-config for component APIs. Use when designing a new ' +
      'component or reviewing one for API shape and styling approach.',
    sources: ['components-and-styling.md'],
  },
  {
    name: 'project-standards',
    description:
      'Project standards from bulletproof-react: ESLint/Prettier/TypeScript ' +
      'config, absolute imports, pre-commit hooks, and CI conventions. Use when ' +
      'setting up tooling for a React project or reviewing its lint/format/type ' +
      'configuration.',
    sources: ['project-standards.md'],
  },
];

// Every source file not mapped above must be explicitly accounted for here,
// with a one-line reason. A doc that is neither mapped nor dropped is unknown
// shape drift, and the generator refuses to guess at it (see checkDrift).
const DROPPED = {
  'application-overview.md':
    "documents bulletproof-react's own sample-app data model (Users/Teams/" +
    'Discussions) and how to run its demo apps — not general guidance.',
  'deployment.md':
    'a bare list of 4 CDN providers, nothing React-specific, too thin for a ' +
    'standalone skill.',
  'additional-resources.md':
    'a bare list of external links (React/JS/best-practices reading), no ' +
    'distillable guidance of its own.',
};

function readPinnedSha() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const spec = pkg.devDependencies && pkg.devDependencies['bulletproof-react'];
  const match = spec && spec.match(/#([0-9a-f]{40})$/);
  if (!match) {
    throw new Error(
      `package.json's bulletproof-react devDependency isn't pinned to a 40-char commit SHA: ${spec}`
    );
  }
  return match[1];
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Refuses to generate anything if the actual doc set doesn't exactly match
// what SKILL_MAP + DROPPED account for. This is the drift detector NOTICE.md
// promises: a doc added, removed, or renamed upstream fails loudly here
// rather than silently producing skills from an incomplete or stale mapping.
function checkDrift(actualFiles) {
  const known = new Set([
    ...SKILL_MAP.flatMap((s) => s.sources),
    ...Object.keys(DROPPED),
  ]);
  const actual = new Set(actualFiles);

  const unknown = [...actual].filter((f) => !known.has(f)).sort();
  const missing = [...known].filter((f) => !actual.has(f)).sort();

  if (unknown.length > 0 || missing.length > 0) {
    const lines = [
      'Doc-set drift detected — bulletproof-react/docs/*.md no longer matches',
      "this generator's mapping. Update SKILL_MAP or DROPPED in generate.js",
      'before regenerating.',
    ];
    if (unknown.length > 0) {
      lines.push('', 'New/unmapped files:', ...unknown.map((f) => `  - ${f}`));
    }
    if (missing.length > 0) {
      lines.push('', 'Mapped or dropped files no longer present:', ...missing.map((f) => `  - ${f}`));
    }
    throw new Error(lines.join('\n'));
  }
}

// Rewrites bulletproof-react's docs-relative links and images (e.g. "../apps/
// react-vite/src/lib/api-client.ts", or "./assets/foo.png" for an asset
// sitting next to the docs themselves) into absolute GitHub URLs at the
// pinned commit. Left as relative, these are broken outside bulletproof-
// react's own repo — which is exactly where every consumer of this skill
// reads them from. Resolved via path.posix against "docs/" (every source
// file lives directly in that directory) rather than special-casing "../"
// vs "./", so any relative form resolves correctly. A plain link uses a
// "blob" URL (GitHub's syntax-highlighted source view); an image (leading
// "!") uses raw.githubusercontent.com instead, since a blob URL serves an
// HTML page, not image bytes, and would render as a broken image.
function rewriteRelativeLinks(markdown, pinnedSha) {
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (full, bang, text, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return full; // already a URL
    if (target.startsWith('#')) return full; // in-page anchor
    const repoPath = path.posix.normalize(path.posix.join('docs', target));
    const base =
      bang === '!'
        ? `https://raw.githubusercontent.com/alan2207/bulletproof-react/${pinnedSha}`
        : `${REPO_URL}/blob/${pinnedSha}`;
    return `${bang}[${text}](${base}/${repoPath})`;
  });
}

function buildSkillMarkdown(skill, pinnedSha) {
  const sections = skill.sources.map((filename) => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, filename), 'utf8').trim();
    return rewriteRelativeLinks(raw, pinnedSha);
  });

  const body =
    skill.sources.length === 1
      ? sections[0]
      : sections.join('\n\n---\n\n');

  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    'description: |',
    ...skill.description
      .split(/\s+/)
      .reduce((lines, word) => {
        const last = lines[lines.length - 1];
        if (last && last.length + word.length + 1 <= 78) {
          lines[lines.length - 1] = `${last} ${word}`;
        } else {
          lines.push(`  ${word}`);
        }
        return lines;
      }, []),
    'license: MIT',
    'metadata:',
    '  version: "0.1.0"',
    '---',
  ].join('\n');

  const attribution =
    `> Adapted from [bulletproof-react](${REPO_URL}) @ ` +
    `[\`${pinnedSha.slice(0, 7)}\`](${REPO_URL}/commit/${pinnedSha}), MIT licensed. ` +
    'See ../../NOTICE.md for provenance and the re-pin workflow. Generated by ' +
    '../../generate.js — a re-run overwrites this file from source, so review ' +
    'any local edits against a fresh diff before relying on them.';

  return `${frontmatter}\n\n${attribution}\n\n${body}\n`;
}

function main() {
  const pinnedSha = readPinnedSha();
  const actualFiles = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  checkDrift(actualFiles);

  const manifestFiles = {};
  for (const filename of actualFiles) {
    manifestFiles[filename] = sha256(fs.readFileSync(path.join(DOCS_DIR, filename), 'utf8'));
  }

  let previousManifest = null;
  if (fs.existsSync(MANIFEST_PATH)) {
    previousManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }
  if (previousManifest && previousManifest.pinnedSha === pinnedSha) {
    const changed = Object.keys(manifestFiles).filter(
      (f) => previousManifest.files[f] !== manifestFiles[f]
    );
    if (changed.length > 0) {
      console.warn(
        'Warning: content changed for known files without a pin bump (unexpected):\n' +
          changed.map((f) => `  - ${f}`).join('\n')
      );
    }
  }

  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  for (const skill of SKILL_MAP) {
    const dir = path.join(SKILLS_DIR, skill.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), buildSkillMarkdown(skill, pinnedSha));
    console.log(`✓ wrote skills/${skill.name}/SKILL.md`);
  }

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ pinnedSha, files: manifestFiles }, null, 2) + '\n'
  );
  console.log(`✓ wrote ${path.relative(PLUGIN_ROOT, MANIFEST_PATH)}`);

  console.log('\nDropped (no skill generated):');
  for (const [filename, reason] of Object.entries(DROPPED)) {
    console.log(`  - ${filename}: ${reason}`);
  }
}

main();
