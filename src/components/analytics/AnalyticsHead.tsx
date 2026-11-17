import { CONSENT_COOKIE, CONSENT_VERSION } from '@/lib/analytics/consent';
import type { PublicAnalyticsConfig } from '@/lib/analytics/server/config';

/**
 * Runs first in <head>, before any Google or advertising tag:
 *  1. Google Consent Mode v2 defaults — everything denied;
 *  2. the visitor's stored choice (zayro_consent cookie), applied at once so
 *     returning visitors are measured from the first page;
 *  3. Google Tag Manager, loaded exactly once, only if a container ID is
 *     configured, never on admin, API or Manage Booking pages.
 * Advertising pixels are not loaded here; the client loads them only after
 * Advertising consent.
 */
export default function AnalyticsHead({ config }: { config: PublicAnalyticsConfig }) {
  const gtm = config.gtmId ? JSON.stringify(config.gtmId) : 'null';
  const script = `
window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments);};
gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',wait_for_update:500});
gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',false);
(function(){try{var m=document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]+)/);if(!m)return;var p=decodeURIComponent(m[1]).split('~');
if(p.length!==6||p[0]!=='v1'||p[1]!==${JSON.stringify(CONSENT_VERSION)})return;var a=p[3]==='a1'?'granted':'denied',d=p[4]==='d1'?'granted':'denied';
gtag('consent','update',{analytics_storage:a,ad_storage:d,ad_user_data:d,ad_personalization:d});}catch(e){}})();
(function(id){if(!id||window.__zayroGtm||/^\\/(admin|api|booking\\/manage)(\\/|$)/.test(location.pathname))return;window.__zayroGtm=1;
dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});var s=document.createElement('script');s.async=true;
s.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(id);document.head.appendChild(s);})(${gtm});`;
  // eslint-disable-next-line react/no-danger
  return <script id="zayro-consent-defaults" dangerouslySetInnerHTML={{ __html: script }} />;
}
