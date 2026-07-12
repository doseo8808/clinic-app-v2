import { forwardRef } from "react";

/**
 * Approximate reproduction of the clinic's eye/wing logo, built from scratch
 * as an inline SVG since no clean source asset was provided. Used both as
 * the small header mark and as a large faded watermark.
 */
const EyeLogo = ({ className, opacity = 1, showText = true, color = "#5B3A7D" }) => (
  <svg viewBox="0 0 200 150" className={className} style={{ opacity }} aria-hidden="true">
    <path
      d="M15,74 C8,40 46,13 96,15 C146,17 179,29 189,17"
      fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
    />
    <path
      d="M15,74 C10,102 43,120 89,114 C125,109 149,92 159,74"
      fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
    />
    <circle cx="58" cy="70" r="20" fill="none" stroke="#4CAF50" strokeWidth="7" />
    <circle cx="58" cy="70" r="7" fill={color} />
    {showText && (
      <text
        x="100" y="145" fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic" fontSize="26" fill={color} textAnchor="middle"
      >
        phthalmo.
      </text>
    )}
  </svg>
);

/**
 * Prescription print template - matches the clinic's official design.
 * Purple/green frame, bilingual header with eye-logo mark, watermark,
 * R/L eye exam table, two-tone pill footer.
 * Only rendered visually when printing (screen: hidden by container).
 */
const PrescriptionTemplate = forwardRef(({ patient, examData }, ref) => {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  return (
    <div ref={ref} className="print-page" dir="rtl">
      {/* Top decorative border */}
      <div className="print-header-border">
        <div className="border-purple"></div>
        <div className="border-green"></div>
      </div>

      {/* Header: bilingual clinic name + doctor, with eye logo overlapping center */}
      <div className="print-header">
        <div className="print-header-ar">
          <p className="doctor-title">الطبيب الاستشاري</p>
          <p className="doctor-name">د.وسن عبد العزيز رشيد</p>
          <p className="doctor-cred">بورد (دكتوراه) عربي طب وجراحة العيون</p>
          <p className="doctor-cred">زميل المجلس العالمي طب وجراحة العيون</p>
          <h1>عيادة السراج لطب العيون</h1>
        </div>
        <EyeLogo className="print-header-logo" />
        <div className="print-header-en">
          <h2>ophth.Consultant</h2>
          <h1>Wesen Abdulaziz</h1>
          <p>A.B.C. Ophth</p>
          <p>I.C.O</p>
        </div>
      </div>

      {/* Patient info */}
      <div className="print-patient-info">
        <div className="info-row">
          <div className="info-field">
            <span className="info-label">اسم المريض :</span>
            <span className="info-value">{patient?.name || ''}</span>
          </div>
          <div className="info-field">
            <span className="info-label">التاريخ:</span>
            <span className="info-value">{today}</span>
          </div>
        </div>
        <div className="info-row">
          <div className="info-field">
            <span className="info-label">العمر :</span>
            <span className="info-value">{patient?.age || ''} سنة</span>
          </div>
        </div>
      </div>

      {/* Eye exam table (label column first, LTR reading order to match layout) */}
      <table className="print-eye-table" dir="ltr">
        <thead>
          <tr>
            <th></th>
            <th>VA</th>
            <th>SPH</th>
            <th>CYL</th>
            <th>AX</th>
            <th>BCVA</th>
            <th>NEAR</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="eye-label">R</td>
            <td>{examData?.right_eye?.va || ''}</td>
            <td>{examData?.right_eye?.sph || ''}</td>
            <td>{examData?.right_eye?.cyl || ''}</td>
            <td>{examData?.right_eye?.ax || ''}</td>
            <td>{examData?.right_eye?.bcva || ''}</td>
            <td>{examData?.right_eye?.near || ''}</td>
          </tr>
          <tr>
            <td className="eye-label">L</td>
            <td>{examData?.left_eye?.va || ''}</td>
            <td>{examData?.left_eye?.sph || ''}</td>
            <td>{examData?.left_eye?.cyl || ''}</td>
            <td>{examData?.left_eye?.ax || ''}</td>
            <td>{examData?.left_eye?.bcva || ''}</td>
            <td>{examData?.left_eye?.near || ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Diagnosis */}
      {examData?.diagnosis && (
        <div className="print-section">
          <h3>التشخيص:</h3>
          <p>{examData.diagnosis}</p>
        </div>
      )}

      {/* Prescription (watermark sits behind this blank/whitespace area) */}
      <div className="print-section print-rx">
        <div className="print-watermark">
          <EyeLogo opacity={0.08} />
          <p>عيادة السراج لطب العيون</p>
        </div>
        <h3>Rx / الوصفة الطبية:</h3>
        <div className="rx-content">
          {(examData?.prescription || '').split('\n').map((line, i) => (
            <p key={i}>{line || '\u00A0'}</p>
          ))}
        </div>
      </div>

      {/* Notes */}
      {examData?.notes && (
        <div className="print-section">
          <h3>ملاحظات:</h3>
          <p>{examData.notes}</p>
        </div>
      )}

      {/* Bottom two-tone pill footer */}
      <div className="print-footer-v2" dir="ltr">
        <div className="footer-phone-pill">
          <span className="icon-phone">☎</span>
          <span>07808877969</span>
        </div>
        <div className="footer-address-pill">
          <div className="footer-address-lines">
            <p>الرمادي - شارع المستودع</p>
            <p>بناية مستشفى المصطفى الاهلي سابقاً - فوق صيدلية النور</p>
          </div>
          <span className="icon-location">📍</span>
        </div>
      </div>
    </div>
  );
});

PrescriptionTemplate.displayName = 'PrescriptionTemplate';

export default PrescriptionTemplate;
