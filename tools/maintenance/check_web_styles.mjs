/** Find declarations shadowed by a later identical selector in the same CSS condition. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const postcss = require('postcss');
const stylesheet = fileURLToPath(new URL('../../apps/web/src/styles.css', import.meta.url));
const root = postcss.parse(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet });
const seen = new Map();
const shadowed = [];

root.walkRules((rule) => {
  const conditions = [];
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
    if (parent.name?.endsWith('keyframes')) return;
    conditions.unshift(`@${parent.name} ${parent.params}`);
  }
  const selector = `${conditions.join(' / ')} :: ${rule.selector}`;
  for (const declaration of rule.nodes.filter((node) => node.type === 'decl')) {
    const key = `${selector} :: ${declaration.prop}`;
    const earlier = seen.get(key);
    // Preserve same-rule fallbacks and an earlier !important overriding normal values.
    if (earlier?.parent !== rule && earlier && (!earlier.important || declaration.important)) {
      shadowed.push(earlier);
    }
    if (!earlier?.important || declaration.important) seen.set(key, declaration);
  }
});

if (process.argv.includes('--fix')) {
  for (const declaration of shadowed) declaration.remove();
  root.walkRules((rule) => {
    if (rule.nodes.length === 0) rule.remove();
  });
  fs.writeFileSync(stylesheet, root.toString());
  console.log(`Removed ${shadowed.length} shadowed CSS declarations.`);
} else if (shadowed.length > 0) {
  for (const declaration of shadowed) {
    console.error(
      `styles.css:${declaration.source.start.line}: ${declaration.parent.selector} repeats ${declaration.prop} later in the same condition`,
    );
  }
  process.exitCode = 1;
} else {
  console.log('Web style cascade check passed.');
}
