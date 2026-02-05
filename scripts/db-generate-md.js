// scripts/db-generate-md.js
// Gera docs/db-schema.md a partir do YAML (fonte única).
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

function main() {
  const ymlPath = path.join(process.cwd(), "docs", "db-schema.yml");
  const outPath = path.join(process.cwd(), "docs", "db-schema.md");

  if (!fs.existsSync(ymlPath)) {
    console.error("❌ Não achei docs/db-schema.yml");
    process.exit(1);
  }

  const doc = yaml.load(fs.readFileSync(ymlPath, "utf8"));
  const tables = doc?.tables || {};

  let md = `# Meta-Lav Pagamentos — Quadro Rígido do Banco (gerado)\n\n`;
  md += `**Fonte da verdade:** \`docs/db-schema.yml\`\n\n`;
  md += `## Regras\n`;
  (doc?.conventions?.rule || []).forEach((r) => (md += `- ${r}\n`));
  md += `\n---\n`;

  const entries = Object.entries(tables);

  for (const [key, t] of entries) {
    md += `\n## ${key}\n`;
    md += `- **table:** \`${t.table}\`\n`;
    md += `- **canonical/runtime:** ${t.canonical ? "✅" : "❌"} / ${t.runtime ? "✅" : "❌"}\n`;
    if (t.read_only) md += `- **read_only:** ✅\n`;
    if (t.purpose) md += `- **purpose:** ${t.purpose}\n`;

    if (t.enums) {
      md += `\n### Enums\n`;
      for (const [ename, e] of Object.entries(t.enums)) {
        md += `- **${ename}** (\`${e.enum_name}\`): ${e.values.join(", ")}\n`;
        if (e.note) md += `  - _note:_ ${e.note}\n`;
      }
    }

    if (t.columns) {
      md += `\n### Colunas\n`;
      md += `| coluna | tipo | required |\n|---|---|---|\n`;
      for (const [c, meta] of Object.entries(t.columns)) {
        md += `| \`${mdEscape(c)}\` | \`${mdEscape(meta.type)}\` | ${meta.required ? "✅" : "❌"} |\n`;
      }
    }

    if (t.examples) {
      md += `\n### Queries úteis\n`;
      for (const [n, q] of Object.entries(t.examples)) {
        md += `\n**${n}**\n\n\`\`\`sql\n${q.trim()}\n\`\`\`\n`;
      }
    }

    if (t.rules) {
      md += `\n### Regras\n`;
      t.rules.forEach((r) => (md += `- ${r}\n`));
    }

    md += `\n---\n`;
  }

  fs.writeFileSync(outPath, md, "utf8");
  console.log("✅ Gerado:", outPath);
}

main();
