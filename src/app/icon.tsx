import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 14,
          background: 'linear-gradient(135deg, #6FC3FF 0%, #3D7DFF 50%, #5750E8 100%)',
        }}
      >
        <div style={{ color: 'white', fontSize: 32, fontWeight: 900, fontFamily: 'system-ui' }}>Z</div>
      </div>
    ),
    { ...size }
  );
}
