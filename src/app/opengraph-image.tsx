import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #101832 0%, #0B1220 70%)',
          color: 'white',
        }}
      >
        <div style={{ fontSize: 88, fontWeight: 900, letterSpacing: '0.05em', display: 'flex' }}>ZAYRO</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.4em', color: '#8ED8FF', marginTop: 12, display: 'flex' }}>
          STUDIOS
        </div>
        <div style={{ fontSize: 26, color: '#A7B0C0', marginTop: 32, display: 'flex' }}>
          Podcast &amp; Video Studio · Midtown Manhattan, NYC
        </div>
      </div>
    ),
    { ...size }
  );
}
