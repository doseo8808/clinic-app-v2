import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

const apiClient = axios.create({ baseURL: API });

apiClient.interceptors.request.use((config) => {
  const pin = localStorage.getItem("clinic_pin");
  if (pin) config.headers["X-Clinic-PIN"] = pin;
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("clinic_pin");
      localStorage.removeItem("clinic_role");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default apiClient;

export const verifyPin = async (pin) => {
  const { data } = await axios.post(`${API}/verify-pin`, { pin });
  return data;   // { success, role, message }
};

export const isAuthenticated = () => !!localStorage.getItem("clinic_pin");
export const getPin = () => localStorage.getItem("clinic_pin");
export const getRole = () => localStorage.getItem("clinic_role");
export const setSession = (pin, role) => {
  localStorage.setItem("clinic_pin", pin);
  localStorage.setItem("clinic_role", role);
};
export const logout = () => {
  localStorage.removeItem("clinic_pin");
  localStorage.removeItem("clinic_role");
};

