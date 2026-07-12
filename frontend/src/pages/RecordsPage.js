import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import apiClient, { logout, getRole } from "@/lib/api";
import useWebSocket from "@/hooks/useWebSocket";
import useLivePatient from "@/hooks/useLivePatient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { LogOut, Eye, Search, ArrowLeft, Printer, Archive, Calendar, Pencil, Trash2 } from "lucide-react";
import ExamForm from "@/components/ExamForm";
import PrescriptionTemplate from "@/components/PrescriptionTemplate";

const formatDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ar-EG", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return iso;
  }
};

const RecordsPage = () => {
  const [records, setRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editingPatient, setEditingPatient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const navigate = useNavigate();
  const role = getRole();

  const fetchRecords = useCallback(async (search = "") => {
    setLoading(true);
    try {
      const params = { status: "completed" };
      if (search.trim()) params.search = search.trim();
      const { data } = await apiClient.get("/patients", { params });
      setRecords(data);
    } catch (e) {
      toast.error("خطأ في جلب السجل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(searchTerm); }, [fetchRecords]);

  // Live refresh: reflect new/edited/deleted completed records immediately,
  // without needing a manual refresh button.
  const handleWsMessage = useCallback((msg) => {
    if (msg.event === "patient_field_edit") {
      if (msg.patient_id === editingPatient?.id) {
        live.applyRemoteEdit(msg.patient_id, msg.path, msg.value);
      }
    } else if (["patient_created", "patient_updated", "patient_deleted"].includes(msg.event)) {
      fetchRecords(searchTerm);
    }
  }, [fetchRecords, searchTerm, editingPatient?.id]);

  const { send } = useWebSocket(handleWsMessage);
  const live = useLivePatient({ patient: editingPatient, sendWs: send });

  const handleSearch = (e) => {
    e.preventDefault();
    fetchRecords(searchTerm);
  };

  const handleLogout = () => { logout(); navigate("/login"); };
  const handleBackToApp = () => navigate(role === "doctor" ? "/doctor" : "/secretary");

  const handlePrint = (record) => {
    setSelected(record);
    setTimeout(() => window.print(), 150);
  };

  const handleEdit = (record) => setEditingPatient(record);
  const handleCloseEdit = () => setEditingPatient(null);

  const handleDeleteRecord = async () => {
    if (!recordToDelete) return;
    try {
      await apiClient.delete(`/patients/${recordToDelete.id}`);
      toast.success("تم حذف السجل");
      setRecordToDelete(null);
      fetchRecords(searchTerm);
    } catch (e) { toast.error("خطأ في حذف السجل"); }
  };

  const handleSaveEdit = async () => {
    if (!editingPatient) return;
    setSaving(true);
    try {
      await apiClient.put(`/patients/${editingPatient.id}`, {
        ...live.data, status: "completed",
      });
      toast.success("تم حفظ التعديلات");
      setEditingPatient(null);
      fetchRecords(searchTerm);
    } catch (e) {
      toast.error("خطأ في حفظ التعديلات");
    } finally { setSaving(false); }
  };

  const handleSaveEditAndPrint = async () => {
    if (!editingPatient) return;
    setSaving(true);
    try {
      await apiClient.put(`/patients/${editingPatient.id}`, {
        ...live.data, status: "completed",
      });
      toast.success("تم الحفظ - جاري الطباعة");
      setTimeout(() => {
        window.print();
        setTimeout(() => {
          setEditingPatient(null);
          fetchRecords(searchTerm);
        }, 500);
      }, 300);
    } catch (e) {
      toast.error("خطأ في حفظ التعديلات");
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 no-print">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              data-testid="back-to-app-button"
              variant="ghost" size="icon"
              onClick={handleBackToApp}
            >
              <ArrowLeft className="w-5 h-5 rtl-flip" />
            </Button>
            <div className="w-10 h-10 rounded-full bg-[#5B3A7D] flex items-center justify-center">
              <Archive className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#1F2937]">سجل المرضى</h1>
              <p className="text-xs text-slate-500">الحالات المكتملة</p>
            </div>
          </div>
          <Button data-testid="logout-button" variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 ms-1" />
            <span className="text-sm">خروج</span>
          </Button>
        </div>
      </header>

      {/* Edit mode: reuse the shared exam form */}
      {editingPatient ? (
        <main className="max-w-5xl mx-auto px-6 py-6 no-print">
          <div className="mb-4">
            <Button
              data-testid="cancel-edit-record-button"
              variant="ghost" size="sm"
              onClick={handleCloseEdit}
            >
              <ArrowLeft className="w-4 h-4 ms-1 rtl-flip" />
              رجوع للسجل بدون حفظ
            </Button>
          </div>
          <ExamForm
            patient={editingPatient}
            live={live}
            shortcuts={[]}
            onSaveOnly={handleSaveEdit}
            onSavePrint={handleSaveEditAndPrint}
            saving={saving}
          />
        </main>
      ) : (
      <main className="max-w-6xl mx-auto px-6 py-8 no-print">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              data-testid="records-search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث بالاسم..."
              className="h-11 text-base flex-1"
            />
            <Button
              data-testid="records-search-button"
              type="submit"
              className="h-11 bg-[#5B3A7D] hover:bg-[#4A2E68]"
            >
              <Search className="w-4 h-4 ms-2" />
              بحث
            </Button>
          </form>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-16 text-slate-400">جاري التحميل...</div>
          ) : records.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Archive className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد سجلات مطابقة</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {records.map((r) => (
                <div
                  key={r.id}
                  data-testid={`record-item-${r.id}`}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <p className="font-semibold text-[#1F2937]">{r.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {r.age} سنة • {formatDate(r.updated_at || r.created_at)}
                    </p>
                    {r.diagnosis && (
                      <p className="text-xs text-slate-400 mt-1 truncate max-w-md">
                        {r.diagnosis}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      data-testid={`edit-record-button-${r.id}`}
                      variant="outline" size="sm"
                      onClick={() => handleEdit(r)}
                    >
                      <Pencil className="w-4 h-4 ms-1" />
                      تعديل
                    </Button>
                    <Button
                      data-testid={`print-record-button-${r.id}`}
                      variant="outline" size="sm"
                      onClick={() => handlePrint(r)}
                    >
                      <Printer className="w-4 h-4 ms-1" />
                      طباعة
                    </Button>
                    <Button
                      data-testid={`delete-record-button-${r.id}`}
                      variant="outline" size="sm"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200"
                      onClick={() => setRecordToDelete(r)}
                    >
                      <Trash2 className="w-4 h-4 ms-1" />
                      حذف
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      )}

      <div className="print-container">
        <PrescriptionTemplate
          patient={editingPatient || selected}
          examData={editingPatient ? live.data : selected}
        />
      </div>

      <AlertDialog open={!!recordToDelete} onOpenChange={(open) => !open && setRecordToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السجل</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف سجل {recordToDelete?.name}؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-delete-record-button">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-record-button"
              onClick={handleDeleteRecord}
              className="bg-red-600 hover:bg-red-700"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RecordsPage;
