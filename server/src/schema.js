// Form mode `requestedSchema` (MCP 2025-11-25, client/elicitation): a FLAT object whose properties are primitives only:
// string (minLength, maxLength, pattern, format email|uri|date|date-time, default), number/integer (minimum, maximum, default),
// boolean (default), enum (enum, or oneOf with const/title) and multi-select enum (array with items.enum or items.anyOf, minItems, maxItems).
// Nested objects, arrays of objects and other JSON Schema features are intentionally unsupported.
// Note: the draft's string example drops `pattern`; this lab accepts it because 2025-11-25 lists it.
const FORMATS = ['email', 'uri', 'date', 'date-time'];
const STRING_KEYS = ['type', 'title', 'description', 'minLength', 'maxLength', 'pattern', 'format', 'default', 'enum', 'oneOf'];
const NUMBER_KEYS = ['type', 'title', 'description', 'minimum', 'maximum', 'default'];
const BOOL_KEYS = ['type', 'title', 'description', 'default'];
const ARRAY_KEYS = ['type', 'title', 'description', 'minItems', 'maxItems', 'items', 'default'];

// Problems that make a schema NOT conform to the restricted subset (an empty list means it conforms). Server-side lint.
export function schemaProblems(schema) {
  const out = [];
  if (!schema || typeof schema !== 'object' || schema.type !== 'object' || typeof schema.properties !== 'object' || schema.properties === null) {
    return ['requestedSchema must be an object schema with properties'];
  }
  for (const [name, p] of Object.entries(schema.properties)) {
    if (!p || typeof p !== 'object') { out.push(`${name}: not a schema`); continue; }
    const allowed = p.type === 'string' ? STRING_KEYS : p.type === 'number' || p.type === 'integer' ? NUMBER_KEYS : p.type === 'boolean' ? BOOL_KEYS : p.type === 'array' ? ARRAY_KEYS : null;
    if (!allowed) { out.push(`${name}: type ${JSON.stringify(p.type)} is not a supported primitive (nested objects are not allowed)`); continue; }
    for (const k of Object.keys(p)) if (!allowed.includes(k)) out.push(`${name}: keyword "${k}" is not supported for ${p.type}`);
    if (p.type === 'string' && p.format !== undefined && !FORMATS.includes(p.format)) out.push(`${name}: format "${p.format}" is not supported (${FORMATS.join(', ')})`);
    if (p.type === 'array') {
      const it = p.items;
      const ok = it && typeof it === 'object' && ((it.type === 'string' && Array.isArray(it.enum)) || Array.isArray(it.anyOf));
      if (!ok) out.push(`${name}: arrays are only allowed as multi-select enums (items.enum or items.anyOf)`);
    }
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((r) => r in schema.properties))) out.push('required must list known properties');
  return out;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const FORMAT_CHECK = {
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => { try { return Boolean(new URL(s)); } catch { return false; } },
  date: isDate,
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)),
};
const enumValues = (p) => (p.enum ?? p.oneOf?.map((o) => o.const) ?? null);

// What a client (and a careful server) SHOULD do with a submitted form: check every value against the schema. { ok, errors: { field: message } }
export function validateContent(schema, content) {
  const errors = {};
  const c = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
  for (const r of schema.required ?? []) if (c[r] === undefined || c[r] === '' || c[r] === null) errors[r] = 'Required';
  for (const [name, p] of Object.entries(schema.properties)) {
    const v = c[name];
    if (v === undefined || v === '' || v === null) continue;
    const err = (() => {
      if (p.type === 'string') {
        if (typeof v !== 'string') return 'Must be text';
        if (p.minLength !== undefined && v.length < p.minLength) return `At least ${p.minLength} characters`;
        if (p.maxLength !== undefined && v.length > p.maxLength) return `At most ${p.maxLength} characters`;
        if (p.pattern !== undefined) { try { if (!new RegExp(p.pattern).test(v)) return 'Does not match the required pattern'; } catch { return 'Bad pattern'; } }
        if (p.format && FORMAT_CHECK[p.format] && !FORMAT_CHECK[p.format](v)) return `Not a valid ${p.format}`;
        const ev = enumValues(p);
        if (ev && !ev.includes(v)) return `Must be one of: ${ev.join(', ')}`;
      } else if (p.type === 'number' || p.type === 'integer') {
        if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number';
        if (p.type === 'integer' && !Number.isInteger(v)) return 'Must be a whole number';
        if (p.minimum !== undefined && v < p.minimum) return `At least ${p.minimum}`;
        if (p.maximum !== undefined && v > p.maximum) return `At most ${p.maximum}`;
      } else if (p.type === 'boolean') {
        if (typeof v !== 'boolean') return 'Must be true or false';
      } else if (p.type === 'array') {
        if (!Array.isArray(v)) return 'Must be a list';
        if (p.minItems !== undefined && v.length < p.minItems) return `Pick at least ${p.minItems}`;
        if (p.maxItems !== undefined && v.length > p.maxItems) return `Pick at most ${p.maxItems}`;
        const ev = p.items?.enum ?? p.items?.anyOf?.map((o) => o.const) ?? [];
        if (!v.every((x) => ev.includes(x))) return `Choices must be from: ${ev.join(', ')}`;
      }
      return null;
    })();
    if (err) errors[name] = err;
  }
  for (const k of Object.keys(c)) if (!(k in schema.properties)) errors[k] = 'Not a requested field';
  return { ok: Object.keys(errors).length === 0, errors };
}

// The form a client renders: one field per property, with defaults pre-populated (spec: clients that support defaults SHOULD pre-populate).
export function fieldsOf(schema) {
  return Object.entries(schema.properties).map(([name, p]) => ({
    name, label: p.title ?? name, description: p.description ?? null, required: (schema.required ?? []).includes(name),
    kind: p.type === 'array' ? 'multiselect' : enumValues(p) ? 'select' : p.type === 'integer' ? 'number' : p.type, // string|number|boolean|select|multiselect
    options: p.type === 'array' ? (p.items.enum ?? p.items.anyOf.map((o) => ({ value: o.const, label: o.title ?? o.const }))) : p.oneOf ? p.oneOf.map((o) => ({ value: o.const, label: o.title ?? o.const })) : p.enum ?? null,
    format: p.format ?? null, min: p.minimum ?? p.minLength ?? p.minItems ?? null, max: p.maximum ?? p.maxLength ?? p.maxItems ?? null,
    default: p.default ?? null,
  }));
}

export const defaultContent = (schema) => Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => p.default !== undefined).map(([k, p]) => [k, p.default]));
