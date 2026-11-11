// Test/tooling entry point: loads all libs into one namespace exactly as the
// n8n build inlines them (libs reference each other as globals there).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORDER = [
  'phone.js', 'templating.js', 'compliance.js', 'scoring.js', 'state_machine.js',
  'guardrails.js', 'cadence.js', 'prompt_builder.js', 'turn_processor.js', 'email_parse.js', 'slots.js',
];

function loadLibs() {
  const sandbox = { Intl, Date, Math, JSON, console, module: undefined };
  vm.createContext(sandbox);
  const src = ORDER.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, sandbox, { filename: 'lre-libs.js' });
  return sandbox;
}

module.exports = { loadLibs, ORDER };
