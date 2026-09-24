import type { OutputItem } from './utils';

import { useTranslation } from 'react-i18next';

import { useIsSettingOnOffer, useSettingsCatalogue } from 'src/config/settings-catalogue';

/**
 * The Settings Hub's cards as search results. Most settings have no sidebar link, so a
 * search that knew only the sidebar sent "Business Day" to the Business Days report and
 * could not find Calendar or Note Templates at all. Filtered the way the hub is.
 */
export function useSettingsSearchItems(): OutputItem[] {
  const { t } = useTranslation();
  const catalogue = useSettingsCatalogue();
  const isOnOffer = useIsSettingOnOffer();
  const hub = t('nav.settingsHub', 'Settings Hub');

  return catalogue.flatMap((category) =>
    category.items
      .filter((item) => isOnOffer(item.path))
      .map((item) => ({
        title: item.title,
        path: item.path,
        group: `${hub}.${category.categoryTitle}`,
        keywords: [item.description, ...item.tags],
      }))
  );
}
