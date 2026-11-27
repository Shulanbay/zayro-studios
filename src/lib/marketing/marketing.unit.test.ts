/**
 * Marketing hub building blocks without a database: tracking-code parsing
 * and checks, landing-page block schemas and templates, slug rules, the ad
 * spend CSV parser and ChatGPT / AI-assistant attribution.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'fs';

vi.mock('@/lib/db', () => ({ db: {} }));

const { checkSnippet, inspectSnippet, parseScripts, verificationFromHtml, cleanVerificationTags, CUSTOM_CODE_EXCLUDED } = await import('./scripts');
const { contentBlock, contentBlocks, BLOCK_TYPES, emptyBlock, PAGE_TEMPLATES, templateBlocks, readBlocks, isEmptyBlock, safeHref, safeImage } = await import('./blocks');
const { RESERVED_SLUGS, slugProblem, slugify } = await import('./pages');
const { parseSpendCsv, SPEND_PLATFORMS } = await import('./spendCsv');
const { whatsappDigits, telegramHandle, messengerLinks } = await import('./settings');
const { classifyTouch } = await import('@/lib/analytics/attribution');

const GTM = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-AB12CD3');</script>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-AB12CD3" height="0" width="0"></iframe></noscript>`;

const META = `<script>!function(f,b,e,v,n,t,s){}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '123456789012345');
fbq('track', 'PageView');</script>`;

describe('tracking code', () => {
  it('names what a snippet loads, with its IDs', () => {
    expect(inspectSnippet(GTM)).toEqual([{ vendor: 'Google Tag Manager', ids: ['GTM-AB12CD3'] }]);
    expect(inspectSnippet(META)).toEqual([{ vendor: 'Meta Pixel', ids: ['123456789012345'] }]);
    expect(inspectSnippet('<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script><script>gtag("config", "G-ABC1234");</script>').map((v) => v.vendor)).toContain('Google Analytics 4');
    expect(inspectSnippet('<script>ttq.load("C4ABCDEFGHIJKL12");</script>')[0]).toMatchObject({ vendor: 'TikTok Pixel', ids: ['C4ABCDEFGHIJKL12'] });
    expect(inspectSnippet('')).toEqual([]);
  });

  it('blocks broken code and warns about what will be skipped', () => {
    expect(checkSnippet('<script>alert(1)')).toContainEqual({ level: 'error', code: 'unbalanced' });
    expect(checkSnippet('<div>hello</div>')).toContainEqual({ level: 'error', code: 'no_script' });
    expect(checkSnippet('x'.repeat(30_001)).map((p) => p.code)).toContain('too_long');
    const gtm = checkSnippet(GTM);
    expect(gtm.filter((p) => p.level === 'error')).toEqual([]);
    expect(gtm.map((p) => p.code)).toContain('noscript_dropped');
    expect(checkSnippet('<script>document.write("x")</script>').map((p) => p.code)).toContain('document_write');
    expect(checkSnippet('<script>1</script><img src="https://x.test/p.gif">').map((p) => p.code)).toContain('html_ignored');
    expect(checkSnippet('')).toEqual([]);
  });

  it('warns when a snippet duplicates a built-in integration (double counting)', () => {
    expect(checkSnippet(META, [{ vendor: 'Meta Pixel', configured: true }])).toContainEqual({ level: 'warning', code: 'duplicate_builtin', detail: 'Meta Pixel' });
    expect(checkSnippet(META, [{ vendor: 'Meta Pixel', configured: false }]).map((p) => p.code)).not.toContain('duplicate_builtin');
  });

  it('injects only <script> elements: https sources, safe attributes, no noscript, no data blocks', () => {
    const scripts = parseScripts(
      GTM +
        `<script async src="https://cdn.example.com/a.js" onload="steal()" data-id="7"></script>` +
        `<script src="http://insecure.example.com/b.js"></script>` +
        `<script type="application/ld+json">{"@type":"Thing"}</script>` +
        `<iframe src="https://evil.test"></iframe>`
    );
    expect(scripts).toHaveLength(2);
    expect(scripts[0].inline).toContain('GTM-AB12CD3');
    expect(scripts[1]).toEqual({ src: 'https://cdn.example.com/a.js', inline: null, attributes: { async: '', 'data-id': '7' } });
    expect(JSON.stringify(scripts)).not.toMatch(/onload|insecure|ld\+json|iframe|ns\.html/);
  });

  it('never runs on the booking and package checkout pages', () => {
    for (const p of ['/booking', '/booking/success', '/packages/buy', '/packages/buy/12']) expect(CUSTOM_CODE_EXCLUDED.test(p), p).toBe(true);
    for (const p of ['/', '/pricing', '/packages', '/spring-promo', '/bookings-guide']) expect(CUSTOM_CODE_EXCLUDED.test(p), p).toBe(false);
  });

  it('reads verification meta tags and rejects anything that is not a plain token', () => {
    expect(verificationFromHtml('<meta name="google-site-verification" content="abc_DEF-123" /><meta name="facebook-domain-verification" content="xyz987" />')).toEqual([
      { name: 'google-site-verification', content: 'abc_DEF-123' },
      { name: 'facebook-domain-verification', content: 'xyz987' },
    ]);
    expect(cleanVerificationTags([{ name: 'x"><script>', content: 'a' }, { name: 'p:domain_verify', content: '"><b>' }, 'junk'])).toEqual([]);
  });
});

describe('landing page blocks', () => {
  it('every block type starts valid and every template validates', () => {
    for (const type of BLOCK_TYPES) expect(contentBlock.safeParse(emptyBlock(type)).success, type).toBe(true);
    for (const tpl of PAGE_TEMPLATES) {
      const blocks = templateBlocks(tpl);
      expect(contentBlocks.safeParse(blocks).success, tpl).toBe(true);
      expect(blocks.some((b) => b.type === 'hero'), tpl).toBe(true);
      // No invented social proof: templates never ship reviews.
      for (const b of blocks) if (b.type === 'testimonials') expect(b.items, tpl).toEqual([]);
    }
  });

  it('allows only safe links and images', () => {
    for (const ok of ['/booking', '/booking?category=tour', '#contact', 'https://wa.me/12125550100', 'tel:+1 212 555 0100', 'mailto:hello@zayro.studio', '']) expect(safeHref.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['javascript:alert(1)', 'http://example.com', '//evil.test', 'data:text/html,x', 'vbscript:x']) expect(safeHref.safeParse(bad).success, bad).toBe(false);
    expect(safeImage.safeParse('/setups/sofa-lounge.webp').success).toBe(true);
    expect(safeImage.safeParse('javascript:alert(1)').success).toBe(false);
    expect(safeImage.safeParse('/setups/x.html').success).toBe(false);
  });

  it('drops a stored block that no longer validates instead of crashing the page', () => {
    const good = emptyBlock('text');
    expect(readBlocks([good, { type: 'hero', id: 'BAD id' }, null, 'x'])).toEqual([good]);
    expect(readBlocks('not json')).toEqual([]);
  });

  it('hides blocks that would render empty', () => {
    expect(isEmptyBlock(emptyBlock('faq'))).toBe(true);
    expect(isEmptyBlock(emptyBlock('packages'))).toBe(false); // live catalogue
    expect(isEmptyBlock({ ...emptyBlock('gallery'), videoUrl: 'https://youtu.be/abc123' } as never)).toBe(false);
  });
});

describe('page addresses', () => {
  it('reserves every existing site route', () => {
    const routes = [...readdirSync('src/app'), ...readdirSync('src/app/(public)'), ...readdirSync('src/app/(booking)')]
      .filter((n) => !n.includes('.') && !n.startsWith('(') && !n.startsWith('['))
      .map((n) => n.toLowerCase());
    for (const r of routes) expect(RESERVED_SLUGS.has(r), r).toBe(true);
  });

  it('validates and builds slugs', () => {
    expect(slugProblem('spring-promo')).toBeNull();
    expect(slugProblem('home')).toBeNull();
    expect(slugProblem('booking')).toBe('reserved');
    expect(slugProblem('Spring Promo')).toBe('invalid');
    expect(slugProblem('-x')).toBe('invalid');
    expect(slugify('  Spring Podcast Promo — NYC!  ')).toBe('spring-podcast-promo-nyc');
  });
});

describe('messenger links', () => {
  it('normalises WhatsApp numbers and Telegram usernames', () => {
    expect(whatsappDigits('+1 (212) 555-0100')).toBe('12125550100');
    expect(whatsappDigits('123')).toBeNull();
    expect(telegramHandle('@zayro_studios')).toBe('zayro_studios');
    expect(telegramHandle('https://t.me/zayro_studios')).toBe('zayro_studios');
    expect(telegramHandle('bad name')).toBeNull();
    expect(messengerLinks({ whatsapp_number: '+1 212 555 0100', telegram_username: 'zayro_studios' }, 'Hi')).toEqual({ whatsapp: 'https://wa.me/12125550100?text=Hi', telegram: 'https://t.me/zayro_studios' });
  });
});

describe('ad spend CSV', () => {
  it('reads exports with a header, aliases, $ and thousands separators; reports bad lines', () => {
    const { rows, bad } = parseSpendCsv('Date,Platform,Campaign,Amount,Clicks,Impressions\n2026-11-20,Facebook,spring_promo,"$1,045.20",310,12000\n2026-11-20\tGoogle Ads\tbrand\t18\t\t\n2026-13-01,meta,x,1\n2026-11-21,myspace,x,1\n2026-11-21,tiktok,x,-5');
    expect(rows).toEqual([
      { date: '2026-11-20', platform: 'meta', campaign: 'spring_promo', amount: 1045.2, clicks: 310, impressions: 12000 },
      { date: '2026-11-20', platform: 'google', campaign: 'brand', amount: 18, clicks: null, impressions: null },
    ]);
    expect(bad).toEqual([4, 5, 6]);
    expect(SPEND_PLATFORMS).toContain('chatgpt');
  });
});

describe('ChatGPT and AI-assistant traffic', () => {
  it('paid ChatGPT ads are their own platform; AI-assistant referrals are not lumped into organic search', () => {
    expect(classifyTouch({ utm: { utm_source: 'chatgpt', utm_medium: 'cpc', utm_campaign: 'spring' }, clickIdTypes: [], referrerHost: null })).toMatchObject({ platform: 'chatgpt' });
    const ai = classifyTouch({ utm: {}, clickIdTypes: [], referrerHost: 'chatgpt.com' });
    expect(ai.platform).toBe('ai');
    expect(classifyTouch({ utm: {}, clickIdTypes: [], referrerHost: 'www.perplexity.ai' }).platform).toBe('ai');
    expect(classifyTouch({ utm: {}, clickIdTypes: [], referrerHost: 'www.google.com' }).platform).toBe('organic');
  });

  it('the site itself is never a referrer, with or without a port', async () => {
    const { referrerHost } = await import('@/lib/analytics/attribution');
    expect(referrerHost('http://localhost:3000/', 'localhost:3000')).toBeNull();
    expect(referrerHost('https://www.zayro.studio/pricing', 'zayro.studio')).toBeNull();
    expect(referrerHost('https://l.facebook.com/', 'zayro.studio')).toBe('l.facebook.com');
  });
});
