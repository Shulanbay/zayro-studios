/** Data a landing page needs besides its blocks (live prices, studio setups, messenger links). */
import { getActiveServices } from '@/lib/catalogData';
import { getPublicSetups } from '@/lib/setupCatalog';
import type { LandingContext } from '@/components/marketing/LandingRenderer';
import type { ContentBlock } from './blocks';
import { getMarketingSettings, messengerLinks } from './settings';

export async function landingContext(slug: string, blocks: ContentBlock[]): Promise<LandingContext> {
  const needsServices = blocks.some((b) => b.type === 'packages' && b.source === 'catalog');
  const needsSetups = blocks.some((b) => b.type === 'setups' && b.source === 'studio');
  const [services, setups, settings] = await Promise.all([
    needsServices ? getActiveServices().catch(() => []) : Promise.resolve([]),
    needsSetups ? getPublicSetups('podcast') : Promise.resolve([]),
    getMarketingSettings(),
  ]);
  return { slug, services, setups, messengers: messengerLinks(settings, 'Hi! I have a question about ZAYRO Studios.') };
}
