import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import apiClient, { logout } from "@/lib/api";
import usePolling from "@/hooks/usePolling";
import useLivePatient from "@/hooks/useLivePatient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { UserPlus, LogOut, Eye, RefreshCw, Send, ArrowLeft, Printer, CheckCircle2, Archive } from "lucide-react";
import ExamForm from "@/components/ExamForm";
import PrescriptionTemplate from "@/components/PrescriptionTemplate";

const STATUS_LABELS = {
  pending: 'في الانتظار',
  in_exam: 'داخل الفحص',
  surgery_prep: 'تحضير عملية',
  completed: 'تم الفحص',
};

const formatWaitingTime = (createdAt) => {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (diff < 1) return 'الآن';
  if (diff < 60) return `${diff} د`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}س ${m}د`;
};

const SecretaryPage = () => {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [patients, setPatients] = useState([]);
  const [shortcuts, setShortcuts] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const navigate = useNavigate();

  const today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const fetchPatients = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/patients');
      setPatients(data.filter(p => p.status !== 'completed'));
    } catch (e) { /* silent */ }
  }, []);

  const fetchShortcuts = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/shortcuts');
      setShortcuts(data);
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => { fetchPatients(); fetchShortcuts(); }, [fetchPatients, fetchShortcuts]);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // تحديث قائمة المرضى دورياً بدل الاعتماد على WebSocket (يشتغل على أي استضافة)
  usePolling(fetchPatients, 4000);
  // الاختصارات تتغير نادراً، فتحديثها كل 15 ثانية كافٍ
  usePolling(fetchShortcuts, 15000);

  const live = useLivePatient({ patient: selectedPatient });
  const otherEditorPresent = live.otherEditorActive;

  const handleAddPatient = async (e) => {
    e.preventDefault();
    if (!name.trim() || !age) { toast.error("الاسم والعمر مطلوبان"); return; }
    setSaving(true);
    try {
      await apiClient.post('/patients', {
        name: name.trim(), age: parseInt(age), date: today
      });
      toast.success("تم إرسال المريض للطبيبة");
      setName(""); setAge("");
      fetchPatients();
    } catch (err) {
      toast.error(err.response?.data?.detail || "خطأ في الإرسال");
    } finally { setSaving(false); }
  };

  const handleSelectPatient = (p) => setSelectedPatient(p);
  const handleBack = () => setSelectedPatient(null);

  const handleSaveOnly = async () => {
    if (!selectedPatient) return;
    setSaving(true);
    try {
      await apiClient.put(`/patients/${selectedPatient.id}`, {
        ...live.data, status: 'completed'
      });
      toast.success("تم الحفظ");
      setSelectedPatient(null);
      fetchPatients();
    } catch (e) { toast.error("خطأ في الحفظ"); }
    finally { setSaving(false); }
  };

  const handleSaveAndPrint = async () => {
    if (!selectedPatient) return;
    setSaving(true);
    try {
      await apiClient.put(`/patients/${selectedPatient.id}`, {
        ...live.data, status: 'completed'
      });
      toast.success("تم الحفظ - جاري الطباعة");
      setTimeout(() => {
        window.print();
        setTimeout(() => {
          setSelectedPatient(null);
          fetchPatients();
        }, 500);
      }, 300);
    } catch (e) { toast.error("خطأ في الحفظ"); }
    finally { setSaving(false); }
  };

  const handleLogout = () => { logout(); navigate("/login"); };

  const waitingCount = patients.filter(p => p.status === 'pending').length;
  const inExamCount = patients.filter(p => p.status === 'in_exam').length;

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 no-print">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedPatient && (
              <Button
                data-testid="back-to-list-button"
                variant="ghost" size="icon"
                onClick={handleBack}
              >
                <ArrowLeft className="w-5 h-5 rtl-flip" />
              </Button>
            )}
            <div className="w-10 h-10 rounded-full bg-[#5B3A7D] flex items-center justify-center">
              <Eye className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#1F2937]">عيادة السراج لطب العيون</h1>
              <p className="text-xs text-slate-500">واجهة السكرتير</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              data-testid="open-records-button"
              variant="ghost" size="sm"
              onClick={() => navigate("/records")}
            >
              <Archive className="w-4 h-4 ms-1" />
              <span className="text-sm">السجل</span>
            </Button>
            <Button data-testid="logout-button" variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 ms-1" />
              <span className="text-sm">خروج</span>
            </Button>
          </div>
        </div>
      </header>

      {/* View mode: exam form or dashboard */}
      {selectedPatient ? (
        <main className="max-w-5xl mx-auto px-6 py-6 no-print">
          <ExamForm
            patient={selectedPatient}
            live={live}
            shortcuts={shortcuts}
            onSaveOnly={handleSaveOnly}
            onSavePrint={handleSaveAndPrint}
            saving={saving}
            otherEditorPresent={otherEditorPresent}
          />
        </main>
      ) : (
        <main className="max-w-6xl mx-auto px-6 py-8 grid lg:grid-cols-2 gap-6 no-print">
          {/* Registration */}
          <section>
            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#F3ECFA] flex items-center justify-center">
                  <UserPlus className="w-6 h-6 text-[#5B3A7D]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#1F2937]">مريض جديد</h2>
                  <p className="text-sm text-slate-500">{today}</p>
                </div>
              </div>

              <form onSubmit={handleAddPatient} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">اسم المريض</label>
                  <Input
                    data-testid="secretary-patient-name-input"
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="أدخل الاسم الكامل"
                    className="h-12 text-base" maxLength={200} autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">العمر</label>
                  <Input
                    data-testid="secretary-patient-age-input"
                    type="number" value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="السن بالسنوات"
                    className="h-12 text-base" min="0" max="150"
                  />
                </div>
                <Button
                  data-testid="secretary-submit-button"
                  type="submit" disabled={saving}
                  className="w-full h-14 text-base font-semibold bg-[#5B3A7D] hover:bg-[#4A2E68] rounded-xl"
                >
                  <Send className="w-5 h-5 ms-2" />
                  {saving ? "جاري الإرسال..." : "إرسال إلى الطبيبة"}
                </Button>
              </form>
            </div>
          </section>

          {/* Waiting Room */}
          <section>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 min-h-full">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-[#1F2937]">غرفة الانتظار</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="text-amber-600 font-semibold">{waitingCount}</span> منتظر
                    {' • '}
                    <span className="text-blue-600 font-semibold">{inExamCount}</span> بالفحص
                  </p>
                </div>
                <Button
                  data-testid="refresh-patients-button"
                  variant="ghost" size="icon"
                  onClick={fetchPatients}
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-400 mb-3">اضغط على مريض لفتح ملفه ومساعدة الدكتورة</p>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {patients.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">لا يوجد مرضى حالياً</p>
                  </div>
                ) : (
                  patients.map((p) => (
                    <button
                      key={p.id}
                      data-testid={`waiting-patient-${p.id}`}
                      onClick={() => handleSelectPatient(p)}
                      className="w-full text-right p-4 rounded-xl border border-slate-200 hover:border-[#5B3A7D] hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-[#1F2937]">{p.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {p.age} سنة • {formatWaitingTime(p.created_at)}
                          </p>
                        </div>
                        <span className={`text-xs px-3 py-1 rounded-full font-medium status-${p.status}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Print template (hidden except when printing) */}
      <div className="print-container">
        <PrescriptionTemplate patient={selectedPatient} examData={live.data} />
      </div>
    </div>
  );
};

export default SecretaryPage;
