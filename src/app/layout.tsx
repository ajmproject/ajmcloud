import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AjmCloud Backend API',
  description: 'Backend API service for AjmCloud personal cloud storage',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body style={{ margin: 0, fontFamily: 'sans-serif', backgroundColor: '#0b0f19', color: '#f3f4f6' }}>
        {children}
      </body>
    </html>
  );
}
