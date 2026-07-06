import YAML from "yaml";

export type PropertyValue = string | number | boolean | string[] | null;

export interface Property {
  key: string;
  value: PropertyValue;
}

/** Parse raw frontmatter YAML into an ordered list of properties. */
export function parseProperties(raw: string | null): Property[] {
  if (!raw) return [];
  try {
    const doc = YAML.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
    return Object.entries(doc).map(([key, value]) => ({
      key,
      value: value as PropertyValue,
    }));
  } catch {
    return [];
  }
}

/** Serialize properties back to YAML (no fences). */
export function serializeProperties(props: Property[]): string {
  const obj: Record<string, PropertyValue> = {};
  for (const p of props) obj[p.key] = p.value;
  return YAML.stringify(obj).trimEnd();
}

/** Recombine frontmatter YAML + body into full file content. */
export function combine(frontmatter: string | null, body: string): string {
  if (frontmatter == null || frontmatter.trim() === "") return body;
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\n+/, "")}`;
}
