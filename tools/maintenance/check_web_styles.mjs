/** Owned task/shared CSS has one rule per selector/condition; legacy CSS is checked conservatively. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const postcss = require('postcss');
const sourceRoot = fileURLToPath(new URL('../../apps/web/src/', import.meta.url));
const taskDirectory = 'components/tasks/';
const sharedOwners = new Map([
  ['card-button', 'components/card-button.css'],
  ['segmented-card', 'components/segmented-card.css'],
  ['primary-button', 'components/button.css'],
  ['secondary-button', 'components/button.css'],
  ['icon-action', 'components/button.css'],
  ['button-motion', 'components/button.css'],
  ['button-motion-content', 'components/button.css'],
]);

export function taskStyleOwner(name) {
  if (name === 'tasks-view' || name.startsWith('task-workspace-')) return 'task-workspace.css';
  if (/^task-(date|calendar)-/.test(name)) return 'task-date-filter.css';
  if (/^task-(monitor|media|process|overall)-/.test(name)) return 'task-monitor.css';
  if (name === 'empty-tasks' || /^task-(?!progress-|detail$)/.test(name)) return 'task-history.css';
  return null;
}

function conditionsOf(rule) {
  const conditions = [];
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
    if (parent.name?.endsWith('keyframes')) return null;
    conditions.unshift(`@${parent.name} ${parent.params}`);
  }
  return conditions.join(' / ');
}

export function inspectStyles(files) {
  const problems = [],
    shadowed = [];
  const seen = new Map(),
    ownedSelectors = new Map(),
    roots = new Map();
  for (const [filename, css] of files) {
    const root = postcss.parse(css, { from: filename });
    roots.set(filename, root);
    const taskFile = filename.startsWith(taskDirectory);
    const ownedFile = taskFile || [...sharedOwners.values()].includes(filename);
    const report = (node, message) =>
      problems.push(`${filename}:${node.source.start.line}: ${message}`);
    root.walkRules((rule) => {
      const conditions = conditionsOf(rule);
      if (conditions === null) return;
      for (const selector of rule.selectors) {
        // The legacy small-text rule explicitly excludes the task workspace.
        const ownedSelector = selector.replace(':where(:not(.tasks-view *))', '');
        for (const [, name] of ownedSelector.matchAll(/\.([\w-]+)/g)) {
          const owner = taskStyleOwner(name);
          if (owner && filename !== `${taskDirectory}${owner}`)
            report(rule, `.${name} belongs in ${taskDirectory}${owner}`);
          const sharedOwner = sharedOwners.get(name);
          // Page-specific sizing remains with the page, baseline interactions with the primitive.
          if (sharedOwner && selector.startsWith(`.${name}`) && filename !== sharedOwner)
            report(rule, `.${name} belongs in ${sharedOwner}`);
        }
        if (
          /^button(?=[:\[]|$)/.test(selector) &&
          rule.nodes.some(
            (node) =>
              node.type === 'decl' && ['transform', 'translate', 'scale'].includes(node.prop),
          )
        )
          report(rule, `global button geometry changes hit areas: ${selector}`);
        if (!ownedFile) continue;
        if (/\.view-content\b|\.is-expanded\b|\.is-home\b/.test(selector))
          report(rule, `shell/obsolete variant dependency in ${selector}`);
        const key = `${conditions} :: ${selector}`;
        if (ownedSelectors.has(key))
          report(rule, `duplicate selector ${selector}; edit ${ownedSelectors.get(key)}`);
        else ownedSelectors.set(key, `${filename}:${rule.source.start.line}`);
      }
      const properties = new Set();
      for (const declaration of rule.nodes.filter((node) => node.type === 'decl')) {
        if (ownedFile) {
          if (declaration.important)
            report(declaration, `!important hides the owning rule: ${rule.selector}`);
          if (properties.has(declaration.prop))
            report(declaration, `duplicate ${declaration.prop} in ${rule.selector}`);
          properties.add(declaration.prop);
          continue;
        }
        // Same-rule fallbacks and an earlier !important remain valid in legacy CSS.
        const key = `${filename} :: ${conditions} :: ${rule.selector} :: ${declaration.prop}`;
        const earlier = seen.get(key);
        if (earlier && earlier.parent !== rule && (!earlier.important || declaration.important))
          shadowed.push(earlier);
        if (!earlier?.important || declaration.important) seen.set(key, declaration);
      }
    });
  }
  return { problems, shadowed, roots };
}

function readStyles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return readStyles(path.join(directory, entry.name), `${relative}/`);
    return entry.name.endsWith('.css')
      ? [[relative, fs.readFileSync(path.join(directory, entry.name), 'utf8')]]
      : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, shadowed, roots } = inspectStyles(readStyles(sourceRoot));
  if (process.argv.includes('--fix')) {
    for (const declaration of shadowed) declaration.remove();
    for (const [filename, root] of roots) {
      root.walkRules((rule) => {
        if (rule.nodes.length === 0) rule.remove();
      });
      fs.writeFileSync(path.join(sourceRoot, filename), root.toString());
    }
    console.log(
      `Removed ${shadowed.length} shadowed legacy declarations. Ownership errors require an explicit source edit.`,
    );
  } else {
    for (const declaration of shadowed)
      problems.push(
        `${declaration.source.input.file}:${declaration.source.start.line}: ${declaration.parent.selector} repeats ${declaration.prop} later in the same condition`,
      );
  }
  if (problems.length) {
    problems.forEach((message) => console.error(message));
    process.exitCode = 1;
  } else console.log('Web style ownership and cascade check passed.');
}
