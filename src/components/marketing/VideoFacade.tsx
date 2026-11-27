'use client';

import { useState } from 'react';

/** YouTube / Vimeo embed that loads only when the visitor presses play (no third-party request before). */
export function embedUrl(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0`;
  const vm = /vimeo\.com\/(?:video\/)?(\d{5,12})/.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1&dnt=1`;
  return null;
}

export default function VideoFacade({ url, title }: { url: string; title: string }) {
  const [play, setPlay] = useState(false);
  const src = embedUrl(url);
  if (!src) return null;
  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden bg-zayro-dark">
      {play ? (
        <iframe src={src} title={title} className="absolute inset-0 w-full h-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      ) : (
        <button type="button" onClick={() => setPlay(true)} className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3 text-white" data-analytics-cta="play-video">
          <span className="w-16 h-16 rounded-full bg-white/90 text-zayro-dark flex items-center justify-center text-2xl" aria-hidden="true">
            ▶
          </span>
          <span className="text-sm text-white/80">Play video (loads {src.includes('vimeo') ? 'Vimeo' : 'YouTube'})</span>
        </button>
      )}
    </div>
  );
}
