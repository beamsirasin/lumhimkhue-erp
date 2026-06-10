import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { generateDailyClosingReport } from '@/lib/actions/reports/daily-closing';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  cash_qr: 'เงินสด (QR)',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sign(v: number | null) {
  if (v === null) return '';
  return v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
}

function renderEmailHtml(report: Awaited<ReturnType<typeof generateDailyClosingReport>>) {
  const changeColor = (report.revenueChangePct ?? 0) >= 0 ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>รายงานสรุปประจำวัน</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #0f172a; color: #fff; padding: 24px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.7; }
    .section { padding: 20px 24px; border-bottom: 1px solid #f1f5f9; }
    .section:last-child { border-bottom: none; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 12px; }
    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .kpi { background: #f8fafc; border-radius: 8px; padding: 12px 14px; }
    .kpi-label { font-size: 11px; color: #94a3b8; margin: 0 0 4px; }
    .kpi-value { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
    .kpi-change { font-size: 11px; font-weight: 600; margin: 2px 0 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; font-weight: 600; color: #94a3b8; padding: 4px 0; }
    td { font-size: 13px; padding: 5px 0; border-top: 1px solid #f1f5f9; color: #334155; }
    td.right { text-align: right; }
    .footer { text-align: center; font-size: 11px; color: #94a3b8; padding: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>รายงานสรุปประจำวัน</h1>
      <p>${report.dateLabel}</p>
    </div>

    <div class="section">
      <p class="section-title">รายได้และการบริการ</p>
      <div class="kpi-grid">
        <div class="kpi">
          <p class="kpi-label">รายได้รวม</p>
          <p class="kpi-value">฿${fmt(report.revenue)}</p>
          <p class="kpi-change" style="color:${changeColor}">${sign(report.revenueChangePct)} vs เมื่อวาน</p>
        </div>
        <div class="kpi">
          <p class="kpi-label">จำนวนโต๊ะ</p>
          <p class="kpi-value">${report.sessions}</p>
          <p class="kpi-label" style="margin-top:2px">${report.guests} คน</p>
        </div>
        <div class="kpi">
          <p class="kpi-label">เฉลี่ยต่อโต๊ะ</p>
          <p class="kpi-value">฿${fmt(report.avgPerSession)}</p>
        </div>
        ${report.foodCostPct !== null ? `
        <div class="kpi">
          <p class="kpi-label">Food Cost %</p>
          <p class="kpi-value" style="color:${report.foodCostPct > 35 ? '#dc2626' : '#16a34a'}">${report.foodCostPct.toFixed(1)}%</p>
          <p class="kpi-change" style="color:${report.foodCostPct > 35 ? '#dc2626' : '#64748b'}">เป้าหมาย ≤ 35%</p>
        </div>` : ''}
      </div>
    </div>

    ${report.topMenuItems.length > 0 ? `
    <div class="section">
      <p class="section-title">Top 5 เมนูยอดนิยม</p>
      <table>
        <tr><th>เมนู</th><th class="right" style="text-align:right">จาน</th></tr>
        ${report.topMenuItems.map((item, i) => `
        <tr>
          <td>${i + 1}. ${item.name}</td>
          <td class="right">${item.qty}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${report.paymentBreakdown.length > 0 ? `
    <div class="section">
      <p class="section-title">ช่องทางชำระเงิน</p>
      <table>
        <tr><th>วิธี</th><th style="text-align:right">จำนวน</th><th class="right" style="text-align:right">ยอดรวม</th></tr>
        ${report.paymentBreakdown.map((p) => `
        <tr>
          <td>${METHOD_LABEL[p.method] ?? p.method}</td>
          <td class="right">${p.count}</td>
          <td class="right">฿${fmt(p.total)}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${report.lowStockCount > 0 ? `
    <div class="section" style="background:#fff7ed">
      <p class="section-title" style="color:#c2410c">⚠ สต็อกใกล้หมด</p>
      <p style="font-size:14px;color:#9a3412;margin:0">${report.lowStockCount} รายการ ต่ำกว่าจุดสั่งซื้อ — กรุณาตรวจสอบ</p>
    </div>` : ''}

    <div class="footer">ส่งโดยระบบ ERP อัตโนมัติ • ทุกวัน 23:30 น.</div>
  </div>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bangkokNow = toZonedTime(new Date(), 'Asia/Bangkok');
  const dateStr = format(bangkokNow, 'yyyy-MM-dd');

  try {
    const report = await generateDailyClosingReport(dateStr);

    const resend = new Resend(process.env.RESEND_API_KEY);
    const ownerEmail = process.env.OWNER_EMAIL;

    if (!ownerEmail) {
      console.warn('[cron/daily-report] OWNER_EMAIL not set — skipping email');
      return NextResponse.json({ ok: true, date: dateStr, emailSkipped: true });
    }

    await resend.emails.send({
      from: 'ERP Report <noreply@resend.dev>',
      to: ownerEmail,
      subject: `รายงานสรุปประจำวัน — ${report.dateLabel}`,
      html: renderEmailHtml(report),
    });

    return NextResponse.json({ ok: true, date: dateStr });
  } catch (e) {
    console.error('[cron/daily-report]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
