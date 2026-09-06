import Image from 'next/image';
import { ArrowRight, BarChart3, House, Zap } from 'lucide-react';
import { safeReturnTo } from '@/lib/auth-navigation';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const signInHref = `/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
  return <main className="login-shell">
    <section className="login-story" aria-labelledby="login-title">
      <div className="login-brand"><span><Image src="/wattwise-logo-small.png" alt="" width={48} height={48} priority /></span><div><b>WattWise</b><small>HOME ENERGY</small></div></div>
      <div className="login-story-copy"><p className="kicker">วางแผนพลังงานในบ้าน</p><h1 id="login-title">เข้าใจการใช้ไฟ<br />เริ่มได้จากบ้านคุณ</h1><p>เลือกเครื่องใช้ไฟฟ้า ระบุเวลาใช้งาน แล้วดูค่าไฟโดยประมาณของทั้งบ้าน</p></div>
      <div className="login-metrics" aria-label="สิ่งที่ WattWise ช่วยจัดการ">
        <span><Zap aria-hidden="true" /><b>ประมาณการใช้ไฟ</b><small>จากอุปกรณ์และเวลาที่คุณกำหนด</small></span>
        <span><BarChart3 aria-hidden="true" /><b>วางแผนค่าไฟ</b><small>เทียบค่าประมาณกับบิลจริง</small></span>
        <span><House aria-hidden="true" /><b>จัดการร่วมกัน</b><small>แยกข้อมูลและสมาชิกแต่ละบ้าน</small></span>
      </div>
    </section>
    <section className="login-panel" aria-label="เข้าสู่ระบบ"><div className="login-card">
      <p className="kicker">บัญชีของคุณ</p><h2>เข้าสู่ WattWise</h2>
      <p>ใช้บัญชี Google เพื่อเข้าถึงข้อมูลบ้านของคุณอย่างปลอดภัย</p>
      <a className="google-signin" href={signInHref}><i aria-hidden="true">G</i><span>เข้าสู่ระบบด้วย Google</span><ArrowRight aria-hidden="true" /></a>
      <small>เมื่อเข้าสู่ระบบครั้งแรก คุณจะได้เลือกชื่อที่ต้องการให้แสดงใน WattWise</small>
    </div></section>
  </main>;
}
