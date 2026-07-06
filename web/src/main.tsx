import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist";
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
import GcpIntegration from "./pages/GcpIntegration";
import AzureIntegration from "./pages/AzureIntegration";
import VulnScannerIntegration from "./pages/VulnScannerIntegration";
import OktaIntegration from "./pages/OktaIntegration";
import IntuneIntegration from "./pages/IntuneIntegration";
import JamfIntegration from "./pages/JamfIntegration";
import Questionnaire from "./pages/Questionnaire";
import SiemIntegration from "./pages/SiemIntegration";
import GitHubIssuesIntegration from "./pages/GitHubIssuesIntegration";
import IacRepositoryIntegration from "./pages/IacRepositoryIntegration";
import Integrations from "./pages/Integrations";
import IntegrationCatalog from "./pages/IntegrationCatalog";
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
import { ErrorBoundary } from "./components/ErrorBoundary";
import TrustCenter from "./pages/TrustCenter";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Homepage from "./pages/Homepage";
import NoWorkspace from "./pages/NoWorkspace";
import "./styles/findings-overrides.css";
import "./styles/accounts-overrides.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // 1 minute default — prevents refetch spam on every mount
      refetchOnWindowFocus: false, // Don't refetch when user alt-tabs back
      retry: 1,                   // One retry on network failure
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
          <Route path="/trust/:slug" element={<TrustCenter />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/homepage" element={<Homepage />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/no-workspace" element={<NoWorkspace />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/resources" element={<Navigate to="/findings" replace />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/profile" element={<Account />} />
            <Route path="/account" element={<Navigate to="/profile" replace />} />
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
            <Route path="/integrations/catalog" element={<IntegrationCatalog />} />
            <Route path="/integrations/github" element={<GitHubIntegration />} />
            <Route path="/integrations/github/edit" element={<GitHubIntegrationEdit />} />
            <Route path="/integrations/gitlab" element={<GitLabIntegration />} />
            <Route path="/integrations/gitlab/edit" element={<GitLabIntegrationEdit />} />
            <Route path="/integrations/google-workspace" element={<GoogleWorkspaceIntegration />} />
            <Route path="/integrations/entra" element={<EntraIntegration />} />
            <Route path="/integrations/slack" element={<SlackIntegration />} />
            <Route path="/integrations/jira" element={<JiraIntegration />} />
            <Route path="/integrations/gcp" element={<GcpIntegration />} />
            <Route path="/integrations/azure" element={<AzureIntegration />} />
            <Route path="/integrations/scanners/:vendor" element={<VulnScannerIntegration />} />
            <Route path="/integrations/okta" element={<OktaIntegration />} />
            <Route path="/integrations/intune" element={<IntuneIntegration />} />
            <Route path="/integrations/jamf" element={<JamfIntegration />} />
            <Route path="/questionnaire" element={<Questionnaire />} />
            <Route path="/integrations/siem/:vendor" element={<SiemIntegration />} />
            <Route path="/integrations/github-issues" element={<GitHubIssuesIntegration />} />
            <Route path="/integrations/iac-repository" element={<IacRepositoryIntegration />} />
            {/* Azure Boards removed from product — legacy bookmarks redirect to hub */}
            <Route path="/integrations/azure-boards" element={<Navigate to="/integrations" replace />} />
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
    </ErrorBoundary>
  </React.StrictMode>,
);
