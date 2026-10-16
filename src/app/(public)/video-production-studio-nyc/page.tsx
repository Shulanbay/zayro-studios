import type { Metadata } from 'next';
import ServiceLandingPage from '@/components/sections/ServiceLandingPage';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Video Production Studio NYC | Filming Studio in Manhattan',
  description: 'Rent a Midtown Manhattan video recording and filming studio with 4K cameras, professional lighting, microphones, green screen and flexible sets.',
  path: '/video-production-studio-nyc',
});

const highlights = [
  { title: '4K video recording', description: 'Film with Sony FX30 and A7IV cameras for crisp interviews and creator content.' },
  { title: 'Professional sound', description: 'Capture dialogue with broadcast microphones and professional audio mixing.' },
  { title: 'Flexible filming sets', description: 'Use a furnished interior, custom studio backdrop or professional green screen.' },
  { title: 'Studio lighting', description: 'Shape a clean, cinematic image with production lighting already in the space.' },
  { title: 'Central NYC location', description: 'Create near Herald Square, Bryant Park and major Midtown transit connections.' },
  { title: 'Post-production options', description: 'Ask about editing when your project needs a finished, publish-ready video.' },
] as const;

const idealFor = ['Video interviews', 'YouTube content', 'Online courses', 'Product explainers', 'Social media videos', 'Personal brand content'] as const;
const process = [
  { title: 'Tell us what you are filming', description: 'Choose a recording session or contact us for a custom production requirement.' },
  { title: 'Choose your time', description: 'Reserve available studio time through the online booking flow.' },
  { title: 'Confirm the setup', description: 'Select a furnished set, backdrop or green-screen direction for your shoot.' },
  { title: 'Film in Midtown', description: 'Arrive at the studio ready to record with professional equipment on site.' },
] as const;

export default function VideoProductionStudioNycPage() {
  return (
    <ServiceLandingPage
      path="/video-production-studio-nyc"
      eyebrow="Video recording and filming · Midtown Manhattan"
      title="Video Production Studio in NYC"
      intro="Rent a professional Midtown Manhattan filming studio for interviews, YouTube videos, courses and branded content. Record with 4K cameras, broadcast audio, flexible sets and studio lighting."
      image="/setups/library-table.webp"
      imageAlt="Professional interview and video filming set at ZAYRO Studios in Manhattan"
      serviceName="Video Production and Filming Studio Rental in New York City"
      serviceDescription="ZAYRO Studios provides a practical video recording and filming space in central Manhattan for creator, business and educational content. The studio offers 4K cameras, professional audio and lighting, furnished sets, backdrop options and green-screen capability."
      primaryHref="/contact?topic=Video%20production"
      primaryLabel="Plan Your Video Shoot"
      highlights={highlights}
      idealFor={idealFor}
      process={process}
      relatedTitle="podcast studio rental in NYC"
      relatedCopy="for solo shows, interviews and multi-camera video podcasts."
      relatedHref="/podcast-studio-nyc"
    />
  );
}
