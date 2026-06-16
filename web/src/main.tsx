import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import InviteAccept from "./pages/InviteAccept";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Findings from "./pages/Findings";
import Accounts from "./pages/Accounts";
import AuthCallback from "./pages/AuthCallback";
import Account from "./pages/Account";
import Dashboard from "./pages/Dashboard";
import Workspace from "./pages/Workspace";
import Controls from "./pages/Controls";
import GitHubIntegration from "./pages/GitHubIntegration";
import GitHubIntegrationEdit from "./pages/GitHubIntegrationEdit";
import GitLabIntegration from "./pages/GitLabIntegration";
import GitLabIntegrationEdit from "./pages/GitLabIntegrationEdit";
import GoogleWorkspaceIntegration from "./pages/GoogleWorkspaceIntegration";
import EntraIntegration from "./pages/EntraIntegration";
import SlackIntegration from "./pages/SlackIntegration";
import JiraIntegration from "./pages/JiraIntegration";
import Integrations from "./pages/Integrations";
import History from "./pages/History";
import Reference from "./pages/Reference";
import Layout from "./Layout";
import AuditorLogin from "./pages/AuditorLogin";
import AuditorLayout from "./pages/AuditorLayout";
import AuditorDashboard from "./pages/AuditorDashboard";
import AuditorFindings from "./pages/AuditorFindings";
import AuditorControls from "./pages/AuditorControls";
import AuditorEvidence from "./pages/AuditorEvidence";
import AuditorExport from "./pages/AuditorExport";
import TrustCenter from "./pages/TrustCenter";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/trust/:slug" element={<TrustCenter />} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/findings" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/resources" element={<Navigate to="/findings" replace />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/account" element={<Account />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/settings" element={<Navigate to="/workspace" replace />} />
            <Route path="/trust-center" element={<Navigate to="/workspace#sharing" replace />} />
            <Route path="/auditors" element={<Navigate to="/workspace#sharing" replace />} />
            <Route path="/members" element={<Navigate to="/workspace#access" replace />} />
            <Route path="/detection" element={<Navigate to="/workspace#scanning" replace />} />
            <Route path="/controls" element={<Controls />} />
            <Route path="/history" element={<History />} />
            <Route path="/compliance-history" element={<Navigate to="/history" replace />} />
            <Route path="/compliance-timeline" element={<Navigate to="/history" replace />} />
            <Route path="/timeline" element={<Navigate to="/history" replace />} />
            <Route path="/history/infrastructure" element={<Navigate to="/history" replace />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/integrations/github" element={<GitHubIntegration />} />
            <Route path="/integrations/github/edit" element={<GitHubIntegrationEdit />} />
            <Route path="/integrations/gitlab" element={<GitLabIntegration />} />
            <Route path="/integrations/gitlab/edit" element={<GitLabIntegrationEdit />} />
            <Route path="/integrations/google-workspace" element={<GoogleWorkspaceIntegration />} />
            <Route path="/integrations/entra" element={<EntraIntegration />} />
            <Route path="/integrations/slack" element={<SlackIntegration />} />
            <Route path="/integrations/jira" element={<JiraIntegration />} />
          </Route>
          <Route path="/auditor/verify/:token" element={<AuditorLogin />} />
          <Route path="/auditor/login" element={<AuditorLogin />} />
          <Route element={<AuditorLayout />}>
            <Route path="/auditor/dashboard" element={<AuditorDashboard />} />
            <Route path="/auditor/findings" element={<AuditorFindings />} />
            <Route path="/auditor/controls" element={<AuditorControls />} />
            <Route path="/auditor/evidence" element={<AuditorEvidence />} />
            <Route path="/auditor/export" element={<AuditorExport />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
