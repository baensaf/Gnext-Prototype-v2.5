import type { TFunction } from 'i18next';

type Rule = { min_selection?: number | null; max_selection?: number | null; is_required?: boolean };

/** The least a guest must pick: a group marked required asks for at least one. */
export const addonMin = (g: Rule) => Math.max(g.min_selection || 0, g.is_required ? 1 : 0);

/** A pick-one group (bread, drink) is chosen like a radio; the rest are ticked like checkboxes. */
export const isPickOne = (g: Rule) => g.max_selection === 1;

/** The group's rule in words, as the add-ons page, the product page and the POS show it. */
export function addonRuleLabel(t: TFunction, g: Rule): string {
  const min = addonMin(g);
  const max = g.max_selection || 0;
  if (min > 0) {
    if (max === min) return t('catalog.addonRule.requiredExactly', { n: min });
    if (max === 0) return t('catalog.addonRule.requiredAtLeast', { n: min });
    return t('catalog.addonRule.requiredBetween', { min, max });
  }
  if (max === 0) return t('catalog.addonRule.optionalAny');
  return t('catalog.addonRule.optionalUpTo', { n: max });
}
