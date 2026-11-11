import Image from 'next/image';
import { PRIOR_WORK_DISCLOSURE, PRIOR_WORK_HEADING, type ShowcaseProject } from '@/lib/showcase';

/** Real projects only (lib/showcase.ts). Renders nothing while there are none. */
export default function ProjectsSection({ projects }: { projects: ShowcaseProject[] }) {
  if (projects.length === 0) return null;
  const atZayro = projects.filter((p) => p.location === 'zayro-midtown');
  const prior = projects.filter((p) => p.location === 'prior');
  const group = (title: string, list: ShowcaseProject[], disclosure?: string) =>
    list.length === 0 ? null : (
      <div className="mb-12 last:mb-0">
        <h2 className="text-[clamp(2rem,9vw,3rem)] md:text-6xl font-black text-zayro-dark mb-3">{title}</h2>
        {disclosure && <p className="text-zayro-gray mb-8">{disclosure}</p>}
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {list.map((p) => (
            <li key={p.slug} className="card !p-0 overflow-hidden">
              {p.image && (
                <div className="relative aspect-video bg-zayro-bg">
                  <Image src={p.image} alt={p.imageAlt || p.title} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" loading="lazy" />
                </div>
              )}
              <div className="p-6">
                <h3 className="text-xl font-black text-zayro-dark">{p.title}</h3>
                <p className="text-sm font-semibold text-zayro-primary mb-2">{p.client}</p>
                <p className="text-zayro-gray">{p.summary}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        {group('RECORDED AT ZAYRO', atZayro)}
        {group(PRIOR_WORK_HEADING, prior, PRIOR_WORK_DISCLOSURE)}
      </div>
    </section>
  );
}
