import Image from 'next/image';
import { ArrowRight, BarChart3, House, ShieldCheck, Zap } from 'lucide-react';
import { safeReturnTo } from '@/lib/auth-navigation';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const signInHref = `/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
  return <main className="login-shell">
    <section className="login-story" aria-labelledby="login-title">
      <div className="login-brand"><span><Image src="/wattwise-logo-small.png" alt="" width={48} height={48} priority /></span><div><b>WattWise</b><small>HOME ENERGY</small></div></div>
      <div className="login-story-copy"><p className="kicker">YOUR HOME · YOUR ENERGY</p><h1 id="login-title">รู้ว่าไฟในบ้าน<br />กำลังไปอยู่ที่ไหน</h1><p>รวมอุปกรณ์ การใช้ไฟ และค่าใช้จ่ายไว้ในภาพเดียว เพื่อให้ทุกคนในบ้านตัดสินใจได้ง่ายขึ้น</p></div>
      <div className="login-metrics" aria-label="สิ่งที่ WattWise ช่วยจัดการ">
        <span><Zap aria-hidden="true" /><b>ติดตามโหลดไฟ</b><small>เห็นการใช้พลังงานของอุปกรณ์</small></span>
        <span><BarChart3 aria-hidden="true" /><b>วางแผนค่าไฟ</b><small>เทียบค่าประมาณกับบิลจริง</small></span>
        <span><House aria-hidden="true" /><b>จัดการร่วมกัน</b><small>แยกข้อมูลและสมาชิกแต่ละบ้าน</small></span>
      </div>
    </section>
    <section className="login-panel" aria-label="เข้าสู่ระบบ"><div className="login-card">
      <span className="login-card-icon"><ShieldCheck aria-hidden="true" /></span><p className="kicker">WELCOME BACK</p><h2>เข้าสู่ WattWise</h2>
      <p>ใช้บัญชี Google เพื่อเข้าถึงข้อมูลบ้านของคุณอย่างปลอดภัย</p>
      <a className="google-signin" href={signInHref}><i aria-hidden="true">G</i><span>เข้าสู่ระบบด้วย Google</span><ArrowRight aria-hidden="true" /></a>
      <small>เมื่อเข้าสู่ระบบครั้งแรก คุณจะได้เลือกชื่อที่ต้องการให้แสดงใน WattWise</small>
    </div></section>
  </main>;
}
