import type { TFunction } from 'i18next';

type Rule = { min_selection?: number | null; max_selection?: number | null };

/** The least a guest must pick; above zero the group is required and the POS asks for it. */
export const addonMin = (g: Rule) => g.min_selection || 0;

/** A pick-one group (bread, drink) is chosen like a radio; the rest are ticked like checkboxes. */
export const isPickOne = (g: Rule) => g.max_selection === 1;

/** The group's rule in words, as the product page and the POS show it. */
export function addonRuleLabel(t: TFunction, g: Rule): string {
  const min = addonMin(g);
  const max = g.max_selection || 0;
  if (min > 0) {
    if (max === min) return t('catalog.addonRule.requiredExactly', { n: min });
    return t('catalog.addonRule.requiredBetween', { min, max });
  }
  return t('catalog.addonRule.optionalUpTo', { n: max });
}
