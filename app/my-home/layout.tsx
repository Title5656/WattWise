import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Home — WattWise Energy Builder',
  description: 'ประกอบบ้านจำลองจากเครื่องใช้ไฟฟ้าและประมาณการใช้พลังงานกับ WattWise',
  openGraph: {
    title: 'My Home — WattWise Energy Builder',
    description: 'ประกอบบ้านจำลองและดูค่าพลังงานโดยประมาณแบบทันที',
    images: [],
  },
  twitter: {
    title: 'My Home — WattWise Energy Builder',
    description: 'ประกอบบ้านจำลองและดูค่าพลังงานโดยประมาณแบบทันที',
    images: [],
  },
};

export default function MyHomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
