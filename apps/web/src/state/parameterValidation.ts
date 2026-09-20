import type { EditableParameters } from '../contracts/desktop';
import { PARAMETER_SCHEMA } from '../data/presetCatalog.generated';

export interface ParameterRule {
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: ParameterRule;
  oneOf?: readonly ParameterRule[];
  anyOf?: readonly ParameterRule[];
}

export const PARAMETER_RULES: Record<keyof EditableParameters, ParameterRule> =
  PARAMETER_SCHEMA.properties;

function matchesRule(value: unknown, rule: ParameterRule): boolean {
  const alternatives = rule.anyOf ?? rule.oneOf;
  if (alternatives) return alternatives.some((item) => matchesRule(value, item));
  if (rule.enum && !rule.enum.includes(value)) return false;
  switch (rule.type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return (
        typeof value === 'string' &&
        Array.from(value).length >= (rule.minLength ?? 0) &&
        Array.from(value).length <= (rule.maxLength ?? Infinity) &&
        Array.from(value).every((char) => char >= ' ' || char === '\n' || char === '\t')
      );
    case 'integer':
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (rule.type !== 'integer' || Number.isInteger(value)) &&
        value >= (rule.minimum ?? -Infinity) &&
        value <= (rule.maximum ?? Infinity)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length >= (rule.minItems ?? 0) &&
        value.length <= (rule.maxItems ?? Infinity) &&
        value.every((item) => rule.items && matchesRule(item, rule.items))
      );
    default:
      return false;
  }
}

export function isParameterValue(key: keyof EditableParameters, value: unknown): boolean {
  // Existing version-one profiles use empty prompt text to mean inherited.
  if ((key === 'initial_prompt' || key === 'hotwords' || key === 'prefix') && value === '')
    return true;
  if (!matchesRule(value, PARAMETER_RULES[key])) return false;
  return (
    key !== 'temperature' ||
    !Array.isArray(value) ||
    value.every((item: number, index) => index === 0 || value[index - 1] < item)
  );
}

export function isParameterOverrides(value: unknown): value is Partial<EditableParameters> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      Object.hasOwn(PARAMETER_RULES, key) &&
      isParameterValue(key as keyof EditableParameters, item),
  );
}

export function isParameters(value: unknown): value is EditableParameters {
  return isParameterOverrides(value) && Object.keys(PARAMETER_RULES).every((key) => key in value);
}

export function sameParameter(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
