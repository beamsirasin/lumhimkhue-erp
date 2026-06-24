import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { ChefHat } from 'lucide-react';
import { ReportPlaceholderPage } from '@/components/admin/ReportPlaceholderPage';

export const metadata = { title: 'รายงานครัว — ร้านชาบู ERP' };

export default async function KitchenReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return (
    <ReportPlaceholderPage
      title="รายงานครัว"
      subtitle="วิเคราะห์ออเดอร์ครัว รายการเสร็จ และเมนูยอดนิยม"
      icon={ChefHat}
      iconTone="warning"
      description="รายงานครัวจะช่วยให้เข้าใจปริมาณงานของครัว เมนูที่ได้รับความนิยม และประสิทธิภาพการให้บริการจากระบบ KDS"
      dataNote="รายงานนี้จะใช้ข้อมูลจาก orders และ orderItems — สถานะ pending / preparing / ready / served เพื่อวิเคราะห์ภาระงานครัว"
      plannedMetrics={[
        { label: 'ออเดอร์เข้าครัว', description: 'จำนวน order items ที่ส่งเข้าครัวในแต่ละวัน' },
        { label: 'รายการเสร็จ', description: 'จำนวนที่ status เป็น ready หรือ served' },
        { label: 'รายการค้าง', description: 'จำนวน pending/preparing ที่ยังไม่เสร็จ' },
        { label: 'เมนูยอดนิยม', description: 'รายการเมนูที่สั่งมากที่สุดจาก orderItems' },
        { label: 'แยกตามสถานี', description: 'ปริมาณงานแต่ละ station: meat/seafood/vegetable/ฯลฯ' },
        { label: 'ออเดอร์ยกเลิก', description: 'จำนวนรายการที่ถูก cancel และสาเหตุ' },
      ]}
    />
  );
}
