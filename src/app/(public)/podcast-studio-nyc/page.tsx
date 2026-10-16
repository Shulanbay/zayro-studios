import type { Metadata } from 'next';
import ServiceLandingPage from '@/components/sections/ServiceLandingPage';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Podcast Studio NYC | Midtown Manhattan Recording Studio',
  description: 'Book a professional podcast studio in Midtown Manhattan with 4K multi-camera video, Shure microphones, studio lighting and an on-site technician.',
  path: '/podcast-studio-nyc',
});

const highlights = [
  { title: '4K multi-camera video', description: 'Capture dynamic podcast and interview footage with Sony cinema and mirrorless cameras.' },
  { title: 'Broadcast-quality audio', description: 'Record clear voices with Shure SM7B microphones and professional audio mixing.' },
  { title: 'Camera-ready sets', description: 'Choose from four furnished podcast setups designed to look polished on camera.' },
  { title: 'Professional lighting', description: 'Arrive to a studio prepared with flattering, production-ready lighting.' },
  { title: 'On-site support', description: 'Podcast Pro includes a producer or technician to run the recording session.' },
  { title: 'Editing available', description: 'Choose the Full Podcast Package or request post-production for another session.' },
] as const;

const idealFor = ['Video podcasts', 'Interviews', 'YouTube shows', 'Branded content', 'Online courses', 'Executive thought leadership'] as const;
const process = [
  { title: 'Choose your session', description: 'Compare recording options and select the production level you need.' },
  { title: 'Pick a live time', description: 'Choose an available date and time in our online booking calendar.' },
  { title: 'Select your set', description: 'Choose the studio look that fits your show and audience.' },
  { title: 'Arrive and record', description: 'We prepare the cameras, microphones and lighting before your session.' },
] as const;

export default function PodcastStudioNycPage() {
  return (
    <ServiceLandingPage
      path="/podcast-studio-nyc"
      eyebrow="Podcast recording studio · Midtown NYC"
      title="Podcast Studio in NYC"
      intro="Record a professional audio or video podcast in the heart of Midtown Manhattan. Walk into a camera-ready set with 4K cameras, broadcast microphones, studio lighting and technical support available."
      image="/setups/cream-lounge.webp"
      imageAlt="Cream Lounge podcast recording set at ZAYRO Studios in Midtown Manhattan"
      serviceName="Podcast Studio Rental in New York City"
      serviceDescription="ZAYRO Studios is a professional podcast recording studio at 40 W 37th Street in Midtown Manhattan. Our flexible sessions support solo podcasts, two-person interviews and multi-camera video podcast production, with raw files included and editing available."
      primaryHref="/booking?category=podcast"
      primaryLabel="Check Availability"
      highlights={highlights}
      idealFor={idealFor}
      process={process}
      relatedTitle="video production studio rental"
      relatedCopy="for interviews, courses and branded video content."
      relatedHref="/video-production-studio-nyc"
    />
  );
}
