/**
 * All admin-panel translations. Add a namespace by creating a file with
 * `defineMessages({ en, ru, kk })` and listing it in NAMESPACES.
 */
import type { AdminLocale } from '../config';
import type { MessageKeys } from '../core';
import { common } from './common';
import { login } from './login';
import { analytics } from './analytics';
import { values } from './values';
import { dashboard } from './dashboard';
import { sessions } from './sessions';
import { customers } from './customers';
import { purchases } from './purchases';
import { packages } from './packages';
import { services } from './services';
import { availability } from './availability';
import { team } from './team';
import { system } from './system';
import { integrations } from './integrations';
import { calendar } from './calendar';
import { marketing } from './marketing';
import { pages } from './pages';
import { tracking } from './tracking';
import { spend } from './spend';
import { utm } from './utm';

const NAMESPACES = { common, login, analytics, values, dashboard, sessions, customers, purchases, packages, services, availability, team, system, integrations, calendar, marketing, pages, tracking, spend, utm };

type Namespaces = typeof NAMESPACES;
export type AdminMessages = { [N in keyof Namespaces]: Namespaces[N]['en'] };
export type AdminMessageKey = MessageKeys<AdminMessages>;

function build(locale: AdminLocale) {
  const out: Record<string, unknown> = {};
  for (const [name, ns] of Object.entries(NAMESPACES)) out[name] = ns[locale];
  return out;
}

export const MESSAGES: Record<AdminLocale, unknown> = { en: build('en'), ru: build('ru'), kk: build('kk') };
export const NAMESPACE_NAMES = Object.keys(NAMESPACES);
