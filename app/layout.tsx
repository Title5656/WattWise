import type { Metadata } from 'next';
import { Noto_Sans_Thai } from 'next/font/google';
import './globals.css';

const notoSansThai = Noto_Sans_Thai({
  subsets: ['latin', 'thai'],
  variable: '--font-noto-sans-thai',
});

export const metadata: Metadata = {
  title: 'WattWise — รู้ทันพลังงานในบ้าน',
  description: 'แดชบอร์ดติดตามโหลดไฟ ค่าไฟ และสถิติการใช้พลังงานภายในบ้านในมุมมองเดียว',
  icons: {
    icon: '/wattwise-logo-small.png',
  },
  openGraph: {
    title: 'WattWise — รู้ทันพลังงานในบ้าน',
    description: 'ติดตามโหลดไฟ ค่าไฟ และสถิติพลังงานของบ้านในมุมมองเดียว',
    images: [{
      url: 'https://wattwise-home-energy.v1chr.chatgpt.site/og.png',
      width: 1200,
      height: 630,
      alt: 'WattWise — รู้ทันพลังงานในบ้าน',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WattWise — รู้ทันพลังงานในบ้าน',
    description: 'ติดตามโหลดไฟ ค่าไฟ และสถิติพลังงานของบ้านในมุมมองเดียว',
    images: ['https://wattwise-home-energy.v1chr.chatgpt.site/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th" className={notoSansThai.variable}><body>{children}</body></html>;
}
