// Shared label constants for report pages.
// Must NOT contain "use server" — imported by both server actions and client components.

export const QUEUE_STATUS_LABELS: Record<string, string> = {
  waiting:                'รอ',
  waiting_suitable_table: 'รอโต๊ะเหมาะสม',
  called:                 'เรียกแล้ว',
  admitted:               'รับเข้าแล้ว',
  skipped:                'ข้าม',
  cancelled:              'ยกเลิก',
  seated:                 'นั่งแล้ว (เก่า)',
  left:                   'ออกไปแล้ว (เก่า)',
};

export const SESSION_STATUS_LABELS: Record<string, string> = {
  active:  'กำลังใช้งาน',
  closing: 'กำลังออกบิล',
  closed:  'ปิดแล้ว',
  paid:    'ชำระแล้ว',
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  pending:   'รอทำ',
  preparing: 'กำลังทำ',
  ready:     'พร้อมเสิร์ฟ',
  served:    'เสิร์ฟแล้ว',
  cancelled: 'ยกเลิก',
};

export const STATION_LABELS: Record<string, string> = {
  meat:      'เนื้อสัตว์',
  seafood:   'อาหารทะเล',
  vegetable: 'ผัก',
  noodle:    'เส้น',
  dessert:   'ของหวาน',
  drink:     'เครื่องดื่ม',
  sauce:     'น้ำจิ้ม',
};
