import { BadRequestException } from '@nestjs/common';

interface GroupRule {
  id: string;
  name: string;
  min_selection: number;
  max_selection: number;
  is_required: boolean;
}

interface Choice {
  id: string;
  name: string;
  option_group_id: string;
}

/**
 * Whether a line's add-on choices fit the product: every choice comes from a group on the
 * product, the product has not left it out, and each group's minimum and maximum hold. A
 * burger whose bread choice is required cannot reach the kitchen without one, the same as a
 * combo without its drink. Answers the group names, which the order line keeps with each choice.
 *
 * Pure, so the POS order path and the kiosk apply the same rules to what they each loaded.
 */
export function checkOptionChoices(
  product: { name: string; product_type?: string },
  links: Array<{ option_group_id: string; excluded_item_ids?: string[] | null }>,
  groups: GroupRule[],
  choices: Choice[],
): Map<string, string> {
  const code = product.product_type === 'COMBO' ? 'COMBO_CHOICES_INVALID' : 'OPTION_CHOICES_INVALID';
  const refuse = (message: string) => new BadRequestException({ statusCode: 400, code, message });

  const attached = groups.filter((g) => links.some((l) => l.option_group_id === g.id));
  const stray = choices.find((c) => !attached.some((g) => g.id === c.option_group_id));
  if (stray) throw refuse(`${stray.name} is not a choice in ${product.name}`);

  const excluded = new Set(links.flatMap((l) => l.excluded_item_ids || []));
  const left = choices.find((c) => excluded.has(c.id));
  if (left) {
    throw new BadRequestException({ statusCode: 400, code: 'OPTION_NOT_OFFERED', message: `${left.name} is not offered on ${product.name}` });
  }

  for (const group of attached) {
    const count = choices.filter((c) => c.option_group_id === group.id).length;
    const min = Math.max(group.min_selection || 0, group.is_required ? 1 : 0);
    if (count < min) throw refuse(`${product.name} needs ${min === 1 ? 'a' : min} ${group.name} choice${min === 1 ? '' : 's'}`);
    if (group.max_selection && count > group.max_selection) {
      throw refuse(`${product.name} takes at most ${group.max_selection} ${group.name} choice${group.max_selection === 1 ? '' : 's'}`);
    }
  }
  return new Map(attached.map((g) => [g.id, g.name]));
}
