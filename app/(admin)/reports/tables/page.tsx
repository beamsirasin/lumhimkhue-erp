import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { LayoutGrid } from 'lucide-react';
import { ReportPlaceholderPage } from '@/components/admin/ReportPlaceholderPage';

export const metadata = { title: 'รายงานโต๊ะ — ร้านชาบู ERP' };

export default async function TablesReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return (
    <ReportPlaceholderPage
      title="รายงานโต๊ะ"
      subtitle="วิเคราะห์การเปิด-ปิดโต๊ะ รอบโต๊ะ และประสิทธิภาพการใช้งาน"
      icon={LayoutGrid}
      iconTone="info"
      description="รายงานโต๊ะจะช่วยให้เข้าใจรูปแบบการนั่งของลูกค้า ประสิทธิภาพการหมุนเวียนโต๊ะ และรายได้ต่อโต๊ะแต่ละรอบ"
      dataNote="รายงานนี้จะใช้ข้อมูลจาก session เปิด/ปิดโต๊ะ เพื่อสรุปรอบโต๊ะ เวลานั่งโดยเฉลี่ย และรายได้ต่อโต๊ะ"
      plannedMetrics={[
        { label: 'จำนวนโต๊ะที่เปิด', description: 'จำนวน session ที่เปิดและปิดในแต่ละวัน' },
        { label: 'จำนวนลูกค้า', description: 'จำนวนลูกค้าทั้งหมดจากข้อมูล session guests' },
        { label: 'เวลาเฉลี่ยต่อโต๊ะ', description: 'เวลาเฉลี่ยตั้งแต่เปิดถึงปิด session' },
        { label: 'รอบโต๊ะ', description: 'จำนวนรอบที่โต๊ะแต่ละตัวให้บริการต่อวัน' },
        { label: 'รายได้ต่อโต๊ะ', description: 'รายได้เฉลี่ยต่อ session แยกตามโต๊ะ' },
        { label: 'ช่วงเวลาที่คึกคัก', description: 'ช่วงเวลาที่มีการเปิด session มากที่สุด' },
      ]}
    />
  );
}
