import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "prisma", "schema.prisma");
let source = fs.readFileSync(file, "utf8");
source = source.replace(/enum\s+(\w+)\s*\{\s*([^{}\n]+?)\s*\}/g, (_, name, values) => {
  const items = values.trim().split(/\s+/).filter(Boolean);
  return `enum ${name} {\n${items.map((item) => `  ${item}`).join("\n")}\n}`;
});
fs.writeFileSync(file, source);
