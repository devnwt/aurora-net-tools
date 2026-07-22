import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ConfirmProvider } from "@/lib/confirm";
import { ToastProvider } from "@/lib/toast";
import { Layout } from "@/components/Layout";
import { Spinner } from "@/components/ui";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { ResetPassword } from "@/pages/ResetPassword";
import { Dashboard } from "@/pages/Dashboard";
import { Devices } from "@/pages/Devices";
import { DeviceDetail } from "@/pages/DeviceDetail";
import { DeviceForm } from "@/pages/DeviceForm";
import { Credentials } from "@/pages/Credentials";
import { Sites } from "@/pages/Sites";
import { Racks } from "@/pages/Racks";
import { Commands } from "@/pages/Commands";
import { Templates } from "@/pages/Templates";
import { Upgrades } from "@/pages/Upgrades";
import { ScanNetwork } from "@/pages/ScanNetwork";
import { Topology } from "@/pages/Topology";
import { Backups } from "@/pages/Backups";
import { Logs } from "@/pages/Logs";
import { Security } from "@/pages/Security";
import { Settings } from "@/pages/Settings";
import { Users } from "@/pages/Users";
import { ApiKeys } from "@/pages/ApiKeys";
import { Webhooks } from "@/pages/Webhooks";
import { Admin } from "@/pages/Admin";
import { Controllers } from "@/pages/Controllers";
import { OltExplorer } from "@/pages/OltExplorer";
import { Activity } from "@/pages/Activity";
import { Copilot } from "@/pages/Copilot";
import "./index.css";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <ConfirmProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/devices/new" element={<DeviceForm />} />
            <Route path="/devices/:id" element={<DeviceDetail />} />
            <Route path="/devices/:id/edit" element={<DeviceForm />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/racks" element={<Racks />} />
            <Route path="/controllers" element={<Controllers />} />
            <Route path="/controllers/:id/olts" element={<OltExplorer />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/users" element={<Users />} />
            <Route path="/apikeys" element={<ApiKeys />} />
            <Route path="/webhooks" element={<Webhooks />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/plans" element={<Navigate to="/admin" replace />} />
            <Route path="/admin/orgs" element={<Navigate to="/admin" replace />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/commands" element={<Commands />} />
            <Route path="/upgrades" element={<Upgrades />} />
            <Route path="/scan" element={<ScanNetwork />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/security" element={<Security />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
