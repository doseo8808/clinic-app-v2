import { forwardRef } from "react";

/**
 * Prescription print template - matches the clinic's official design.
 * Purple/green ornate frame, bilingual header, R/L eye exam table, footer.
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

      {/* Header: bilingual clinic name + doctor */}
      <div className="print-header">
        <div className="print-header-en">
          <h2>Ophth.Consultant</h2>
          <h1>Wesen Abdulaziz</h1>
          <p>A.B.C. Ophth</p>
        </div>
        <div className="print-stamp-circle">
          <span>الختم</span>
        </div>
        <div className="print-header-ar">
          <h1>عيادة السراج لطب العيون</h1>
          <p className="doctor-title">الطبيب الاستشاري</p>
          <p className="doctor-name">د.وسن عبد العزيز رشيد</p>
          <p className="doctor-cred">بورد (دكتوراه) عربي طب وجراحة العيون</p>
          <p className="doctor-cred">زميل المجلس العالمي طب وجراحة العيون</p>
        </div>
      </div>

      {/* Patient info */}
      <div className="print-patient-info">
        <div className="info-field">
          <span className="info-label">اسم المريض:</span>
          <span className="info-value">{patient?.name || ''}</span>
        </div>
        <div className="info-field">
          <span className="info-label">العمر:</span>
          <span className="info-value">{patient?.age || ''} سنة</span>
        </div>
        <div className="info-field">
          <span className="info-label">التاريخ:</span>
          <span className="info-value">{today}</span>
        </div>
      </div>

      {/* Eye exam table */}
      <table className="print-eye-table">
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

      {/* Prescription */}
      <div className="print-section print-rx">
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

      {/* Bottom border with contact */}
      <div className="print-footer">
        <div className="footer-content">
          <div className="footer-phone">
            <span className="icon-phone">☎</span>
            <span>07808877969</span>
          </div>
          <div className="footer-address">
            الرمادي - شارع المستودع - بناية مستشفى المصطفى الاهلي سابقاً - فوق صيدلية النور
          </div>
          <div className="footer-location">
            <span className="icon-location">📍</span>
          </div>
        </div>
      </div>
    </div>
  );
});

PrescriptionTemplate.displayName = 'PrescriptionTemplate';

export default PrescriptionTemplate;
