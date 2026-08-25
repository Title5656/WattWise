import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WattWise — Home Energy Builder',
  description: 'สร้างบ้านจำลองจากเครื่องใช้ไฟฟ้าจริงและประเมินการใช้พลังงานภายในบ้าน',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
