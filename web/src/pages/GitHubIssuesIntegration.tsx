import { Navigate } from "react-router-dom";

/** Legacy route — redirects to IaC repository setup. */
export default function GitHubIssuesIntegration() {
  return <Navigate to="/integrations/iac-repository" replace />;
}
