/**
 * Gnext Prototype v1.5 — Lightweight Feature Registry
 * Controls feature metadata, scope status, and V5 Preview classification.
 */

export interface FeatureRegistryItem {
  id: string;
  version: 'v1.5' | 'V5 Preview';
  status: 'ACTIVE' | 'V5_PREVIEW';
  labelKey: string;
  isV5Preview: boolean;
}

export const FEATURE_REGISTRY: Record<string, FeatureRegistryItem> = {
  inventory: {
    id: 'inventory',
    version: 'V5 Preview',
    status: 'V5_PREVIEW',
    labelKey: 'nav.v5Preview',
    isV5Preview: true,
  },
};

export function getFeature(featureId: string): FeatureRegistryItem | undefined {
  return FEATURE_REGISTRY[featureId];
}

export function isV5PreviewFeature(featureId: string): boolean {
  return !!FEATURE_REGISTRY[featureId]?.isV5Preview;
}
