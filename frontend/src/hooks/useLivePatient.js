import { useState, useEffect, useRef, useCallback } from "react";
import apiClient from "@/lib/api";

const emptyEye = () => ({
  va: "", sph: "", cyl: "", ax: "", bcva: "", near: "",
  ucva: "", iop: "", lid: "", cornea: "", lens: "", retina: "",
});

const emptyExam = () => ({
  right_eye: emptyEye(),
  left_eye: emptyEye(),
  notes: "",
  diagnosis: "",
  prescription: "",
});

// كل كم ثانية نسأل السيرفر "فيه تحديث جديد؟" بدل الاعتماد على WebSocket
const POLL_INTERVAL_MS = 2500;
// كم ثانية تبقى إشارة "يتم التعديل من الجهاز الآخر" ظاهرة بعد آخر تغيير مستلم
const OTHER_EDITOR_INDICATOR_MS = 4000;

/**
 * Live-synced patient exam hook (نسخة Polling — بدون WebSocket).
 *
 * - يقرأ بيانات المريض عند تحديد المريض.
 * - `update(path, value)` يحدّث الحالة المحلية ويحفظها بعد 400ms (debounce).
 * - كل 2.5 ثانية يسأل السيرفر عن أحدث نسخة من بيانات المريض، ويدمج أي تغييرات
 *   جاءت من الجهاز الآخر في الحقول التي لست تكتب فيها حالياً (لا يلمس الحقل الذي عليه تركيز).
 * - `setFocusedField(path)` — يُستدعى عند focus/blur لتحديد الحقل الذي يُحرَّر حالياً.
 * - `otherEditorActive` — true مؤقتاً كلما استلمنا تغييراً فعلياً من الجهاز الآخر.
 */
export default function useLivePatient({ patient }) {
  const [data, setData] = useState(emptyExam);
  const [otherEditorActive, setOtherEditorActive] = useState(false);
  const focusedRef = useRef(null);
  const saveTimerRef = useRef(null);
  const otherEditorTimerRef = useRef(null);
  const patientIdRef = useRef(patient?.id);

  // Load patient snapshot when patient changes
  useEffect(() => {
    patientIdRef.current = patient?.id;
    if (patient) {
      setData({
        right_eye: { ...emptyEye(), ...(patient.right_eye || {}) },
        left_eye: { ...emptyEye(), ...(patient.left_eye || {}) },
        notes: patient.notes || "",
        diagnosis: patient.diagnosis || "",
        prescription: patient.prescription || "",
      });
    } else {
      setData(emptyExam());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  // Poll the server periodically for edits made by the other device
  useEffect(() => {
    if (!patient?.id) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const { data: fresh } = await apiClient.get(`/patients/${patient.id}`);
        if (cancelled || fresh.id !== patientIdRef.current) return;

        let changed = false;
        setData(prev => {
          const next = structuredClone(prev);

          const mergeEye = (side) => {
            const freshSide = fresh[side] || {};
            Object.keys(next[side]).forEach((f) => {
              const path = `${side}.${f}`;
              const incoming = freshSide[f] ?? "";
              if (focusedRef.current !== path && next[side][f] !== incoming) {
                next[side][f] = incoming;
                changed = true;
              }
            });
          };
          mergeEye("right_eye");
          mergeEye("left_eye");

          ["notes", "diagnosis", "prescription"].forEach((f) => {
            const incoming = fresh[f] ?? "";
            if (focusedRef.current !== f && next[f] !== incoming) {
              next[f] = incoming;
              changed = true;
            }
          });

          return changed ? next : prev;
        });

        if (changed) {
          setOtherEditorActive(true);
          clearTimeout(otherEditorTimerRef.current);
          otherEditorTimerRef.current = setTimeout(
            () => setOtherEditorActive(false),
            OTHER_EDITOR_INDICATOR_MS
          );
        }
      } catch (e) { /* silent - سيحاول مرة أخرى بالجولة القادمة */ }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearTimeout(otherEditorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  const setFocusedField = useCallback((path) => {
    focusedRef.current = path;
  }, []);

  // Schedule debounced save to server (400ms after last edit)
  const scheduleSave = useCallback((snapshot) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const pid = patientIdRef.current;
      if (!pid) return;
      try {
        await apiClient.put(`/patients/${pid}`, {
          right_eye: snapshot.right_eye,
          left_eye: snapshot.left_eye,
          notes: snapshot.notes,
          diagnosis: snapshot.diagnosis,
          prescription: snapshot.prescription,
        });
      } catch (e) { /* silent */ }
    }, 400);
  }, []);

  /**
   * update("right_eye.va", "1.0")
   * update("prescription", "Rx text")
   */
  const update = useCallback((path, value) => {
    setData(prev => {
      const next = structuredClone(prev);
      const parts = path.split(".");
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // Batch update (e.g. Normal button fills multiple fields at once)
  const updateMany = useCallback((updates) => {
    setData(prev => {
      const next = structuredClone(prev);
      updates.forEach(({ path, value }) => {
        const parts = path.split(".");
        let obj = next;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
        obj[parts[parts.length - 1]] = value;
      });
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  return { data, setData, update, updateMany, setFocusedField, otherEditorActive };
}
